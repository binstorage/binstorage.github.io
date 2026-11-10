---
layout: post
title: "iOS UILayer를 .dynamic 패키지로 — 공유 패키지는 승격될까, 복사될까"
date: 2026-11-10
categories: [iOS]
description: "iOS에서 UILayer를 Dynamic Framework 타겟에서 .dynamic SPM 패키지로 바꿀 때, UILayer가 의존하는 공유 패키지(Domain 등)가 동적 프레임워크로 승격되는지 UILayer 안에 복사되는지 otool과 nm으로 검증한다. 전환 전후 결과가 같았고, 직접 링크한 .dynamic product는 Embed & Sign이 필요하다는 함정을 정리한다."
---

> 이 글은 [Dynamic Framework 전파와 HelperTool 크래시]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %}), [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})에 이어지는 글이다.

macOS에서는 UILayer를 SPM 패키지(automatic, static)로 바꿔 duplicate symbol 문제를 해결했다. iOS도 같은 구조로 맞추려 했지만, iOS는 사정이 다르다.

- iOS에는 App Bundle 밖에서 실행되는 HelperTool이 없다. 그래서 Domain이 동적 프레임워크로 승격돼도 문제가 없고, 실제로 지금 그렇게 동작하고 있다.
- 패킷 터널 익스텐션의 메모리 한도를 고려해 UILayer를 동적 라이브러리로 유지하는 방안도 검토하고 있다.

그래서 iOS에서는 UILayer를 **`.dynamic` 패키지**로 바꾸는 방안을 검증한다. 핵심 질문은 하나다.

> UILayer를 `.dynamic` 패키지로 바꾸면, UILayer와 앱이 함께 쓰는 공유 패키지(Domain 등)는 지금처럼 동적 프레임워크로 승격될까, 아니면 UILayer 안에 복사될까?

---

## 현재 구조

```
App ──────▶ UILayer.framework (Xcode Dynamic Framework 타겟)
App ──────▶ Domain, DataFlowDomain, Logger … (SPM 직접 의존)
UILayer ──▶ TCA, CodeScanner, SharedResources, Domain, DataFlowDomain, Logger
Appex ────▶ DataFlowDomain, Logger
Domain ───▶ DataFlowDomain, Logger
```

UILayer가 의존하는 패키지는 모두 `type`을 지정하지 않은 automatic 타입이다. `.dynamic`으로 명시한 것은 하나도 없다.

---

## 문제 (가능성)

UILayer가 `.dynamic` 패키지가 되면, Xcode는 UILayer가 의존하는 패키지를 둘 중 하나로 처리한다.

| 패키지 | 앱 프로세스 안에서 쓰는 곳 | 예상 처리 |
|------|------|------|
| TCA, CodeScanner, SharedResources | UILayer만 | UILayer 안에 static으로 포함. 지금과 같고 문제없음 |
| Domain, DataFlowDomain, Logger | UILayer와 앱이 **함께** 씀 | **(b) 동적으로 승격** 또는 **(a) UILayer 안에 static으로 포함** |

- **(b) 승격**: 지금과 같다. 앱과 UILayer가 같은 `Domain_…_PackageProduct.framework` 한 벌을 쓴다. → 문제없음
- **(a) 복사**: Domain이 UILayer 안에 한 벌, 앱 쪽에 한 벌 들어간다. 두 바이너리가 같은 앱 프로세스에 로드되므로 **프로세스 안에 Domain이 두 벌** 존재한다. → 문제

(a)가 위험한 이유는 링크 에러가 나지 않기 때문이다. macOS/iOS는 two-level namespace 방식이라 각 바이너리의 코드가 자기 안의 사본을 쓴다. 그래서 실행 중에야 문제가 드러난다.

- static 변수와 싱글턴이 둘로 갈린다.
- 한쪽의 `Domain.SpaceModel`이 다른 쪽에서는 다른 타입으로 취급되어 캐스팅이나 프로토콜 conformance 검색이 실패할 수 있다.
- ObjC 런타임에 노출되는 클래스는 `Class X is implemented in both A and B. One of the two will be used. Which one is undefined.` 경고와 함께 어느 쪽이 쓰일지 정해지지 않는다.

(a)가 될 여지가 있는 이유는 SwiftPM 규칙 때문이다. `.dynamic` product는 **동적이 아닌 의존성을 자기 안에 static으로 넣는다.** 독립적으로 쓸 수 있는 라이브러리를 만들기 위한 규칙이다. Xcode가 Dynamic Framework 타겟일 때처럼 공유 패키지를 승격해 줄지, 이 규칙대로 복사할지가 이번 검증의 대상이다.

> 같은 모듈 심볼이 두 바이너리에 모두 정의되어 있다는 것은 각자 사본을 갖고 있다는 뜻이다. 문제가 되는지는 두 바이너리가 **같은 프로세스**에 로드되는지에 달려 있다. 앱과 익스텐션처럼 별도 프로세스라면 각자 한 벌씩 갖는 것은 문제가 아니다.

---

## 해결

- **(b)가 나오면** 그대로 쓰면 된다.
- **(a)가 나오면** 공유 패키지가 UILayer 안에 들어가지 않게 한다.
  1. Domain, DataFlowDomain, Logger의 product를 `type: .dynamic`으로 명시한다. 동적 product는 다른 동적 product 안에 들어가지 않고 독립된 프레임워크로 존재하므로, 앱과 UILayer가 같은 한 벌을 쓴다. iOS에는 HelperTool이 없으니 문제가 없다. 단, 같은 패키지를 macOS와 공유한다면 macOS에서는 쓸 수 없는 방법이다.
  2. UILayer를 automatic(static)으로 둔다. macOS와 같은 구조다.

---

## 사용하는 도구: otool과 nm

검증에는 두 도구를 쓴다. 둘 다 Mach-O 바이너리를 읽지만 보는 대상이 다르다.

| 도구 | 보는 것 | 답할 수 있는 질문 |
|------|------|------|
| `otool -L` | 로드 명령(`LC_LOAD_DYLIB`) | 이 바이너리는 **실행할 때 어떤 동적 라이브러리를 불러오는가** |
| `nm` | 심볼 테이블 | 이 바이너리 **안에 어떤 코드가 들어 있고, 무엇을 바깥에서 가져오는가** |

static으로 링크된 모듈은 코드가 이미 바이너리 안에 있어서 로드할 대상이 아니다. 그래서 `otool -L`에는 나오지 않고 `nm`으로만 보인다. 반대로 동적 프레임워크는 `otool -L`에 나오고, `nm`에서는 미정의(외부 참조) 심볼로 보인다.

### otool

```bash
otool -L <바이너리>                        # 실행 시 로드할 동적 라이브러리 목록
otool -l <바이너리> | grep -A2 LC_RPATH    # @rpath를 찾을 검색 경로 목록
```

- `-L`(대문자)은 `LC_LOAD_DYLIB` 계열에 기록된 install name만 보여 준다. 예: `@rpath/Domain_…_PackageProduct.framework/Domain_…_PackageProduct`
- dylib이나 프레임워크 바이너리를 보면 **첫 줄은 그 바이너리 자신의 ID**(`LC_ID_DYLIB`)다. 의존성이 아니다.
- `-l`(소문자)은 로드 명령 전체를 보여 준다. `@rpath`가 실제로 어디를 가리키는지(`LC_RPATH`) 확인할 때 쓴다.
- 직접 기록한 의존성만 보여 주고, 의존성의 의존성은 따라가지 않는다.

> **다시 한번 확인하기**
> - `otool -L`/`-l`의 기본 사용법과 `@rpath`, `@executable_path`, `@loader_path` 해석 → [Dynamic Framework 전파와 HelperTool 크래시]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %})의 "Mach-O Install Name 변수", "분석에 사용한 도구"
> - `otool -L`에 간접 의존성이 안 나오는 이유 → [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})의 "otool -L에는 직접 의존성만 나온다"
> - 승격된 패키지가 `.dylib`이 아니라 `.framework`로 포장되는 이유 → 같은 글의 "승격된 패키지는 왜 .dylib이 아니라 .framework인가"

### nm

```bash
nm -gU <바이너리>     # 이 바이너리 안에 정의되어 바깥으로 공개된 심볼
nm -u  <바이너리>     # 바깥에서 가져와야 하는(미정의) 심볼
nm -m  <바이너리>     # 심볼마다 정의 여부와 출처를 함께 표시
```

| 옵션 | 의미 |
|------|------|
| `-g` | 외부에 공개된(global) 심볼만. `internal`/`private` 같은 로컬 심볼은 빠진다 |
| `-U` | 이 바이너리 안에 **정의된** 심볼만. 미정의 심볼은 뺀다 |
| `-u` | **미정의** 심볼만. 다른 바이너리에서 가져와야 하는 것들이다 |
| `-m` | Mach-O 형식으로 출력. 미정의 심볼에는 `(from UILayer)`처럼 어느 바이너리에서 가져오는지 표시된다 |
| `-arch arm64` | 여러 아키텍처가 함께 들어 있는 바이너리(시뮬레이터 빌드 등)에서 하나만 고른다 |

출력은 `주소 타입 심볼이름` 형태다. 타입이 `T`(코드), `S`/`D`(데이터)처럼 대문자면 외부 공개 심볼이고, `U`면 미정의 심볼이다. 그래서 `awk '{print $3}'`로 이름만 뽑아 센다.

**Swift 심볼에서 모듈 골라내기**

Swift 심볼 이름은 `_$s` + 모듈 이름 길이 + 모듈 이름으로 시작한다.

```
_$s6Domain10ActionCodeV...          → Domain 모듈 (6글자)
_$s22ComposableArchitecture5StoreC  → ComposableArchitecture 모듈 (22글자)
```

그래서 특정 모듈의 심볼만 세려면 `^_[$]s6Domain`처럼 접두어로 걸러야 한다. `grep 6Domain`처럼 세면 Domain 타입을 인자로 받는 **다른 모듈의 함수**까지 잡혀서 숫자가 부풀려진다. 이름은 `xcrun swift-demangle --simplified`로 사람이 읽을 수 있게 풀 수 있다.

```bash
nm -gU <바이너리> | awk '{print $3}' | grep '^_[$]s6Domain' | head -3 | xcrun swift-demangle --simplified
# ActionCode.AC.getter
# property descriptor for ActionCode.AC
# ActionCode.init(AC:)
```

**두 바이너리의 중복 확인**

`comm -12`는 정렬된 두 목록에서 **공통으로 있는 줄**만 출력한다. 두 바이너리의 정의 심볼 목록을 비교하면, 같은 코드가 양쪽에 다 들어 있는지 알 수 있다.

```bash
comm -12 <(nm -gU <바이너리A> | awk '{print $3}' | sort) \
         <(nm -gU <바이너리B> | awk '{print $3}' | sort) | wc -l
```

> **다시 한번 확인하기**
> - `nm`으로 static 링크를 판단하는 방법, `grep 6Domain`으로 세면 안 되는 이유, Debug 빌드의 `.debug.dylib` stub 구조 → [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})의 "앱에서 static 링킹 확인하기"
> - 정적 라이브러리(`ar` 아카이브)와 동적 라이브러리를 `file` 명령으로 구분하는 방법 → [정적 라이브러리 vs 동적 라이브러리]({% post_url 2026-10-29-static-vs-dynamic-library-build-runtime %})

---

## 검증 방법

실기기 Debug 빌드 기준이다. 실기기 빌드는 arm64 하나뿐이라 `nm`, `otool`에 `-arch`가 필요 없다(시뮬레이터 빌드는 `-arch arm64`를 붙인다).

```bash
P=~/Library/Developer/Xcode/DerivedData/PacketGO-<hash>/Build/Products/Debug-iphoneos
APP=$P/PacketGO.app
U=$APP/Frameworks/UILayer.framework/UILayer                    # UILayer
A=$APP/PacketGO.debug.dylib                                     # 앱 (Debug 빌드라 실제 코드는 여기)
X=$APP/PlugIns/PGxFSSLVPN.appex/PGxFSSLVPN.debug.dylib         # 익스텐션
D=$(ls $APP/Frameworks/Domain_*_PackageProduct.framework/Domain_*_PackageProduct 2>/dev/null)   # 승격된 Domain
```

> Debug 빌드에서는 `ENABLE_DEBUG_DYLIB` 때문에 앱 실행 파일(`PacketGO`)이 stub이고 실제 코드는 `PacketGO.debug.dylib`에 있다. iOS 앱 번들은 macOS와 달리 `Contents/MacOS` 없이 평평한 구조다.
>
> **다시 한번 확인하기**: stub과 `.debug.dylib` 구조, Release 빌드에서는 어떤 파일을 봐야 하는지 → [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})의 "Debug 빌드의 앱 실행 파일은 껍데기다"

### 0. 임베드 여부

```bash
ls $APP/Frameworks
```

앱이 로드하는 동적 프레임워크가 모두 앱 번들 안에 있어야 한다. 특히 UILayer가 `.dynamic` 패키지가 된 뒤에는 `UILayer.framework`가 들어 있는지 확인한다(아래 "전환하면서 만난 함정" 참고).

### 1. 승격 여부 (`otool -L`)

`otool -L`은 바이너리가 실행될 때 dyld가 로드할 동적 라이브러리 목록(`LC_LOAD_DYLIB`)을 보여 준다. static으로 들어간 모듈은 여기에 나오지 않는다.

```bash
ls $APP/Frameworks
otool -L $U | grep -i PackageProduct
otool -L $A | grep -i PackageProduct
```

앱과 UILayer가 둘 다 `@rpath/Domain_…_PackageProduct.framework` 등을 가리키고 해당 프레임워크가 `Frameworks`에 있으면 (b)다.

### 2. 사본 여부 (`nm`)

각 바이너리 안에 모듈 코드가 직접 정의되어 있는지 센다. 가장 결정적인 확인이다.

```bash
for m in Domain DataFlowDomain Logger ComposableArchitecture; do
  p="^_[\$]s${#m}${m}"
  printf "%-24s UILayer=%5d  App=%5d  Appex=%5d\n" $m \
    $(nm -gU $U | awk '{print $3}' | grep -c "$p") \
    $(nm -gU $A | awk '{print $3}' | grep -c "$p") \
    $(nm -gU $X | awk '{print $3}' | grep -c "$p")
done
```

| 부분 | 의미 |
|------|------|
| `-g` | 외부에 공개된(global) 심볼만 |
| `-U` | 이 바이너리 안에 정의된 심볼만 (다른 곳에서 가져오는 미정의 심볼 제외) |
| `^_[$]s${#m}${m}` | Swift 심볼은 `_$s` + 모듈 이름 길이 + 모듈 이름으로 시작한다. `Domain`이면 `_$s6Domain` |

> `$`는 셸 변수 기호이자 정규식 끝 기호라 `'^_\$s...'`처럼 쓰면 셸이나 grep에 따라 다르게 해석될 수 있다. `[$]`로 쓰면 어느 환경에서나 문자 그대로의 `$`로 동작한다.

### 3. 교집합

같은 프로세스에 로드되는 바이너리끼리 겹치는 심볼이 없어야 한다.

```bash
comm -12 <(nm -gU $D | awk '{print $3}' | sort) <(nm -gU $U | awk '{print $3}' | sort) | wc -l   # 0이어야 정상
comm -12 <(nm -gU $D | awk '{print $3}' | sort) <(nm -gU $A | awk '{print $3}' | sort) | wc -l   # 0이어야 정상
```

### 4. 실행 확인 (보조)

실기기에서 실행한 뒤 Xcode 콘솔에 `Class … is implemented in both …` 경고가 없는지 본다.

---

## 기준값: 현재 구조 (UILayer = Xcode Dynamic Framework 타겟)

패키지로 바꾸기 전에 지금 구조에서 1~4번을 먼저 측정했다. 전환 후 결과와 비교할 기준값이다.

| 검증 | 결과 |
|------|------|
| 1. 승격 여부 | 앱과 UILayer가 모두 `Domain_…`, `DataFlowDomain_…`, `Logger_…_PackageProduct.framework`를 가리킨다. 세 프레임워크가 `Frameworks`에 있다 → **(b) 승격** |
| 2. 사본 여부 | 아래 표 |
| 3. 교집합 | Domain∩UILayer = 0, Domain∩App = 0 |
| 4. 실행 확인 | `implemented in both` 경고 없음 |

2번 결과는 다음과 같다.

```
Domain                   UILayer=    2  App=    0  Appex=    0
DataFlowDomain           UILayer=    0  App=    0  Appex=    0
Logger                   UILayer=    0  App=    0  Appex=    0
ComposableArchitecture   UILayer= 2140  App=    0  Appex=    0
```

### 해석 1: Domain의 2개는 사본이 아니다

UILayer에 `_$s6Domain`으로 시작하는 심볼이 2개 있지만, Domain 코드의 사본이 아니다. 이름을 풀어 보면 알 수 있다.

```bash
nm -gU $U | awk '{print $3}' | grep '^_[$]s6Domain' | xcrun swift-demangle --simplified
# PopupManagerProtocol.showRequiredPermissionPopup()
# async function pointer to PopupManagerProtocol.showRequiredPermissionPopup()
```

UILayer가 Domain의 `PopupManagerProtocol`에 extension으로 추가한 메서드다. Swift는 extension 멤버 심볼에 **확장한 타입의 모듈 이름**을 붙이기 때문에 `_$s6Domain`으로 시작한다. 사본이었다면 `ActionCode.init(AC:)` 같은 Domain 자체의 타입과 함수가 수천 개 나왔을 것이다.

DataFlowDomain과 Logger는 UILayer와 앱 모두 0이다. 공유 패키지 세 개 모두 승격된 프레임워크 한 벌만 존재한다.

### 해석 2: TCA는 UILayer 안에 2,140개

TCA는 UILayer.framework 바이너리 안에 static으로 들어가 있다.

1. TCA는 automatic 타입이라 기본적으로 static으로 링크된다.
2. 앱 프로세스 안에서 TCA를 링크하는 바이너리는 **UILayer 하나뿐**이다. 앱 타겟에는 TCA 패키지 의존성이 없다.
3. 두 벌이 생길 일이 없으니 Xcode는 TCA를 승격하지 않고 UILayer 안에 넣는다.

Domain, DataFlowDomain, Logger는 앱과 UILayer가 함께 쓰기 때문에 승격됐고, TCA는 UILayer만 쓰기 때문에 승격되지 않았다. **Xcode는 패키지마다 따로 판단한다.** 같은 프로세스에 두 벌이 생길 패키지만 승격한다.

2,140은 TCA가 UILayer 안에서 바깥으로 공개하는(global) 심볼 수다. `internal`/`private` 심볼은 로컬 심볼이라 `nm -g`에서 빠지므로, 실제로 들어 있는 TCA 코드는 이보다 많다. UILayer가 동적 라이브러리라서, 안에 static으로 들어간 모듈의 public 심볼까지 그대로 export한다.

### 해석 3: 앱은 TCA를 UILayer에서 빌려 쓴다

앱은 `import ComposableArchitecture`를 쓰지만 App=0이다. 앱 안에 TCA 코드가 없고, **UILayer가 export하는 TCA 심볼을 가져다 쓴다.** `nm -m`으로 미정의 심볼이 어느 바이너리에서 오는지 확인할 수 있다.

```bash
nm -m $A | grep 'undefined' | grep '_$s22ComposableArchitecture' | head -3
# (undefined) external _$s22ComposableArchitecture5StoreC... (from UILayer)
```

만약 앱 타겟에 TCA 패키지를 직접 추가하면, TCA도 Domain처럼 앱과 UILayer가 함께 쓰는 패키지가 된다. 위 규칙대로라면 TCA(와 그 하위 패키지)도 동적 프레임워크로 승격될 것으로 예상된다. 이 부분은 직접 확인하지 않았다.

### 해석 4: 익스텐션은 별도 프로세스다

익스텐션(Appex)은 모든 모듈이 0이지만, 0인 이유는 두 가지로 나뉜다.

| 모듈 | Appex=0인 이유 |
|------|------|
| DataFlowDomain, Logger | **동적으로 링크**해서 코드가 `…_PackageProduct.framework`에 있고 Appex 안에는 없음 |
| Domain, ComposableArchitecture | Appex가 **아예 쓰지 않음** |

`nm -gU`는 정의된 심볼만 세기 때문에 두 경우가 똑같이 0으로 나온다. 어느 쪽인지는 `otool -L`과 `nm -m`으로 구분한다.

```bash
otool -L $X | grep PackageProduct                                  # DataFlowDomain, Logger만 나옴
nm -m $X | grep undefined | grep '_$s14DataFlowDomain' | head -3   # (from DataFlowDomain_…) 로 표시
nm -m $X | grep -c '_$s6Domain'                                    # 0 — 정의도 참조도 없음
```

DataFlowDomain과 Logger가 익스텐션에서도 동적인 이유도 같은 규칙이다. 앱 프로세스에서 앱과 UILayer가 함께 써서 승격됐고, 한 빌드에서 패키지 product마다 결과물은 하나뿐이라 익스텐션도 그 프레임워크를 링크한다. 익스텐션은 `@executable_path/../../Frameworks` rpath로 App Bundle의 프레임워크를 찾는다. 앱과 별도 프로세스이므로, 설령 익스텐션이 모듈을 static으로 갖고 있더라도 앱 쪽과의 중복은 문제가 되지 않는다.

> **다시 한번 확인하기**: 같은 빌드 안에서 패키지 하나의 링킹 형태가 타겟마다 나뉘지 않는 이유 → [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})의 "링킹 형태는 타겟별로 나뉘지 않는다"

---

## 전환: UILayer를 `.dynamic` 패키지로

### Package.swift

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "UILayer",
    platforms: [
        .iOS("17.4")
    ],
    products: [
        // 기존 Dynamic Framework 타겟과 같은 동적 라이브러리로 유지.
        // Domain/DataFlowDomain/Logger는 앱과 함께 쓰므로 PackageProduct 프레임워크로 승격되는지 확인 필요
        .library(
            name: "UILayer",
            type: .dynamic,
            targets: ["UILayer"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.26.2"),
        .package(url: "https://github.com/twostraws/CodeScanner.git", from: "2.5.2"),
        .package(path: "../Domain"),
        .package(path: "../DataFlowDomain"),
        .package(path: "../SharedResources"),
        .package(path: "../Logger")
    ],
    targets: [
        .target(
            name: "UILayer",
            dependencies: [
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
                .product(name: "CodeScanner", package: "CodeScanner"),
                .product(name: "Domain", package: "Domain"),
                .product(name: "DataFlowDomain", package: "DataFlowDomain"),
                .product(name: "SharedResources", package: "SharedResources"),
                .product(name: "Logger", package: "Logger")
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

- 기존 `UILayer/UILayer` 소스 폴더를 그대로 타겟 경로로 썼다.
- 모듈 이름이 원래 `UILayer`였기 때문에 앱의 `import UILayer`는 바꿀 필요가 없었다.
- 프레임워크 시절의 umbrella header(`UILayer.h`)와 빈 `Assets.xcassets`는 삭제했다. 이미지는 SharedResources 패키지의 리소스 번들에서 불러온다.
- 앱과 MicroApp 프로젝트에서 `UILayer.xcodeproj` 서브프로젝트 참조를 로컬 패키지 `../UILayer`로 바꾸고, `UILayer.xcodeproj`는 삭제했다.

### 전환하면서 만난 함정: `.dynamic` product는 직접 임베드해야 한다

처음 빌드는 성공했지만 `UILayer.framework`가 **앱 번들의 `Frameworks`에 들어가지 않았다.** 그런데 앱은 UILayer를 로드하도록 되어 있었다.

```bash
otool -L $A | grep UILayer
# @rpath/UILayer.framework/UILayer

ls $APP/Frameworks
# DataFlowDomain_…  Domain_…  Logger_…  openssl.framework  WebSocketModule.framework
# (UILayer.framework 없음)
```

시뮬레이터 Debug 빌드는 rpath에 빌드 폴더(`…/Build/Products/Debug-iphonesimulator/PackageFrameworks`)가 들어 있어서 실행될 수도 있다. 하지만 실기기와 배포 빌드에서는 그 경로가 없으므로 실행하자마자 `Library not loaded: @rpath/UILayer.framework/UILayer`로 크래시한다. "개발 환경에서는 되는데 배포하면 크래시"가 나오는 전형적인 경우다.

> **다시 한번 확인하기**: 개발 환경에서만 빌드 폴더 rpath로 프레임워크를 찾는 동작 → [Dynamic Framework 전파와 HelperTool 크래시]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %})의 "3단계: SystemExtension의 실제 Framework 로딩 경로 확인"

빌드 로그에서 프레임워크별로 누가 임베드했는지 비교하자 차이가 드러났다. 경로는 `…`로 줄였다.

**Embed & Sign 없이 빌드했을 때**

```
# UILayer.framework는 PackageFrameworks에 만들어진다
CreateUniversalBinary …/Debug-iphonesimulator/PackageFrameworks/UILayer.framework/UILayer normal arm64\ x86_64 (in target 'UILayer-product' from project 'UILayer')

# 앱 번들로 복사되는 것은 이것뿐이다
Copy …/PacketGO.app/Frameworks/openssl.framework …/openssl.xcframework/ios-arm64_x86_64-simulator/openssl.framework
Copy …/PacketGO.app/Frameworks/WebSocketModule.framework …/PackageFrameworks/WebSocketModule.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/Logger_19F76B3DFF5FE6_PackageProduct.framework …/PackageFrameworks/Logger_19F76B3DFF5FE6_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/Domain_17E53062B3BFDE_PackageProduct.framework …/PackageFrameworks/Domain_17E53062B3BFDE_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/DataFlowDomain_-4B04C528ADEC4588_PackageProduct.framework …/PackageFrameworks/DataFlowDomain_-4B04C528ADEC4588_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
# → UILayer.framework를 PacketGO.app/Frameworks로 복사하는 줄이 없다
```

UILayer.framework는 빌드 결과물 폴더(`PackageFrameworks`)에 만들어졌지만, 앱 번들로 복사하는 단계가 없었다. 나머지 동적 프레임워크는 모두 `in target 'PacketGO'`로 앱 타겟이 복사했다.

**Embed & Sign을 추가한 뒤**

```
Copy …/PacketGO.app/Frameworks/WebSocketModule.framework …/PackageFrameworks/WebSocketModule.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/Logger_19F76B3DFF5FE6_PackageProduct.framework …/PackageFrameworks/Logger_19F76B3DFF5FE6_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/Domain_17E53062B3BFDE_PackageProduct.framework …/PackageFrameworks/Domain_17E53062B3BFDE_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
Copy …/PacketGO.app/Frameworks/UILayer.framework …/PackageFrameworks/UILayer.framework (in target 'PacketGO' from project 'PacketGO')   ← 추가됨
Copy …/PacketGO.app/Frameworks/DataFlowDomain_-4B04C528ADEC4588_PackageProduct.framework …/PackageFrameworks/DataFlowDomain_-4B04C528ADEC4588_PackageProduct.framework (in target 'PacketGO' from project 'PacketGO')
```

(두 번째 빌드는 증분 빌드라 바뀌지 않은 `openssl.framework` 복사 줄은 다시 나오지 않았다.)

빌드 로그에서 이 줄들만 뽑으려면 다음처럼 한다.

```bash
# Xcode: Report navigator(⌘9)에서 빌드 로그를 텍스트로 저장하거나, xcodebuild 출력을 파일로 남긴 뒤
grep -E "^Copy .*PacketGO\.app/Frameworks/" build.log
```

정리하면 다음과 같다.

| 프레임워크 | 앱과의 관계 | 임베드 |
|------|------|------|
| Domain, DataFlowDomain, Logger | automatic 타입을 Xcode가 **승격**해서 만든 프레임워크 | Xcode가 자동으로 임베드 |
| WebSocketModule (`.dynamic`) | 다른 패키지를 통한 **간접** 의존 | Xcode가 자동으로 임베드 |
| UILayer (`.dynamic`) | 앱 타겟이 **직접** 링크 | **임베드되지 않음** |

앱 타겟이 직접 링크하는 `.dynamic` 패키지 product는 Xcode의 **"Frameworks, Libraries, and Embedded Content"에서 "Embed & Sign"**으로 설정해야 임베드된다. 프로젝트 파일에서는 Embed Frameworks 빌드 단계에 해당 product 항목이 있어야 한다. 서브프로젝트 참조를 지우면서 기존 Embed Frameworks 단계까지 함께 지운 것이 원인이었다.

```
/* project.pbxproj */
XXXX /* UILayer in Embed Frameworks */ = {isa = PBXBuildFile; productRef = YYYY /* UILayer */; settings = {ATTRIBUTES = (CodeSignOnCopy, ); }; };
```

Embed Frameworks 단계에 이 항목을 다시 넣자 `UILayer.framework`가 앱 번들에 들어갔다. 검증 방법에 "0. 임베드 여부"를 추가한 이유다.

---

## 결과: `.dynamic` 패키지로 전환 후

전환 후 실기기 Debug 빌드에서 0~4번을 다시 측정했다. **모두 기준값과 같았다.**

| 검증 | 기준값 (Dynamic Framework 타겟) | 전환 후 (`.dynamic` 패키지) |
|------|------|------|
| 0. 임베드 여부 | `UILayer.framework`와 승격된 세 프레임워크가 `Frameworks`에 있음 | 같음 (Embed & Sign 추가 후) |
| 1. 승격 여부 | 앱과 UILayer가 같은 `Domain_…`, `DataFlowDomain_…`, `Logger_…_PackageProduct.framework`를 가리킴 → (b) | 같음 → **(b)** |
| 2. 사본 여부 | Domain 2 / DataFlowDomain 0 / Logger 0 / TCA 2140 (UILayer), 앱·Appex 0 | **같음** |
| 3. 교집합 | Domain∩UILayer 0, Domain∩App 0 | 같음 |
| 4. 실행 확인 | 정상 실행, `implemented in both` 경고 없음 | 같음 |

```
Domain                   UILayer=    2  App=    0  Appex=    0
DataFlowDomain           UILayer=    0  App=    0  Appex=    0
Logger                   UILayer=    0  App=    0  Appex=    0
ComposableArchitecture   UILayer= 2140  App=    0  Appex=    0
```

---

## 정리

| 질문 | 답 |
|------|------|
| `.dynamic` 패키지로 바꾸면 공유 패키지가 UILayer 안에 복사되는가 (a)? | **아니다.** Xcode는 Dynamic Framework 타겟일 때와 똑같이 Domain, DataFlowDomain, Logger를 동적 프레임워크로 승격했다 (b) |
| UILayer만 쓰는 패키지(TCA 등)는? | 지금과 같이 UILayer 안에 static으로 들어간다. 앱 프로세스에서 UILayer만 쓰므로 문제없다 |
| 앱 프로세스 안에 같은 모듈이 두 벌 있는가? | 없다. 교집합 0 |
| 전환할 때 주의할 점 | 앱이 직접 링크하는 `.dynamic` product는 **Embed & Sign**이 필요하다. 빠지면 실기기·배포에서 `Library not loaded`로 크래시한다 |

결국 iOS에서 UILayer를 `.dynamic` 패키지로 바꿔도 **링킹 결과는 Xcode Dynamic Framework 타겟과 같다.** 달라진 것은 UILayer가 패키지 그래프 안으로 들어왔다는 형태뿐이다. iOS에는 App Bundle 밖에서 실행되는 HelperTool이 없으므로, 공유 패키지가 승격되는 것도 문제가 되지 않는다.

macOS와 iOS의 선택이 다른 이유를 한 줄로 정리하면 이렇다.

| 플랫폼 | UILayer 패키지 타입 | 이유 |
|------|------|------|
| macOS | automatic (static) | HelperTool이 App Bundle 밖에서 실행되므로 공유 패키지(Domain)가 승격되면 안 된다 |
| iOS | `.dynamic` | 승격돼도 모든 실행 단위가 App Bundle 안에 있어 문제없다. 기존 동적 구조를 그대로 유지한다 |
