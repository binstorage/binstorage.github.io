---
layout: post
title: "앱 번들의 openssl.framework는 왜 비어 있을까 — static으로 링크된 바이너리 프레임워크와 Xcode의 stub 주입"
date: 2026-11-10
categories: [macOS]
description: "PacketGO.app/Contents/Frameworks에 openssl.framework가 dylib으로 들어 있지만, 실제 OpenSSL 코드는 앱과 시스템 익스텐션 실행 파일 안에 static으로 링크되어 있다. file, otool, nm으로 프레임워크가 비어 있음을 확인하고, 빌드 로그에서 Xcode가 static 바이너리를 빼고 /dev/null로 만든 stub dylib을 주입하는 과정을 추적한다."
---

> 이 글은 [정적 라이브러리 vs 동적 라이브러리 — 빌드와 런타임에서 실제로 일어나는 일]({% post_url 2026-10-29-static-vs-dynamic-library-build-runtime %}), [iOS UILayer를 .dynamic 패키지로]({% post_url 2026-11-10-ios-uilayer-dynamic-package-promotion %})와 같은 도구(otool, nm)를 사용한다.

PacketGO.app 번들을 열어 보면 `Contents/Frameworks`에 `openssl.framework`가 있다.

```
PacketGO.app/Contents/Frameworks/
├── libswiftCompatibilitySpan.dylib
├── openssl.framework
└── WebSocketModule.framework
```

`file`로 보면 dylib이다.

```bash
$ file PacketGO.app/Contents/Frameworks/openssl.framework/openssl
openssl.framework/openssl: Mach-O universal binary with 1 architecture: [arm64:Mach-O 64-bit dynamically linked shared library arm64]
```

그렇다면 OpenSSL은 동적으로 링크된 걸까? Domain 같은 다른 SPM 패키지는 모두 static으로 들어갔는데, OpenSSL만 dynamic으로 결정된 이유가 궁금했다.

결론부터 말하면 **OpenSSL도 static으로 링크됐다.** 앱 번들의 `openssl.framework`는 코드가 하나도 없는 **빈 stub**이고, 아무도 로드하지 않는다.

---

## 프로젝트 구조

```
App ──────────────▶ UILayer ──▶ DependencyDomain ──▶ PGxFVPN ──▶ openssl-apple
ContentFilterData ─▶ PGxFVPN ──▶ openssl-apple
```

PGxFVPN의 Objective-C 타겟이 OpenSSL을 사용한다.

```swift
// Module/PGxFVPN/Package.swift
.target(
    name: "CPGxFVPNSSLVPNProtocol",
    dependencies: [
        "CPGxFVPNCore",
        "CPGxFVPNSSLVPNCore",
        "openssl-apple"
    ]),
```

`openssl-apple`은 로컬 패키지이고, 미리 빌드한 XCFramework를 `binaryTarget`으로 제공한다.

```swift
// Module/openssl-apple/Package.swift
let artifactVersion: String = "3.5.7"

let package = Package(
    name: "openssl-apple",
    products: [
        .library(name: "openssl-apple", targets: ["openssl"])
    ],
    targets: [
        .binaryTarget(
            name: "openssl",
            path: "Artifacts/\(artifactVersion)/openssl.xcframework"
        )
    ]
)
```

---

## 사용하는 도구

| 도구 | 보는 것 | 이 글에서 답하는 질문 |
|------|------|------|
| `file` | 파일 형식 | static 아카이브(`ar archive`)인가, dylib인가 |
| `lipo -info` | 아키텍처 | 어떤 CPU 아키텍처가 들어 있는가 |
| `otool -L` | 로드 명령(`LC_LOAD_DYLIB`, `LC_ID_DYLIB`) | 실행할 때 이 프레임워크를 **불러오는** 바이너리가 있는가 |
| `otool -l` | 모든 로드 명령과 섹션 | dylib 안에 **코드(`__text`)가 있는가** |
| `nm` | 심볼 테이블 | OpenSSL 함수가 **어느 바이너리 안에 정의되어** 있는가 |
| `codesign -dv` | 서명 정보 | 이 파일이 빌드 중에 서명된 것인가 |

`nm`에서 사용하는 옵션은 다음과 같다.

| 옵션 | 의미 |
|------|------|
| `-g` | 외부에 공개된(global) 심볼만 |
| `-U` | 이 바이너리 안에 **정의된** 심볼만 (미정의 심볼 제외) |
| `-m` | Mach-O 형식으로 출력. 정의된 심볼은 섹션(`(__TEXT,__text)`)을, 미정의 심볼은 `(from 라이브러리)`를 표시한다 |

`nm` 출력의 두 번째 열은 심볼 종류다. `T`는 이 바이너리의 `__text` 섹션에 **정의된** 함수이고, `U`는 **미정의**, 즉 다른 바이너리에서 가져와야 하는 심볼이다.

---

## 검증 1: 원본 XCFramework는 static이다

먼저 `binaryTarget`이 가리키는 XCFramework의 macOS 슬라이스를 확인한다.

```bash
X=Module/openssl-apple/Artifacts/3.5.7/openssl.xcframework/macos-arm64_x86_64/openssl.framework

$ file $X/Versions/A/openssl
Mach-O universal binary with 2 architectures: [x86_64:current ar archive random library] [arm64]
 (for architecture x86_64):  current ar archive
 (for architecture arm64):   current ar archive

$ lipo -info $X/Versions/A/openssl
Architectures in the fat file: ... are: x86_64 arm64

$ ls -l $X/Versions/A/openssl
-rw-r--r--  ... 20867216  openssl
```

`current ar archive`는 `.o` 파일을 묶은 **static 라이브러리**라는 뜻이다. 크기는 약 20MB다.

`.framework`라는 이름 때문에 dynamic이라고 오해하기 쉽지만, **프레임워크는 번들 형식일 뿐**이다. 안에 든 바이너리가 static 아카이브면 static 프레임워크다.

---

## 검증 2: 앱 번들의 openssl.framework는 비어 있다

### 크기

```bash
$ ls -l PacketGO.app/Contents/Frameworks/openssl.framework/Versions/A/openssl
-rwxr-xr-x  ... 51392  openssl
```

원본은 20MB인데 앱에 들어간 것은 **51KB**다. OpenSSL 전체가 들어 있을 수 없는 크기다.

### 코드 섹션 (`otool -l`)

```bash
$ otool -l PacketGO.app/Contents/Frameworks/openssl.framework/openssl | grep -B1 -A5 'sectname __text'
Section
  sectname __text
   segname __TEXT
      addr 0x0000000000000298
      size 0x0000000000000000
    offset 664
```

실행 코드가 들어가는 `__text` 섹션의 크기가 **0**이다.

### 심볼 (`nm`)

```bash
$ nm -gU PacketGO.app/Contents/Frameworks/openssl.framework/openssl
.../openssl.framework/openssl: no symbols
```

외부에 공개한 심볼이 **하나도 없다.** 다른 바이너리가 이 dylib에서 가져갈 수 있는 함수가 없다는 뜻이다.

### install name과 의존성 (`otool -L`, `otool -l`)

```bash
$ otool -L PacketGO.app/Contents/Frameworks/openssl.framework/openssl
openssl.framework/openssl (architecture arm64):
	@rpath/openssl.framework/openssl (compatibility version 0.0.0, current version 0.0.0)
	/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1359.40.3)

$ otool -l PacketGO.app/Contents/Frameworks/openssl.framework/openssl | grep -A3 LC_ID_DYLIB
          cmd LC_ID_DYLIB
      cmdsize 64
         name @rpath/openssl.framework/openssl (offset 24)
```

첫 줄은 의존성이 아니라 이 dylib 자신의 install name(`LC_ID_DYLIB`)이다. 버전이 `0.0.0`이고 의존성은 `libSystem` 하나뿐이다. 정상적인 OpenSSL 빌드라면 보통 이렇게 나오지 않는다.

### 배포 타깃

```bash
$ otool -l PacketGO.app/Contents/Frameworks/openssl.framework/openssl | grep -A3 LC_BUILD_VERSION
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 15.0
```

`minos 15.0`은 **앱의 배포 타깃**과 같다. OpenSSL 빌드 설정이 아니라 앱 빌드 설정으로 만들어진 파일이라는 단서다.

---

## 검증 3: 아무도 openssl.framework를 로드하지 않는다

앱 번들 안의 모든 실행 바이너리에서 `otool -L`로 openssl을 찾는다.

```bash
$ otool -L PacketGO.app/Contents/MacOS/PacketGO.debug.dylib | grep -i openssl
(출력 없음)

$ otool -L PacketGO.app/Contents/Library/SystemExtensions/*ContentFilterData*.systemextension/Contents/MacOS/* | grep -i openssl
(출력 없음)
```

`LC_LOAD_DYLIB`에 `openssl.framework`를 기록한 바이너리가 없다. dyld는 실행할 때 이 프레임워크를 **열지 않는다.**

> Debug 빌드에서는 앱의 실제 코드가 `PacketGO`가 아니라 `PacketGO.debug.dylib`에 들어 있다(`ENABLE_DEBUG_DYLIB`). 그래서 `MacOS/PacketGO`가 아니라 `PacketGO.debug.dylib`을 확인한다.

---

## 검증 4: OpenSSL 코드는 실행 파일 안에 static으로 들어 있다

그렇다면 OpenSSL 함수는 어디에 있을까? `nm -m`으로 앱 바이너리에서 대표적인 OpenSSL 함수를 찾는다.

```bash
$ nm -m PacketGO.app/Contents/MacOS/PacketGO.debug.dylib | grep -E '_(SSL_CTX_new|EVP_EncryptInit_ex)$'
0000000001313128 (__TEXT,__text) external _EVP_EncryptInit_ex
0000000001480df0 (__TEXT,__text) external _SSL_CTX_new
```

`(__TEXT,__text)`는 이 함수가 **이 바이너리의 코드 섹션 안에 정의되어 있다**는 뜻이다. 다른 곳에서 가져오는 함수였다면 `(undefined) external _SSL_CTX_new (from openssl)`처럼 나왔을 것이다.

정말 `from openssl`로 표시된 미정의 심볼이 없는지, 그리고 OpenSSL 함수가 몇 개 들어 있는지도 센다.

```bash
# openssl에서 가져오는 미정의 심볼
$ nm -m PacketGO.app/Contents/MacOS/PacketGO.debug.dylib | grep -c 'from openssl'
0

# 앱 바이너리 안에 정의된 OpenSSL 함수 (SSL_, EVP_, OPENSSL_, HMAC_, BIO_, X509_ 접두어)
$ nm -gU PacketGO.app/Contents/MacOS/PacketGO.debug.dylib | grep -cE ' T _(SSL|EVP|OPENSSL|HMAC|BIO|X509)_'
2332
```

| 확인 | 결과 | 의미 |
|------|------|------|
| `from openssl` 미정의 심볼 | 0개 | openssl.framework에서 가져오는 함수가 없다 |
| 앱 안에 정의된 OpenSSL 함수 | 2,332개 | OpenSSL 코드가 앱 바이너리에 **복사되어** 있다 |

static 아카이브를 링크하면 링커는 필요한 `.o` 멤버를 꺼내 실행 파일 안에 복사한다. 그래서 OpenSSL 함수가 `T`(정의됨)로 나타나고, 런타임에 openssl.framework가 필요 없다.

---

## 검증 5: ContentFilterData 시스템 익스텐션도 같은 구조다

ContentFilterData 시스템 익스텐션도 PGxFVPN을 사용하므로 같은 방법으로 확인한다.

```bash
C=com.example.app.ContentFilterData-macOS.systemextension
E=$C/Contents/MacOS/com.example.app.ContentFilterData-macOS

$ ls $C/Contents/Frameworks
openssl.framework
PGDFF.framework

# 1. openssl.framework를 로드하는가
$ otool -L $E | grep -i openssl
(출력 없음)

# 2. PGxFVPN 코드가 들어 있는가
$ nm $E | grep -cE 'PGxFVPN|CPGxF'
11022

# 3. OpenSSL 코드가 들어 있는가
$ nm -gU $E | grep -cE ' T _(SSL|EVP|OPENSSL|HMAC|BIO|X509)_'
2332

$ nm -m $E | grep -E '_SSL_CTX_new$'
00000001006cb170 (__TEXT,__text) external _SSL_CTX_new

# 4. 번들 안의 openssl.framework
$ ls -l $C/Contents/Frameworks/openssl.framework/Versions/A/openssl
-rwxr-xr-x  ... 51392  openssl

$ otool -l $C/Contents/Frameworks/openssl.framework/openssl | grep -A4 'sectname __text' | grep ' size'
      size 0x0000000000000000
```

| 항목 | 결과 |
|------|------|
| PGxFVPN 포함 | static으로 포함 (심볼 11,022개) |
| OpenSSL 코드 | 실행 파일 안에 static으로 포함 (함수 2,332개) |
| `otool -L`에 openssl | 없음 |
| `Contents/Frameworks/openssl.framework` | 앱과 같은 51KB 빈 stub |

앱 번들에 임베드된 시스템 익스텐션(`PacketGO.app/Contents/Library/SystemExtensions/…`)도 결과가 같다.

---

## 빌드 로그로 확인하기: 누가 빈 dylib을 만들었나

바이너리 검증으로 stub이라는 것은 확인했지만, **누가 이 파일을 만들었는지**는 빌드 로그로 확인해야 한다.

### 기존 로그에는 남아 있지 않았다

Xcode 빌드 로그는 DerivedData의 `Logs/Build/*.xcactivitylog`에 gzip 압축 형태로 남는다.

```bash
DD=~/Library/Developer/Xcode/DerivedData/PacketGO-xxxx
for L in $DD/Logs/Build/*.xcactivitylog; do
  gunzip -c "$L" | tr '\r' '\n' | grep -a -o '.\{0,200\}openssl\.framework.\{0,150\}' | head
done
```

남아 있는 로그에서는 두 가지만 찾을 수 있었다.

- 헤더 include: `CryptoCTR.m`이 `Build/Products/Debug/openssl.framework/Headers/evp.h`를 include한 기록
- 링크: `PacketGO.debug.dylib`과 ContentFilterData의 링크 명령에 `-framework openssl`

stub이 만들어진 시각의 빌드 로그는 지워져 있었다. 증분 빌드에서는 이미 만들어진 stub을 다시 만들지 않으므로 로그에 나타나지도 않는다.

### 새 DerivedData로 클린 빌드

기존 DerivedData를 건드리지 않도록 **새 DerivedData 경로**를 지정해 클린 빌드한다.

```bash
DD=/tmp/dd_openssl     # 새 DerivedData 경로
xcodebuild -project PacketGO/PacketGO.xcodeproj -scheme PacketGO -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath $DD \
  -clonedSourcePackagesDirPath ~/Library/Developer/Xcode/DerivedData/PacketGO-xxxx/SourcePackages \
  CODE_SIGNING_ALLOWED=NO \
  build > openssl.log 2>&1
```

| 옵션 | 이유 |
|------|------|
| `-derivedDataPath $DD` | 빈 폴더에서 시작해서 모든 단계가 로그에 찍히게 한다 |
| `-clonedSourcePackagesDirPath` | TCA 같은 원격 패키지를 다시 받지 않도록 기존 체크아웃을 재사용한다. openssl-apple은 로컬 패키지라 결과에 영향이 없다 |
| `CODE_SIGNING_ALLOWED=NO` | 시스템 익스텐션 프로비저닝 문제로 빌드가 실패하지 않게 서명을 끈다. 그래서 stub 크기가 33KB로 나온다. 실제 앱의 51KB와의 차이는 팀 서명이다 |

`xcodebuild` 로그는 각 작업이 `작업이름 대상 경로`로 시작하는 줄로 나뉜다. openssl이 들어간 작업 줄만 뽑는다.

```bash
$ grep -nE '^[A-Z][A-Za-z]+ .*openssl' openssl.log
2613:ProcessXCFramework .../openssl-apple/Artifacts/3.5.7/openssl.xcframework $DD/Build/Products/Debug/openssl.framework macos
15136:Copy $DD/Build/Products/Debug/com.example.app.ContentFilterData-macOS.systemextension/Contents/Frameworks/openssl.framework .../openssl.xcframework/macos-arm64_x86_64/openssl.framework
17976:Copy $DD/Build/Products/Debug/PacketGO.app/Contents/Frameworks/openssl.framework .../openssl.xcframework/macos-arm64_x86_64/openssl.framework (in target 'PacketGO' from project 'PacketGO')
```

세 단계가 나온다.

### ① ProcessXCFramework — static 슬라이스를 꺼낸다

```bash
$ sed -n '2613,2615p' openssl.log
ProcessXCFramework .../openssl.xcframework $DD/Build/Products/Debug/openssl.framework macos
    builtin-process-xcframework --xcframework .../openssl.xcframework \
      --platform macos --library-identifier macos-arm64_x86_64 --target-path $DD/Build/Products/Debug
```

XCFramework에서 macOS 슬라이스를 `Build/Products/Debug/openssl.framework`로 꺼낸다.

```bash
$ file $DD/Build/Products/Debug/openssl.framework/Versions/A/openssl
Mach-O universal binary with 2 architectures: [x86_64:current ar archive random library] [arm64]
```

이 파일은 여전히 **static 아카이브**다. 각 타깃은 링크 단계에서 `-F $DD/Build/Products/Debug -framework openssl`로 이 아카이브를 링크한다. 그래서 OpenSSL 코드가 `PacketGO.debug.dylib`과 ContentFilterData 실행 파일 안에 복사된다(검증 4, 5).

### ② Copy — 바이너리를 빼고 번들만 복사한다

```bash
$ sed -n '17976,17978p' openssl.log
Copy $DD/.../PacketGO.app/Contents/Frameworks/openssl.framework .../openssl.xcframework/macos-arm64_x86_64/openssl.framework (in target 'PacketGO' from project 'PacketGO')
    cd PacketGO
    builtin-copy -exclude .DS_Store -exclude CVS -exclude .svn -exclude .git -exclude .hg \
      -exclude Headers -exclude PrivateHeaders -exclude Modules -exclude \*.tbd \
      -resolve-src-symlinks -remove-static-executable \
      .../openssl.xcframework/macos-arm64_x86_64/openssl.framework $DD/.../PacketGO.app/Contents/Frameworks
```

Embed 단계에서 프레임워크를 앱 번들로 복사한다. 두 가지 옵션이 중요하다.

| 옵션 | 동작 |
|------|------|
| `-exclude Headers -exclude Modules …` | 헤더와 모듈 맵은 런타임에 필요 없으므로 뺀다 |
| `-remove-static-executable` | 프레임워크 안의 바이너리가 **static 아카이브면 복사하지 않는다** |

결과적으로 앱 번들에는 `Info.plist`, `Resources` 같은 번들 구조만 남고 바이너리가 없는 **codeless framework**가 된다.

### ③ stub 주입 — /dev/null로 빈 dylib을 만든다

같은 Copy 작업 바로 아래에 이어서 찍힌다.

```bash
$ sed -n '17979,17982p' openssl.log
note: Injecting stub binary into codeless framework (in target 'PacketGO' from project 'PacketGO')
    clang -isysroot .../MacOSX27.2.sdk -x c -c /dev/null -target arm64-apple-macos15.0 -o .../arm64-apple.o
    clang -isysroot .../MacOSX27.2.sdk -dynamiclib -Xlinker -adhoc_codesign -target arm64-apple-macos15.0 \
      -install_name @rpath/openssl.framework/openssl -o .../arm64-apple .../arm64-apple.o
    lipo -create -output $DD/.../PacketGO.app/Contents/Frameworks/openssl.framework/Versions/A/openssl .../arm64-apple
```

Xcode가 **"codeless framework에 stub 바이너리를 주입한다"**고 직접 알려 준다. 과정은 이렇다.

1. `clang -x c -c /dev/null`: 빈 입력(`/dev/null`)을 C로 컴파일해서 **내용 없는 오브젝트 파일**을 만든다
2. `clang -dynamiclib … -install_name @rpath/openssl.framework/openssl`: 그 오브젝트로 dylib을 만든다. install name은 원래 프레임워크 경로와 같게 설정한다
3. `lipo -create`: 프레임워크의 바이너리 자리에 넣는다

검증 2에서 본 stub의 특징이 이 명령과 하나씩 맞아떨어진다.

| 검증 2에서 본 특징 | 빌드 로그의 원인 |
|------|------|
| `__text` 크기 0, `nm` 결과 `no symbols` | `/dev/null`을 컴파일했다 |
| `minos 15.0` | `-target arm64-apple-macos15.0` (앱의 배포 타깃) |
| arm64만 있음 | 활성 아키텍처 하나로만 빌드했다 |
| install name `@rpath/openssl.framework/openssl`, 버전 0.0.0 | `-install_name`만 지정하고 버전은 지정하지 않았다 |
| 의존성이 `libSystem`뿐 | 빈 dylib을 만들 때 링커가 기본으로 넣는다 |

ContentFilterData 쪽(15136번째 줄)도 같은 Copy와 stub 주입 과정을 거친다. 새로 빌드한 결과물에서도 세 곳의 stub이 모두 같은 크기다.

```bash
$ find $DD/Build/Products/Debug -path '*Frameworks/openssl.framework/Versions/A/openssl' -exec ls -l {} \;
-rwxr-xr-x  ... 33128  .../PacketGO.app/Contents/Frameworks/openssl.framework/Versions/A/openssl
-rwxr-xr-x  ... 33128  .../ContentFilterData-macOS.systemextension/Contents/Frameworks/openssl.framework/Versions/A/openssl
-rwxr-xr-x  ... 33128  .../PacketGO.app/Contents/Library/SystemExtensions/...ContentFilterData-macOS.systemextension/Contents/Frameworks/openssl.framework/Versions/A/openssl
```

실제 앱(서명 포함)에서는 팀 서명이 붙어 51KB가 된다.

```bash
$ codesign -dv PacketGO.app/Contents/Frameworks/openssl.framework/openssl 2>&1 | grep -E 'Identifier|Format'
Identifier=org.openssl.OpenSSL
Format=bundle with Mach-O universal (arm64)
TeamIdentifier=XXXXXXXXXX
```

---

## 왜 framework가 있는데 비어 있고, 코드는 static으로 들어갔나

전체 흐름을 정리하면 이렇다.

```
openssl.xcframework (macOS 슬라이스 = static ar archive, 20MB)
        │
        ├─① ProcessXCFramework ──▶ Products/Debug/openssl.framework (static 그대로)
        │                                 │
        │                                 └─ 링크: -framework openssl
        │                                      ├─▶ PacketGO.debug.dylib 안에 OpenSSL 코드 복사
        │                                      └─▶ ContentFilterData 실행 파일 안에 OpenSSL 코드 복사
        │
        └─② Copy (Embed, -remove-static-executable) ──▶ 바이너리 없는 번들
                 └─③ stub 주입 (/dev/null → dylib) ──▶ Frameworks/openssl.framework (빈 dylib)
```

| 질문 | 답 |
|------|------|
| OpenSSL은 dynamic으로 링크됐는가? | **아니다.** XCFramework 안의 바이너리가 static 아카이브이므로 링커가 코드를 각 실행 파일 안에 복사했다 |
| 그런데 왜 `Frameworks`에 openssl.framework가 있는가? | SPM `binaryTarget`이 `.framework` 형태라서 Xcode가 프레임워크 번들을 **임베드 대상**으로 취급한다 |
| 왜 비어 있는가? | Embed 단계의 `-remove-static-executable`이 static 바이너리를 빼고, 그 자리에 Xcode가 `/dev/null`로 만든 **stub dylib**을 넣는다 |
| 왜 하필 dylib 모양의 stub인가? | 로그에는 이유가 나오지 않는다. 바이너리 없는 `.framework` 번들은 코드 서명과 번들 검증에서 문제가 될 수 있으므로, 번들 형태를 유지하려는 것으로 추정한다 |
| 런타임에 영향이 있는가? | 없다. 어떤 바이너리도 `LC_LOAD_DYLIB`로 이 프레임워크를 참조하지 않으므로 dyld가 로드하지 않는다 |

`.framework`라는 껍데기만 보고 dynamic이라고 판단하면 안 된다. **링크 방식은 프레임워크 안의 바이너리 형식이 결정한다.** 확인할 때는 다음 순서를 따르면 된다.

1. `file`: 원본 바이너리가 `ar archive`(static)인가, `dynamically linked shared library`인가
2. `otool -L`: 실행 파일이 그 프레임워크를 `LC_LOAD_DYLIB`로 참조하는가
3. `nm -m`: 함수가 `(__TEXT,__text)`로 정의되어 있는가, `(from …)`으로 가져오는가
4. 빌드 로그: `ProcessXCFramework`, `Copy`(`-remove-static-executable`), `Injecting stub binary` 단계

---

## 참고: stub을 없애고 싶다면

stub은 동작에 영향이 없지만, 앱 번들에 불필요한 서명 대상이 하나 생긴다. 없애려면 OpenSSL XCFramework를 `.framework` 대신 **라이브러리 + 헤더** 형태로 만들면 된다.

```bash
xcodebuild -create-xcframework \
  -library libopenssl.a -headers include/ \
  -output openssl.xcframework
```

이렇게 만들면 XCFramework 안에 프레임워크 번들이 없으므로 Xcode가 임베드할 대상도 생기지 않는다. 링크 결과(OpenSSL 코드가 실행 파일 안에 static으로 들어가는 것)는 같다.
