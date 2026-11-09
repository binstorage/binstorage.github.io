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

- **product type은 지정하지 않았다(automatic).** Domain도 automatic이고, 이 프로젝트에서 static으로 링크되는 것을 확인했다. `.dynamic`은 이전 글의 문제를 되살리고, `.static`을 명시하면 별도 아카이브가 만들어져 이중 포함이 다시 생길 여지가 있다.
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

nm -m /Library/PrivilegedHelperTools/HelperTool | grep -c 6Domain
# 결과: 28585 — Domain 코드가 바이너리에 포함됨
```

앱 안에서 Domain을 링크하는 동적 프레임워크가 없으므로, SPM이 Domain을 dynamic으로 승격할 이유도 없다. SystemExtension과 HelperTool은 별도 프로세스이자 별도 실행 파일이라, 각자 Domain을 static으로 한 벌씩 갖는 것은 문제가 되지 않는다.

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
