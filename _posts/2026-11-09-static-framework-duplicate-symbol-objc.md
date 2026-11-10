---
layout: post
title: "Static Framework의 패키지 이중 포함과 -ObjC — TCA 업데이트 후 터진 duplicate symbol"
date: 2026-11-09
categories: [macOS]
description: "HelperTool 크래시를 피하려고 UILayer를 Static Framework로 바꿨더니, TCA 업데이트 후 duplicate symbol 11752개가 발생했다. Static Framework가 SPM 패키지를 아카이브에 병합하는 동작, 아카이브 멤버의 지연 로딩 규칙, 의존성이 끌고 온 -ObjC 플래그를 분석하고 UILayer를 SPM 패키지로 전환해 해결한 과정을 정리한다."
---

> 이 글은 [Dynamic Framework 전파와 HelperTool 크래시 — SPM 링킹 결정이 멀티 타겟 프로젝트에 미치는 영향]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %})의 후속 글이다.

이전 글에서 HelperTool 크래시를 막기 위해 UILayer를 **Static Framework**로 바꿨다. Domain이 다시 static으로 결정되면서 HelperTool은 정상 동작했다.

그런데 NavigationStack actor 에러를 고치려고 swift-composable-architecture(TCA)를 1.25.5에서 1.26.2로 올리자, 이번에는 앱 링크 단계가 실패했다.

```
duplicate symbol 'type metadata accessor for Domain.RUIDBSResponse' in:
    .../Build/Products/Debug/Domain.o
    .../Build/Products/Debug/UILayer_Static.framework/Versions/A/UILayer_Static[199](Domain.o)
...
ld: 11752 duplicate symbols
clang: error: linker command failed with exit code 1
```

UILayer 코드는 한 줄도 바꾸지 않았다. 패키지 버전 하나를 올렸을 뿐이다.

---

## 프로젝트 구조 (이전 글의 해결 이후)

```
App ──────────────▶ UILayer_Static(Static Framework) ──▶ TCA, Domain, SharedResources, DependencyDomain
App ──────────────▶ Domain, DependencyDomain, Logger, PacketAuthentication, VirtualGatewayProtocol (SPM 직접 의존)
SystemExtension ──▶ Domain
HelperTool ───────▶ Domain
```

앱은 UILayer_Static을 링크하면서, 동시에 Domain 계열 패키지도 직접 의존한다.

---

## 분석

### 1단계: 중복된 오브젝트는 어디서 왔나

에러 메시지를 집계하면 중복은 정확히 두 군데에서 나온다.

| 위치 | 의미 |
|------|------|
| `Build/Products/Debug/Domain.o` | 앱이 SPM 패키지를 직접 링크한 오브젝트 |
| `UILayer_Static[199](Domain.o)` | **UILayer_Static 아카이브 안**에 들어 있는 Domain 사본 |

Domain만이 아니다. SwiftyBeaver, SharedResources, PGxFVPN 계열 등 앱이 직접 링크하는 패키지가 모두 아카이브 안에도 들어 있었다.

### 2단계: Static Framework는 패키지를 자기 안에 병합한다

UILayer_Static을 만드는 libtool 단계의 입력 목록(`UILayer_Static.LinkFileList`)을 보면 이유가 보인다.

```
Domain.o SharedResources.o DependencyDomain.o SwiftyBeaver.o Logger.o
PGxFVPNCore.o PGxFVPNSSLVPNCore.o ... ComposableArchitecture.o CasePaths.o
Dependencies.o Perception.o Sharing.o SwiftNavigation.o UIKitNavigation.o ...
```

Xcode는 Static Library/Framework 타겟을 만들 때 그 타겟이 의존하는 **SPM 패키지 product의 오브젝트 파일까지 전부 아카이브에 넣는다.** 정적 라이브러리는 혼자서 완결된 결과물이어야 한다고 보기 때문이다.

```
UILayer_Static (아카이브) = UILayer 코드 + Domain.o + SwiftyBeaver.o + PGxFVPN*.o + TCA…   ← 사본
App 링크 입력             = UILayer_Static + Domain.o + SwiftyBeaver.o + PGxFVPN*.o …       ← 원본
```

앱을 링크할 때 Xcode는 UILayer_Static을 하나의 블랙박스로 본다. 그 안에 Domain이 들어 있다는 사실을 모르니, 앱이 직접 의존하는 Domain.o를 또 넘긴다. **같은 코드가 두 벌 존재하는 구조**다.

> Link Binary With Libraries 단계에서 패키지를 빼 보는 것도 시도했지만 효과가 없었다. Xcode는 빌드 단계가 아니라 타겟의 `packageProductDependencies` 기준으로 패키지를 병합한다.

### 3단계: 그런데 왜 지금까지는 됐을까

이 구조는 이전 글의 해결 이후 계속 그대로였다. 그런데도 빌드가 됐던 이유는 **정적 아카이브 멤버의 지연 로딩 규칙** 때문이다.

링커는 `.o` 파일은 무조건 링크하지만, 아카이브(`.a`, Static Framework 바이너리) 안의 멤버는 **아직 정의되지 않은 심볼이 필요할 때만** 꺼내서 링크한다.

```
1. 앱이 직접 넘긴 Domain.o → 무조건 링크 → Domain 심볼 전부 정의됨
2. UILayer_Static 아카이브 → UILayer.o는 필요하니 로드
                           → 아카이브 안 Domain.o는? 필요한 심볼이 이미 다 정의됨 → 로드 안 함
```

사본은 존재하지만 링커가 꺼내지 않으니 문제가 드러나지 않았다.

### 4단계: 지연 로딩을 깨뜨린 `-ObjC`

실패한 빌드의 앱 링크 명령에는 프로젝트 설정 어디에도 없는 플래그가 있었다.

```
clang ... -Xlinker -ObjC ...
```

`-ObjC`는 **Objective-C 클래스나 카테고리를 정의한 아카이브 멤버를, 필요 여부와 상관없이 전부 로드**하라는 옵션이다. ObjC 카테고리는 심볼 참조 없이 런타임에 붙기 때문에, 지연 로딩 규칙으로는 빠질 수 있어서 만들어진 플래그다.

Swift의 `NSObject` 하위 클래스도 ObjC 클래스로 노출되므로 Domain.o, SwiftyBeaver.o, PGxFVPN*.o는 모두 해당된다. 결국 아카이브 안의 사본까지 강제로 로드되면서 원본과 충돌했다.

```
변경 전 (-ObjC 없음)
  Domain.o(원본) 링크 ── 아카이브 안 Domain.o(사본)는 필요 없음 → 무시 → 성공

변경 후 (-ObjC 있음)
  Domain.o(원본) 링크 ── 아카이브 안 Domain.o(사본)에 ObjC 클래스 있음 → 강제 로드 → 충돌
```

### 5단계: `-ObjC`는 누가 넣었나

프로젝트의 `OTHER_LDFLAGS`에는 없었다. 의존 패키지의 `Package.swift`를 뒤지자 TCA가 의존하는 **swift-navigation**에서 찾았다.

```swift
// swift-navigation/Package.swift — UIKitNavigation 타겟
linkerSettings: [.unsafeFlags(["-Xlinker", "-ObjC"])]
```

이 설정은 swift-navigation **2.9.0**부터 추가됐다(PR #337, "Add -ObjC linker flag to UIKitNavigation target"). 패키지의 `linkerSettings`는 그 패키지를 최종 링크하는 바이너리까지 전파된다.

흥미로운 점은 TCA 1.26.2가 swift-navigation 2.9.0 이상을 **요구하지 않는다**는 것이다.

```swift
// swift-composable-architecture 1.25.5와 1.26.2 모두
.package(url: "https://github.com/pointfreeco/swift-navigation", from: "2.7.0"),
```

TCA 버전을 바꾸자 Xcode가 패키지 그래프를 다시 resolve했고, 허용 범위 안의 최신 버전인 2.11.0을 골랐다. 실제로 TCA를 올리기 전 상태로 남아 있던 다른 진입점(워크스페이스)의 `Package.resolved`는 여전히 2.8.0이었다.

```
NavigationStack actor 에러 → TCA 1.25.5 → 1.26.2
  → 패키지 재resolve → swift-navigation 2.8.0 → 2.11.0
    → UIKitNavigation의 -Xlinker -ObjC가 앱 링크에 추가
      → UILayer_Static 아카이브 안의 패키지 사본 강제 로드
        → duplicate symbol 11752개
```

> `Package.resolved`가 `.gitignore` 대상이라면 진입점(xcodeproj / xcworkspace)과 개발자 환경마다 resolve 결과가 달라진다. "내 환경에서는 되는데"가 나오기 좋은 조건이다.

---

## 해결 방법 검토

| 방법 | 내용 | 판단 |
|------|------|------|
| swift-navigation 2.8.0 고정 | `-ObjC`가 들어오기 전 버전으로 고정 | 즉시 해결되지만 이중 포함 구조는 그대로. 다른 패키지가 `-ObjC`를 넣으면 재발 |
| UILayer를 Dynamic Framework로 | 링크 시점 중복 회피 | 이전 글의 문제로 회귀. Domain이 승격되면 HelperTool 크래시, 승격되지 않으면 앱과 프레임워크에 Domain이 두 벌 로드됨 |
| **UILayer를 SPM 패키지로 전환** | UILayer를 패키지 그래프 안으로 편입 | 근본 해결. static 유지, HelperTool 영향 없음 |

Dynamic Framework로 바꾸는 방법은 언뜻 링크 에러를 없애 주는 것처럼 보이지만, 실제로는 문제를 링크 시점에서 런타임으로 미룰 뿐이다.

| | UILayer Static (현재) | UILayer Dynamic |
|---|---|---|
| Domain 사본 위치 | UILayer_Static 아카이브 안 + 앱 직접 링크 | UILayer 프레임워크 바이너리 안 + 앱 바이너리 안 |
| 합쳐지는 시점 | 링크 시점에 한 바이너리로 합쳐짐 | 합쳐지지 않고 별도 이미지로 남음 |
| 결과 | 링커가 중복을 버리거나(-ObjC 없음) 에러로 막음(-ObjC 있음) | 에러 없이 **런타임에 두 벌이 모두 로드됨** |

Static 쪽은 최악의 경우에도 빌드가 실패할 뿐, 두 벌이 섞인 채로 실행되지는 않는다.

---

## 해결: UILayer를 로컬 SPM 패키지로 전환

### 원리: 패키지 그래프 안에서는 모듈이 한 번만 링크된다

UILayer가 Xcode 타겟일 때는 패키지 그래프 **밖**에서 의존성을 미리 묶어 둔 아카이브였다. UILayer를 패키지 타겟으로 바꾸면 미리 묶는 아카이브가 사라지고, 각 모듈은 자기 오브젝트 하나로만 존재한다.

```
UILayer.o, Domain.o, SwiftyBeaver.o, PGxFVPN*.o, ComposableArchitecture.o … (각각 1개)
```

앱을 링크할 때 Xcode는 의존 그래프 전체를 보고 필요한 모듈을 **중복 없이 한 번씩만** 넘긴다. Domain.o가 한 벌뿐이니 `-ObjC`가 모든 오브젝트를 강제 로드해도 충돌할 대상이 없다.

이 동작은 이미 프로젝트 안에서 확인할 수 있었다. PacketAuthentication과 WebSocketVirtualGatewayProtocol은 둘 다 Domain에 의존하지만, 앱 링크 입력에 Domain.o는 **한 번만** 들어 있었다. 둘 다 패키지라서 Xcode가 중복을 걸러 준 것이다. 중복이 생기는 곳은 패키지 그래프 밖에서 미리 묶인 UILayer_Static 하나뿐이었다.

### Package.swift

소스 파일은 옮기지 않고, 기존 `UILayer/UILayer` 폴더를 그대로 타겟 경로로 지정했다.

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "UILayer",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        // 정적 링크 유지를 위해 type 미지정(automatic). .dynamic으로 바꾸면 Domain이 앱/프레임워크에 중복 로드됨
        .library(
            name: "UILayer",
            targets: ["UILayer"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.26.2"),
        .package(path: "../Domain"),
        .package(path: "../SharedResources")
    ],
    targets: [
        .target(
            name: "UILayer",
            dependencies: [
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
                .product(name: "Domain", package: "Domain"),
                .product(name: "DependencyDomain", package: "Domain"),
                .product(name: "SharedResources", package: "SharedResources")
            ],
            path: "UILayer"
        ),
        .testTarget(
            name: "UILayerTests",
            dependencies: ["UILayer"],
            path: "UILayerTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
```

- **product type은 지정하지 않았다(automatic).** Domain도 automatic이고, 이 프로젝트에서 static으로 링크되는 것을 확인했다. `.dynamic`은 이전 글의 문제를 되살린다. `.static`을 명시하면 별도 아카이브가 만들어져 이중 포함이 다시 생길 수 있다고 우려했지만, 직접 빌드해 보니 automatic과 결과가 같았다(아래 "`.static`으로 명시하면?" 참고).
- `swiftLanguageModes: [.v5]`는 기존 타겟의 `SWIFT_VERSION = 5.0`을 유지하기 위한 설정이다. tools-version 6.0의 기본값은 Swift 6 모드라서, 지정하지 않으면 strict concurrency 에러가 쏟아질 수 있다.
- 프레임워크 시절의 umbrella header(`UILayer.h`)와 빈 `Assets.xcassets`는 삭제했다. 남겨 두면 SPM이 `.h`를 처리되지 않은 파일로 경고하고, xcassets를 리소스로 처리해 쓰지 않는 리소스 번들을 만든다. 이미지는 원래부터 SharedResources 패키지의 `Bundle.resourcesModule`로 불러오고 있었다.

### 프로젝트 변경

- App 프로젝트에서 `UILayer.xcodeproj` 서브프로젝트 참조, `UILayer_Static.framework` 링크·임베드를 제거하고 로컬 패키지 `../UILayer`를 추가했다.
- `import UILayer_Static` → `import UILayer`
- `UILayer.xcodeproj`는 삭제했다.

---

## 검증

swift-navigation 2.11.0과 `-Xlinker -ObjC`가 **그대로 있는 상태**에서 확인했다. 원인을 제거한 게 아니라, 원인이 있어도 깨지지 않는 구조가 됐는지 보는 것이 목적이다.

| 항목 | 결과 |
|------|------|
| 빌드 | `BUILD SUCCEEDED`, duplicate symbol 0개 |
| 앱 링크 명령의 `-Xlinker -ObjC` | 있음 |
| 앱 링크 입력 중복 | 없음. `Domain.o`, `UILayer.o`, `ComposableArchitecture.o`, `SwiftyBeaver.o` 모두 1회 |
| `PackageFrameworks` | `type: .dynamic`으로 명시된 패키지만 존재. Domain·UILayer는 승격되지 않음 |
| SystemExtension, HelperTool | `Domain.o` static 링크, UILayer는 링크되지 않음 |

HelperTool은 이전 글과 같은 방법으로 확인했다.

```bash
otool -L /Library/PrivilegedHelperTools/HelperTool | grep -v -e /usr/lib/ -e /System/Library/
# 결과: 시스템 라이브러리 외 의존 dylib 없음

# Domain 모듈이 직접 정의한 심볼 / 외부에서 가져오는 Domain 심볼
nm -gU /Library/PrivilegedHelperTools/HelperTool | awk '{print $3}' | grep -c '^_$s6Domain'
# 결과: 6985 — Domain 코드가 바이너리에 포함됨
nm -u /Library/PrivilegedHelperTools/HelperTool | grep -c '^_$s6Domain'
# 결과: 0 — 외부에서 가져오는 Domain 심볼 없음
```

앱 안에서 Domain을 링크하는 동적 프레임워크가 없으므로, SPM이 Domain을 dynamic으로 승격할 이유도 없다. SystemExtension과 HelperTool은 별도 프로세스이자 별도 실행 파일이라, 각자 Domain을 static으로 한 벌씩 갖는 것은 문제가 되지 않는다.

### 앱에서 static 링킹 확인하기

앱도 같은 방법으로 확인할 수 있다. 다만 Debug 빌드에서는 **어떤 파일을 봐야 하는지**부터 알아야 한다.

#### Debug 빌드의 앱 실행 파일은 껍데기다

Xcode 16부터 Debug 빌드는 `ENABLE_DEBUG_DYLIB` 설정에 따라 앱을 두 파일로 나눈다.

```
PacketGO.app/Contents/MacOS/
├── PacketGO               ← 실행만 담당하는 작은 stub
├── PacketGO.debug.dylib   ← 실제 앱 코드 + static 링크된 모듈
└── __preview.dylib        ← SwiftUI Preview용
```

실제 앱에서 두 파일을 비교하면 차이가 분명하다.

| 파일 | 크기 | 정의된 심볼 |
|------|------|------|
| `PacketGO` | 약 60KB | 27개 |
| `PacketGO.debug.dylib` | 약 66MB | Domain 모듈 심볼만 6,989개 |

`PacketGO`에 정의된 27개 심볼은 모두 debug dylib을 찾아서 실행하는 코드다.

```
___debug_blank_executor_main
_getDebugDylibHandle
_getDebugDylibEntryPoint
_lookupMainFuncAddressInDebugDylibMachHeader
_abort_failed_to_open___debug_dylib
...
```

`otool -L PacketGO`를 실행하면 `@rpath/PacketGO.debug.dylib` 한 줄만 나온다. 실행하면 stub이 이 dylib을 열고, 그 안의 진짜 `main`을 찾아 호출한다.

이렇게 나누는 이유는 **SwiftUI Preview**다. Preview는 앱 코드를 다시 불러와서 뷰를 렌더링해야 한다. 앱 코드가 실행 파일에 박혀 있으면 그렇게 하기 어렵고, dylib으로 분리되어 있어야 Preview가 불러다 쓸 수 있다.

Release 빌드와 Archive에는 `.debug.dylib`이 없고(`ENABLE_DEBUG_DYLIB = NO`), 앱 코드가 전부 실행 파일에 들어간다.

| 빌드 | 확인할 파일 |
|------|------|
| Debug (Xcode에서 Run) | `Contents/MacOS/PacketGO.debug.dylib` |
| Release, Archive | `Contents/MacOS/PacketGO` |

#### 확인 방법

```bash
A=.../Build/Products/Debug/PacketGO.app
B=$A/Contents/MacOS/PacketGO.debug.dylib   # Release라면 $A/Contents/MacOS/PacketGO

# 1. 동적 로드 대상에 Domain이 없는지
otool -L $B | grep -i domain
# 결과: 없음 (dynamic이었다면 @rpath/Domain_…_PackageProduct.framework가 나와야 함)

# 2. Domain 코드가 바이너리 안에 있는지 ← 가장 확실한 방법
nm -gU $B | awk '{print $3}' | grep -c '^_$s6Domain'   # 결과: 6989
nm -u  $B | grep -c '^_$s6Domain'                       # 결과: 0

# 3. 앱 번들에 Domain 프레임워크가 없는지
ls $A/Contents/Frameworks
# 결과: libswiftCompatibilitySpan.dylib, openssl.framework, WebSocketModule.framework

# 4. (실행 중일 때) Domain 이미지가 로드되지 않았는지
vmmap [PID] | grep -i "Domain_"
```

1번과 3번은 "없다"는 것만 보여 주므로 그것만으로는 근거가 약하다. **2번에서 정의된 심볼이 있고 외부 참조가 0개**인 것까지 확인해야 static 링크라고 말할 수 있다.

> `nm ... | grep 6Domain`처럼 세면 안 된다. `UILayer.popupManager(Domain.PopupManagerProtocol)`처럼 **Domain 타입을 인자로 받는 다른 모듈의 심볼**까지 잡힌다. Swift 심볼은 `_$s` + 모듈 이름 길이 + 모듈 이름으로 시작하므로, Domain 모듈 자체의 심볼은 `_$s6Domain`으로 시작하는 것만 세야 한다. 심볼 이름은 `xcrun swift-demangle --simplified`로 읽을 수 있다.

---

## 링킹 형태는 타겟별로 나뉘지 않는다

"HelperTool은 static, 앱은 dynamic"처럼 타겟마다 Domain의 링킹 형태가 다를 수 있을까? 지금까지 관찰한 결과로는 **같은 빌드 안에서는 Domain을 쓰는 모든 타겟이 같은 형태로 링크됐다.**

| 빌드 | Domain을 동적으로 만드는 조건 | Domain 형태 | 타겟별 결과 |
|------|------|------|------|
| macOS, UILayer Dynamic Framework (이전 글) | UILayer 동적 프레임워크가 Domain에 의존 | `Domain_…_PackageProduct.framework` | 앱뿐 아니라 HelperTool도 `@rpath/Domain…`로 동적 링크 → 크래시 |
| macOS, UILayer Static Framework | 없음 | `Domain.o` | 앱, SystemExtension, HelperTool 모두 static (대신 이번 글의 이중 포함 발생) |
| macOS, UILayer SPM 패키지 (이번 해결) | 없음 | `Domain.o` | 앱, SystemExtension, HelperTool 모두 static, 중복 없음 |
| iOS, UILayer Dynamic Framework | UILayer 동적 프레임워크가 Domain에 의존 | `Domain_…_PackageProduct.framework` | 앱과 UILayer.framework 모두 동적 링크 |

iOS 빌드에서는 Domain이 export하는 심볼 4,995개 중 UILayer.framework나 앱 바이너리에 다시 정의된 것이 0개였다. 동적으로 승격된 Domain이 한 벌만 존재하고, 모두가 그것을 참조한다.

### 왜 나뉘지 않는가

Xcode는 한 빌드에서 패키지 product 하나당 **결과물을 하나만** 만든다. `Domain.o`를 만들거나 `Domain_…_PackageProduct.framework`를 만들거나 둘 중 하나다. Domain에 의존하는 타겟은 모두 그 하나를 링크하므로, 타겟별로 형태가 달라질 수 없다.

방향도 정해져 있다. "하나가 static이면 모두 static"이 아니라, **기본은 static이고, 동적으로 만들 조건이 하나라도 생기면 모두 dynamic**이 된다. 승격하는 이유는 같은 프로세스 안에 Domain이 두 벌 들어가는 것을 막기 위해서다. 앱과 UILayer 동적 프레임워크가 각자 Domain을 static으로 품으면 앱 프로세스 안에 두 벌이 생긴다.

문제는 이 결정이 **빌드 전체에 적용된다**는 점이다. Xcode는 "HelperTool은 별도 프로세스이고 App Bundle 밖에 설치된다"는 사실을 고려하지 않는다. 그래서 앱 프로세스의 중복을 막으려고 내린 결정이 HelperTool까지 dynamic으로 바꿔 버렸다. 이것이 이전 글의 크래시가 생긴 원리다.

iOS에서는 같은 승격이 일어났지만 문제가 되지 않았다. App Bundle 밖에서 실행되는 HelperTool이 없고, 앱 익스텐션은 `@executable_path/../../Frameworks` rpath로 App Bundle의 프레임워크를 찾을 수 있기 때문이다.

> 결정 기준은 그 빌드에 포함된 타겟들로 보인다. 같은 HelperTool이라도 단독 scheme으로 빌드할 때와 앱 scheme에 포함되어 빌드될 때 결과가 달라질 수 있다. 이 부분은 직접 실험하지 않았고, Xcode의 승격 규칙은 공식 문서로 정리되어 있지 않다. 위 설명은 관찰 결과에서 나온 동작 모델이다.

HelperTool처럼 반드시 static이어야 하는 타겟이 있다면, **같은 프로세스 안에서 공유 패키지를 링크하는 동적 프레임워크를 두지 않는 것**이 가장 확실하다.

### 승격된 패키지는 왜 .dylib이 아니라 .framework인가

SwiftPM 패키지를 `swift build`로 빌드하면 동적 라이브러리는 `libD.dylib`로 나온다. 그런데 위 표에서 동적으로 승격된 Domain은 `Domain_…_PackageProduct.framework` 안에 확장자 없는 바이너리로 들어 있었다.

Xcode에서 빌드할 때만 앱에 임베드하기 위해 `D.framework/D` 형태로 다시 포장하기 때문이다. iOS에서는 App Store가 앱 번들 안의 단독 dylib을 허용하지 않고 프레임워크 형태를 요구한다(Swift 런타임 같은 예외 제외). 그래서 포장되는 순간 프레임워크 관례를 따라 확장자가 사라진다.

```bash
file Domain_…_PackageProduct.framework/Domain_…_PackageProduct
# Mach-O 64-bit dynamically linked shared library arm64
```

확장자만 없을 뿐 내용은 dylib 그대로다. `LC_LOAD_DYLIB`에도 `@rpath/D.framework/D` 경로로 기록된다.

### otool -L에는 직접 의존성만 나온다

동적 링크를 확인할 때 주의할 점이 하나 있다. 앱 번들의 `Frameworks/`에 프레임워크가 분명히 들어 있는데, 앱 실행 파일을 `otool -L`로 보면 목록에 없을 수 있다. 다음은 다른 iOS 프로젝트(Xcode 프레임워크 타겟으로 레이어를 나눈 구조)의 예다.

```bash
otool -L MicroApp_PresentationLayerModule.app/MicroApp_PresentationLayerModule
# @rpath/PresentationLayerModule.framework/PresentationLayerModule
# @rpath/RIBs.framework/RIBs
# ... (DomainLayerModule 없음)

ls MicroApp_PresentationLayerModule.app/Frameworks
# DomainLayerModule.framework  PresentationLayerModule.framework  RIBs.framework ...
```

`otool -L`은 그 바이너리가 **직접** 기록한 `LC_LOAD_DYLIB`만 보여 주고, 의존성의 의존성은 따라가지 않는다. 프레임워크 바이너리를 하나씩 보면 관계가 드러난다.

```bash
otool -L Frameworks/PresentationLayerModule.framework/PresentationLayerModule
# @rpath/DomainLayerModule.framework/DomainLayerModule   ← 여기서 링크
# @rpath/UILayerModule.framework/UILayerModule
# @rpath/RIBs.framework/RIBs
# ...
```

```
MicroApp_PresentationLayerModule (앱)
├── PresentationLayerModule
│   ├── DomainLayerModule
│   │   └── ResourcesModule
│   ├── UILayerModule
│   │   └── ResourcesModule, PinLayout, Differentiator, Rx*
│   └── RIBs, ReactorKit, RxCocoa, RxRelay, RxSwift
└── RIBs
```

앱 코드가 직접 `import`해서 심볼을 쓰는 모듈은 `PresentationLayerModule`과 `RIBs`뿐이라 앱 바이너리에는 이 둘만 기록된다. 런타임에 dyld는 `PresentationLayerModule`을 로드하면서 그 `LC_LOAD_DYLIB`를 다시 읽고 `DomainLayerModule`을 연쇄적으로 로드한다. 간접 의존성도 `Frameworks/`에 임베드만 되어 있으면 정상 동작하고, 임베드가 빠지면 앱 바이너리에 기록되지 않았더라도 `Library not loaded`로 크래시한다.

앞의 확인 방법에서 `otool -L`에 Domain이 "없다"는 것만으로는 근거가 약하다고 한 것도 같은 이유다. 앱 바이너리에는 없어도 다른 프레임워크를 통해 동적으로 로드될 수 있으므로, 정의된 심볼(`nm -gU`)과 외부 참조(`nm -u`)까지 함께 봐야 한다.

---

## `.static`으로 명시하면?

UILayer는 static으로 링크되어야 한다. 그렇다면 automatic으로 두지 말고 `type: .static`으로 명시하는 게 의도가 더 분명하지 않을까?

```swift
.library(
    name: "UILayer",
    type: .static,
    targets: ["UILayer"]
),
```

### 우려: 이중 포함이 다시 생기지 않을까

처음에는 `.static`을 명시하는 것을 피했다. 이유는 이랬다.

automatic은 "링킹 방식을 Xcode가 정하라"는 뜻이고, `.static`은 "**정적 라이브러리를 독립된 결과물로 만들어라**"는 뜻이다. 그러면 Xcode가 UILayer를 별도 아카이브(`.a`)로 묶을 수 있고, 이때 두 가지 경우가 생긴다.

| 아카이브에 들어가는 것 | 결과 |
|------|------|
| UILayer 코드만 | automatic과 같다. 문제없음 |
| UILayer + 의존 모듈(Domain, TCA 등) | 이 글에서 겪은 **UILayer_Static과 똑같은 구조**가 된다. 앱이 직접 링크한 `Domain.o`와 아카이브 안의 사본이 겹치고, `-ObjC`가 사본을 강제 로드해서 duplicate symbol이 다시 난다 |

두 번째 경우를 의심한 근거는 두 가지였다.

1. Xcode의 Static Framework **타겟**(UILayer_Static)은 실제로 의존 패키지 `.o`를 아카이브 안에 넣었다. libtool 입력 목록으로 확인한 사실이다.
2. SwiftPM의 `.dynamic` product는 동적이 아닌 의존성을 자기 안에 static으로 넣는다. "독립된 라이브러리"를 만들기 위한 규칙이다. 정적 product도 같은 이유로 의존성을 함께 묶을 수 있다고 봤다.

하지만 둘 다 **간접적인 근거**였고, `.static` 패키지 product를 직접 빌드해 본 것은 아니었다. 이미 automatic이 검증되어 있으니 굳이 확인되지 않은 쪽을 고를 이유가 없다는 판단이었다.

비슷한 우려가 한 번 빗나간 적도 있었다. iOS에서 UILayer를 `.dynamic` 패키지로 바꾸면 공유 패키지가 UILayer 안에 복사될 수 있다고 걱정했지만, 실제로는 Xcode가 공유 패키지를 동적 프레임워크로 승격해서 문제가 없었다. 그래서 `.static`도 직접 빌드해서 확인했다.

### 검증 방법

automatic과 `.static`을 **같은 방법**으로 비교했다. `UILayer/Package.swift`의 product에 `type` 한 줄이 있는지 없는지만 다르고, 나머지 조건은 같다.

- swift-navigation 2.11.0과 `-Xlinker -ObjC`가 그대로 있는 상태
- 각각 **새 DerivedData**에서 처음부터 빌드 (이전 빌드 결과가 섞이지 않게)
- 아래 빌드 명령과 확인 명령 1~4를 **두 빌드에 똑같이** 실행

`$DD`만 바꿔서 두 번 실행한다. automatic은 `type`을 지정하지 않은 상태, `.static`은 `type: .static`을 넣은 상태다.

```bash
DD=/tmp/dd_static     # 새 DerivedData 경로
xcodebuild -project PacketGO/PacketGO.xcodeproj -scheme PacketGO -configuration Debug \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath $DD build > static.log 2>&1

grep -E "\*\* BUILD" static.log              # 빌드 결과
grep -c "duplicate symbol" static.log         # duplicate symbol 개수
```

빌드가 성공하는 것만으로는 부족하다. 우려한 상황이 일어났는지, 즉 **UILayer가 별도 아카이브로 만들어졌는지**와 **앱 링크 입력에 같은 모듈이 두 번 들어갔는지**를 직접 확인해야 한다.

```bash
B=$DD/Build/Products/Debug

# 1. UILayer가 별도 아카이브로 만들어졌는가
ls $B | grep -i uilayer                       # UILayer.o 인가, libUILayer.a 인가
find $DD/Build -iname '*UILayer*.a'           # .a 파일이 있는가
grep -E "^Libtool .*UILayer" static.log       # 아카이브를 만드는 Libtool 단계가 있었는가

# 2. 앱 링크 입력에 중복이 있는가
F=$DD/Build/Intermediates.noindex/PacketGO.build/Debug/PacketGO.build/Objects-normal/arm64/PacketGO.LinkFileList
xargs -n1 basename < $F | sort | uniq -c | awk '$1>1'                                  # 두 번 이상 나온 입력
xargs -n1 basename < $F | grep -E "^(UILayer|Domain|ComposableArchitecture|SwiftyBeaver)\.o$"

# 3. 우려의 전제 조건(-ObjC)이 그대로 있는가
grep -A4 "^Ld .*PacketGO.debug.dylib" static.log | grep -o -- "-Xlinker -ObjC" | head -1

# 4. 링킹 형태가 바뀌지 않았는가 (승격 여부, HelperTool·앱의 static 링크)
ls $B/PackageFrameworks
nm -gU $B/*HelperTool | awk '{print $3}' | grep -c '^_[$]s6Domain'      # 정의된 Domain 심볼
nm -u  $B/*HelperTool | grep -c '^_[$]s6Domain'                         # 외부 참조 Domain 심볼
A=$B/PacketGO.app/Contents/MacOS/PacketGO.debug.dylib
nm -gU $A | awk '{print $3}' | grep -c '^_[$]s6Domain'
nm -gU $A | awk '{print $3}' | grep -c '^_[$]s7UILayer'
ls $B/PacketGO.app/Contents/Frameworks
```

| 확인 | 의미 |
|------|------|
| 1번 | 우려의 출발점. 별도 아카이브가 없다면 사본이 들어갈 곳 자체가 없다 |
| 2번 | 우려의 결과. 같은 `.o`가 두 번 나오면 이중 포함이다 |
| 3번 | `-ObjC`가 빠져서 중복이 가려진 것이 아닌지 확인 |
| 4번 | `.static`이 링크 결과를 다른 쪽으로 바꾸지 않았는지 확인 (HelperTool 조건 포함) |

### 결과

두 빌드에 같은 명령을 실행한 결과다.

| 확인 | 항목 | automatic | `.static` |
|------|------|------|------|
| 빌드 | 결과 / duplicate symbol | 성공 / 0개 | 성공 / 0개 |
| 1 | `Build/Products/Debug`의 UILayer 산출물 | `UILayer.o`, `UILayer.swiftmodule` | `UILayer.o`, `UILayer.swiftmodule` |
| 1 | `*UILayer*.a` 파일 / Libtool 단계 | 0개 / 0회 | 0개 / 0회 |
| 2 | 앱 링크 입력 중 2회 이상 나온 항목 | 0개 | 0개 |
| 2 | `Domain.o` / `UILayer.o` / `ComposableArchitecture.o` / `SwiftyBeaver.o` | 각 1회 | 각 1회 |
| 3 | `-Xlinker -ObjC` | 있음 | 있음 |
| 4 | `PackageFrameworks` | `WebSocketModule.framework`만 | `WebSocketModule.framework`만 |
| 4 | HelperTool Domain 정의 / 외부 참조 | 6,985 / 0 | 6,985 / 0 |
| 4 | 앱 Domain 정의 / UILayer 정의 | 6,989 / 12,338 | 6,989 / 12,338 |
| 4 | 앱 `Frameworks` | `libswiftCompatibilitySpan.dylib`, `openssl.framework`, `WebSocketModule.framework` | 같음 |

모든 항목이 **숫자까지 같았다.**

**우려는 틀렸다.** Xcode는 `.static`으로 명시해도 UILayer를 별도 아카이브로 만들지 않았다. automatic과 똑같이 `UILayer.o` 하나로 만들고, 앱을 링크할 때 패키지 그래프 전체에서 모듈마다 `.o`를 한 번씩만 넘겼다.

### 왜 우려와 달랐나

우려의 근거였던 두 동작은 모두 **패키지 그래프 바깥**의 이야기였다.

- Xcode Static Framework 타겟은 패키지 그래프 밖에 있는 Xcode 타겟이다. 그래서 의존 패키지를 미리 아카이브에 묶어 둔다.
- 의존성을 자기 안에 묶는 SwiftPM 규칙은 `swift build`처럼 패키지를 단독으로 빌드해서 **다른 곳에 가져다 쓸 결과물**을 만들 때 의미가 있다.

같은 빌드 그래프 안에서 패키지 product를 쓸 때는 Xcode가 그래프 전체를 보고 링크한다. product 타입을 명시해도 이 원칙은 그대로였다. iOS에서 `.dynamic`을 명시했을 때 Xcode가 공유 패키지를 승격해 중복을 막은 것과 같은 결론이다.

> 이 결과는 이 프로젝트의 Xcode 빌드에서 관찰한 것이다. `swift build`로 패키지를 단독 빌드하거나 xcframework로 미리 빌드해서 배포하는 경우는 확인하지 않았다.

### automatic과 `.static` 중 무엇을 쓸까

이 빌드에서는 결과가 완전히 같았다. 기술적으로는 어느 쪽이든 괜찮다.

| | automatic | `.static` |
|------|------|------|
| 링크 결과 | static, 중복 없음 | 같음 |
| 장점 | 이미 검증되어 커밋된 상태 | "UILayer는 반드시 static"이라는 의도가 코드에 드러난다 |
| HelperTool 보호 | Domain 쪽 상황이 결정하므로 효과 같음 | 같음 |

HelperTool에 중요한 것은 UILayer가 아니라 **Domain**의 링킹 형태다. Domain이 승격되는지는 같은 프로세스 안에 Domain을 링크하는 동적 바이너리가 있는지가 정한다. 그래서 UILayer를 `.static`으로 명시해도 HelperTool을 보호하는 효과는 automatic과 같다. 여기서는 이미 검증된 automatic을 유지했다.

---

## 전환하면서 만난 함정

### xcodeproj와 Package.swift가 같은 폴더에 있으면

`UILayer/` 폴더에 `UILayer.xcodeproj`와 `Package.swift`가 함께 있는 동안, `xcodebuild -scheme UILayer`는 패키지가 아니라 **xcodeproj를 빌드했다.** 그래서 패키지에 TCA 1.26.2를 지정했는데도 xcodeproj에 고정된 1.25.5로 빌드되어 NavigationStack actor 에러가 계속 났다. 전환을 끝냈다면 기존 xcodeproj는 지우는 편이 안전하다.

### 오래된 Package.resolved

함께 전환한 다른 앱 프로젝트에서는 resolve 단계가 실패했다.

```
multiple packages ('swift-issue-reporting', 'xctest-dynamic-overlay') declare targets
with a conflicting name: 'IssueReporting'; target names need to be unique across the package graph
```

로컬 `Package.resolved`에 오래된 `xctest-dynamic-overlay 1.6.1` 고정이 남아 있었다. 그래서 TCA 1.26.2가 쓰는 `swift-issue-reporting 2.x`와 타겟 이름이 충돌했다. resolved 파일을 지우고 다시 resolve하자 `1.13.1`이 잡히면서 해결됐다. Xcode에서는 **File > Packages > Reset Package Caches** 후 다시 resolve하면 된다.

---

## 정리

이번 문제는 이전 글의 해결책(Static Framework)이 남긴 구조적 약점이, 의존성 업데이트를 계기로 드러난 것이다.

| 단계 | 내용 |
|------|------|
| 잠재 원인 | Static Framework가 SPM 패키지 오브젝트를 아카이브에 병합 → 앱의 직접 링크와 이중 포함 |
| 숨겨져 있던 이유 | 아카이브 멤버는 필요한 심볼이 있을 때만 로드됨 |
| 직접 원인 | swift-navigation 2.9.0+의 `-Xlinker -ObjC`가 아카이브 멤버를 강제 로드 |
| 계기 | TCA 업데이트에 따른 패키지 재resolve(2.8.0 → 2.11.0) |
| 해결 | UILayer를 SPM 패키지로 전환 → 모든 모듈이 패키지 그래프 안에서 한 번만 링크 |

두 글을 합쳐 보면 원칙은 하나다. **같은 SPM 패키지를 쓰는 코드는 모두 같은 패키지 그래프 안에 두어야 한다.** Xcode 프레임워크 타겟이 패키지를 감싸는 순간, 링커나 SPM이 볼 수 없는 경계가 생긴다. 그 경계가 Dynamic이면 링킹 타입 전파와 런타임 중복으로, Static이면 아카이브 안의 사본으로 문제를 일으킨다.

> 후속 글: iOS에서 UILayer를 `.dynamic` 패키지로 바꿀 때 공유 패키지가 승격되는지 검증한 과정은 [iOS UILayer를 .dynamic 패키지로 — 공유 패키지는 승격될까, 복사될까]({% post_url 2026-11-10-ios-uilayer-dynamic-package-promotion %})에서 다룬다.
