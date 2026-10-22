---
layout: post
title: "Dynamic Framework 전파와 HelperTool 크래시 — SPM 링킹 결정이 멀티 타겟 프로젝트에 미치는 영향"
date: 2026-10-22
categories: [macOS]
description: "UILayerModule을 Dynamic Framework로 추가했을 뿐인데 HelperTool이 크래시했다. SPM의 워크스페이스 레벨 링킹 결정, Mach-O install name 변수, 프로세스별 Framework 접근성 차이를 분석하고 해결한 과정을 정리한다."
---

UILayerModule(Dynamic Framework)을 앱에 추가했을 뿐인데, 전혀 관련 없는 HelperTool이 크래시했다.

```
ASI found [dyld] (sensitive) 'Library not loaded: @rpath/Domain_17E53062B3BFDE_PackageProduct.framework/Versions/A/Domain_17E53062B3BFDE_PackageProduct
  Referenced from: /Library/PrivilegedHelperTools/com.pribit.application.packetgo.switch.sase.HelperTool
  Reason: no LC_RPATH's found'
```

dyld가 `@rpath`를 해석할 수 없어서 Framework 로딩에 실패한 것이다. 이 글에서는 이 문제의 원인을 분석하고 해결하기까지의 과정을 정리한다.

---

## 프로젝트 구조

```
App → UILayerModule(Dynamic Framework) → Domain(Swift Package - Dynamic)
App → SystemExtension(Network Extension) → Domain
App → Daemon(Privileged Helper Tool) → Domain
```

세 타겟 모두 Domain 패키지에 의존한다. UILayerModule을 추가하기 전에는 모든 타겟이 정상 동작했다.

---

## Mach-O Install Name 변수

RPATH 문제를 이해하려면 먼저 macOS의 dynamic library 경로 해석 방식을 알아야 한다.

macOS의 dynamic linker(dyld)는 Mach-O 바이너리의 `LC_LOAD_DYLIB` 명령에 기록된 경로로 Framework를 찾는다. 이 경로에는 세 가지 특수 변수를 사용할 수 있다.

| 변수 | 의미 | 예시 |
|------|------|------|
| `@executable_path` | 실행 파일이 위치한 디렉토리 | `App.app/Contents/MacOS/` |
| `@loader_path` | 현재 라이브러리를 로드한 바이너리의 디렉토리 | Framework 안의 바이너리 위치 |
| `@rpath` | 바이너리의 `LC_RPATH` 목록에서 순차 검색 | 여러 경로를 시도 가능 |

`@rpath`는 바이너리 자체에 `LC_RPATH` Load Command로 검색 경로 목록을 갖고 있어야 한다. 이 목록이 없으면 — 즉 `no LC_RPATH's found` — dyld는 Framework를 찾을 수 없다.

---

## 분석에 사용한 도구

### otool — Mach-O 바이너리 분석

```bash
# 바이너리가 링크한 라이브러리 목록 확인
otool -L [바이너리 경로]

# Load Commands 전체 확인 (RPATH 포함)
otool -l [바이너리 경로]

# RPATH만 필터링
otool -l [바이너리 경로] | grep -A 3 LC_RPATH
```

### lsof — 런타임 Framework 로딩 확인

```bash
# 특정 프로세스가 로드한 파일 확인
sudo lsof -p [PID]

# 특정 Framework만 필터링
sudo lsof -p [PID] | grep Domain
```

### ps — 프로세스 정보 확인

```bash
ps aux | grep [프로세스명]
```

---

## 분석 과정

### 1단계: 증상 파악

- **SystemExtension**: 정상 동작
- **HelperTool**: 크래시 발생
- **공통점**: 둘 다 Domain 패키지에 의존

같은 Framework를 사용하는데 왜 하나는 되고 하나는 안 될까?

### 2단계: SystemExtension의 RPATH 분석

```bash
otool -l /Library/SystemExtensions/.../Contents/MacOS/Extension | grep -A 3 LC_RPATH
```

```
cmd LC_RPATH
path /Applications/.../Build/Products/Debug/PackageFrameworks (offset 12)

cmd LC_RPATH
path @executable_path/../Frameworks (offset 12)

cmd LC_RPATH
path @executable_path/../../../../Frameworks (offset 12)
```

세 번째 RPATH의 경로를 계산하면:

```
SystemExtension 위치:
  /Library/SystemExtensions/.../Extension.systemextension/Contents/MacOS/Extension

@executable_path/../../../../Frameworks 해석:
  Extension        (실행파일)
  ../              → Contents/
  ../../           → Extension.systemextension/
  ../../../        → (SystemExtensions 또는 PlugIns 컨테이너)/
  ../../../../     → Contents/
  ../../../../Frameworks → App.app/Contents/Frameworks/
```

SystemExtension은 상대 경로로 App Bundle의 Frameworks 디렉토리에 접근할 수 있다.

### 3단계: SystemExtension의 실제 Framework 로딩 경로 확인

```bash
ps aux | grep ContentFilterData
sudo lsof -p 17147 | grep Domain
```

```
/private/var/folders/.../TemporaryItems/NSIRD_XCBuildService_Y181Yl/CleanBuildFolderInProgress/Debug/PackageFrameworks/Domain_17E53062B3BFDE_PackageProduct.framework
```

개발 환경에서 SystemExtension은 RPATH에 등록된 **Xcode 빌드 디렉토리 경로**(`/Applications/.../Build/Products/Debug/PackageFrameworks`)를 통해 Framework를 로딩하고 있었다. 이것은 첫 번째 RPATH 항목이 매칭된 것이다.

> 주의: 이 경로는 개발 환경에서만 유효하다. 배포 환경에서는 이 경로가 존재하지 않으므로, `@executable_path/../../../../Frameworks` 같은 상대 경로를 통해 App Bundle 내부의 Framework에 접근해야 한다.

### 4단계: HelperTool 상태별 비교

#### UILayerModule 없을 때

```bash
otool -l /Library/PrivilegedHelperTools/HelperTool | grep -A 5 LC_RPATH
# 결과: 아무것도 없음

otool -L /Library/PrivilegedHelperTools/HelperTool | grep Domain
# 결과: 아무것도 없음
```

- RPATH: 없음
- Domain 링킹: 없음 (Static 링킹 → 바이너리에 포함)
- 상태: **정상 동작**

#### UILayerModule 있을 때

```bash
otool -l /Library/PrivilegedHelperTools/HelperTool | grep -A 5 LC_RPATH
# 결과: 아무것도 없음

otool -L /Library/PrivilegedHelperTools/HelperTool | grep Domain
# 결과: @rpath/Domain_17E53062B3BFDE_PackageProduct.framework/...
```

- RPATH: 없음
- Domain 링킹: `@rpath/Domain_xxx.framework` (Dynamic)
- 상태: **크래시** — `@rpath`를 해석할 `LC_RPATH` 항목이 없음

**핵심 발견**: UILayerModule을 추가하자 HelperTool의 Domain 링킹 방식이 Static에서 Dynamic으로 바뀌었다. 그런데 RPATH는 설정되지 않았다.

---

## 근본 원인: SPM의 워크스페이스 레벨 링킹 결정

이 문제의 근본 원인은 Xcode의 빌드 시스템이 아니라 **Swift Package Manager의 링킹 타입 결정 방식**에 있다.

### SPM의 패키지 product 타입 결정

Swift Package에서 library의 타입을 `.auto`로 선언하면(또는 명시하지 않으면), SPM이 빌드 시점에 static과 dynamic 중 하나를 결정한다.

```swift
// Package.swift
let package = Package(
    name: "Domain",
    products: [
        .library(name: "Domain", targets: ["Domain"])
        // type을 명시하지 않으면 .auto — SPM이 결정
    ],
    ...
)
```

### 왜 워크스페이스 전체에 전파되는가

SPM은 **동일한 패키지가 하나의 워크스페이스 안에서 static과 dynamic으로 동시에 링크되는 상황을 허용하지 않는다.** 만약 동일한 패키지가 두 가지 방식으로 동시에 링크되면, 심볼이 중복 정의되어 런타임에 예측 불가능한 동작이 발생할 수 있기 때문이다.

따라서 SPM의 결정 규칙은 다음과 같다:

1. 워크스페이스 내에서 **하나의 타겟이라도 패키지를 dynamic으로 요구하면**, 해당 패키지는 **모든 타겟에서 dynamic으로 링크**된다.
2. UILayerModule(Dynamic Framework)이 Domain을 의존하는 순간, Domain은 dynamic으로 결정된다.
3. HelperTool도 Domain에 의존하므로, Domain을 dynamic으로 링크하게 된다.

```
변경 전: UILayerModule 없음
┌──────────────┐        ┌──────────────────────────────────────┐
│   HelperTool │───────▶│ Domain (SPM 결정: Static → 바이너리 포함) │
└──────────────┘        └──────────────────────────────────────┘

변경 후: UILayerModule(Dynamic) 추가
┌──────────────────────────┐      ┌────────────────────────────────────┐
│ UILayerModule (Dynamic)  │─────▶│ Domain (SPM 결정: Dynamic으로 통일) │
└──────────────────────────┘      └────────────────────────────────────┘
                                         ▲
┌──────────────┐                         │
│  HelperTool  │─────────────────────────┘
│ (RPATH 없음) │  @rpath/Domain.framework → 해석 실패 → 크래시
└──────────────┘
```

### HelperTool에 RPATH가 없는 이유

HelperTool(Privileged Helper Tool)은 `/Library/PrivilegedHelperTools/`에 설치되어 독립적으로 실행된다. App Bundle 바깥에 위치하므로 `@executable_path/../Frameworks` 같은 상대 경로로는 App의 Framework에 접근할 수 없다.

Xcode도 이 상황을 알고 있어서, HelperTool 타겟에는 기본적으로 RPATH를 설정하지 않는다. Static 링킹이라면 RPATH가 필요 없기 때문에 문제가 없다. 하지만 SPM이 Domain을 dynamic으로 전환해버리면, RPATH 없이 `@rpath` 경로를 해석해야 하는 모순이 발생한다.

### 프로세스별 Framework 접근성

| 프로세스 | 실행 위치 | App Bundle 접근 | RPATH 설정 |
|----------|-----------|-----------------|------------|
| App | `App.app/Contents/MacOS/` | 직접 접근 가능 | Xcode가 자동 설정 |
| SystemExtension | `/Library/SystemExtensions/` | 상대 경로로 접근 가능 | Xcode가 자동 설정 |
| HelperTool | `/Library/PrivilegedHelperTools/` | 접근 불가 | 설정되지 않음 |

SystemExtension은 App Bundle 내부(`App.app/Contents/PlugIns/` 또는 `Library/SystemExtensions/`)에서 상대 경로로 App의 Frameworks 디렉토리에 접근할 수 있다. 개발 환경에서는 Xcode 빌드 디렉토리 경로가 RPATH에 포함되어 있어서, 빌드 산출물 디렉토리에서 직접 Framework를 로딩한다.

반면 HelperTool은 App Bundle과 무관한 시스템 경로에 설치되어, 어떤 상대 경로로도 App의 Framework에 도달할 수 없다.

---

## 해결: UILayerModule을 Static Framework로 변경

### 변경 전

```
App → UILayerModule(Dynamic) → Domain(Dynamic으로 통일)
                                    ↑
HelperTool ─────────────────────────┘ @rpath 해석 실패 → 크래시
```

### 변경 후

```
App → UILayerModule(Static) → Domain
                                ↑
HelperTool ─────────────────────┘ SPM이 Static으로 결정 → 바이너리에 포함
```

UILayerModule을 Static Framework로 변경하면, 워크스페이스 내에서 Domain을 dynamic으로 요구하는 타겟이 사라진다. SPM은 Domain의 링킹 타입을 다시 static으로 결정하고, HelperTool은 Domain 코드를 바이너리에 포함하게 된다.

### 해결 검증

```bash
# Dynamic 링킹 확인 — 없어야 정상
otool -L /Library/PrivilegedHelperTools/HelperTool | grep Domain
# 결과: 없음 (Static 링킹됨)

# 런타임 Framework 로딩 확인 — 없어야 정상
sudo lsof -p [PID] | grep Domain
# 결과: 없음 (바이너리에 포함됨)
```

Domain 코드가 HelperTool 바이너리 자체에 포함되어, Framework 파일을 별도로 로딩할 필요가 없다. RPATH 문제가 원천적으로 제거된다.

---

## 정리

이 문제의 본질은 **SPM의 링킹 타입 결정이 워크스페이스 전체에 전파되는 동작**과 **HelperTool의 실행 환경이 App Bundle에서 격리되어 있다는 사실**의 충돌이다.

| 항목 | Static 링킹 | Dynamic 링킹 |
|------|-------------|--------------|
| 코드 위치 | 바이너리에 포함 | 별도 Framework 파일 |
| RPATH 필요 | 불필요 | 필수 |
| 런타임 의존성 | 없음 | Framework 파일 접근 필요 |
| 의존성 전파 | 타겟별 격리 | 워크스페이스 전체에 영향 |
| 바이너리 크기 | 증가 (코드 포함) | 작음 (참조만) |

멀티 타겟 macOS 프로젝트에서 Dynamic Framework를 사용할 때는, **각 타겟의 실행 위치와 Framework 접근 가능 여부**를 반드시 확인해야 한다. 특히 HelperTool처럼 App Bundle 바깥에서 실행되는 타겟이 있다면, SPM 패키지의 링킹 타입 전파가 의도치 않은 크래시를 유발할 수 있다.
