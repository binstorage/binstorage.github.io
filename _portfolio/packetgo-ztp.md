---
title: "PacketGo OS — macOS·iOS 에이전트 아키텍처 설계 및 개발"
period: "2025.08 - 진행 중"
description: "이전 ZTNA 프로젝트의 구조적 문제를 분석해 차세대 N2SF 플랫폼 PacketGo OS의 macOS·iOS 에이전트 아키텍처 설계를 주도했습니다. 타겟별 모듈화, TCA, 프로토콜 기반 의존성 주입을 적용하고, 두 Network Extension Provider를 결합해 패킷 제어를 구현했습니다."
skills: [Swift, C++, Objective-C++, Network Extension, System Extension, App Extension, XPC, Privileged Daemon, Developer ID, Notarization, Installer Package (pkg), TCA, Tuist, Swift Package Manager, XCTest]
order: 1
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 연구소 모바일 파트 |
| 기간 | 2025.08 - 진행 중 |
| 인원 | 2명 |
| 담당 | macOS·iOS 에이전트 아키텍처 설계, 각 모듈 구현|
| 플랫폼 | macOS, iOS |

**PacketGo OS**는 회사의 차세대 N2SF 플랫폼입니다.

PacketGo OS 설계는 2년간 개발·유지보수한 ZTNA 프로젝트([PacketGO Switch]({{ '/portfolio/packetgo-switch/' | relative_url }}) → [PRIBIT Connect 2.6]({{ '/portfolio/packetgo-switch-advancement/' | relative_url }}))에서 겪은 문제를 분석하는 것에서 출발했습니다.

---

## 배경 및 목표

ZTNA 프로젝트에서 겪은 문제는 다음과 같았습니다.

| 문제점 | 영향 |
| --- | --- |
| 하나의 프로젝트에 모든 타겟이 존재 | 수정 범위를 예측하기 어렵고 사이드 이펙트 발생 | 빌드 시간 증가
| Raw Packet Header 정보 부재 | 고도화된 PacketGo OS의 요구사항을 맞추려면 Raw Packet Header를 탐지해야 함 |
| 앱 ↔ Extension 정보 교환을 App Group 공유 파일로 처리 | 메시지마다 파일 쓰기 → 변경 감지 → ack 파일까지 거쳐 순차 처리, 지연 발생 |
| 책임 분리 부족, MVI 패턴에서 비대해진 ViewModel | 유지보수 어려움 |
| 테스트할 수 없는 구조 | Preview, Unit Test 불가 → 모든 확인을 실기기에서 수행 |

**목표**: 이 문제를 구조적으로 해결해 유지보수와 테스트가 쉬운 에이전트를 만들고, 품질 인증과 고객사 대응 속도를 높이는 것

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++, Objective-C++ |
| Architecture | TCA (The Composable Architecture), 프로토콜 지향 의존성 주입 |
| Modularization | Swift Package Manager, Framework, Build Phase |
| Apple Platform | System Extension (NEFilterDataProvider + NEFilterPacketProvider, NEPacketTunnelProvider), Privileged Helper Tool, XPC, App Extension |
| Test | XCTest (Unit Test), Micro App, SwiftUI Preview |

---

## 아키텍처

```
[macOS — PacketGo_3.0]
PacketGO.app (SwiftUI · TCA) ── 구현체 생성 · UILayer에 주입
 ├─▶ UILayer (SPM, TCA Feature) ─▶ Domain 프로토콜에만 의존
 ├─▶ Module 구현체 : Data · PacketAuthentication · PGxFVPN · Logger ─▶ Domain
 ├─XPC─▶ System Extension (ControlFilterData-macOS)
 │        NEFilterDataProvider · NEFilterPacketProvider · NEPacketTunnelProvider
 │        └─▶ 패킷 제어 판단 모듈 (C++, 패킷 허용/차단 판단) · PGxFVPN
 └─XPC─▶ PrivilegedHelper (Privileged Daemon) ─▶ PacketAuthentication
Domain : Domain (프로토콜 · 모델 · 매니저) · DependencyDomain (구현체 주입)
Test   : UILayerMicroApp · 패킷 제어 판단 모듈 테스트 프로그램

[iOS — PacketGo_3.0_iOS]
PacketGO.app (SwiftUI · TCA) ── 구현체 생성 · UILayer에 주입
 ├─▶ UILayer (SPM, TCA Feature) ─▶ Domain 프로토콜에만 의존
 ├─▶ Module 구현체 : Data · PacketAuthentication · FIDOModule · PGxFVPN ─▶ Domain
 └─Unix Socket─▶ PGxFSSLVPN.appex (App Extension, NEPacketTunnelProvider)
                  └─▶ PGxFVPN ─▶ 패킷 제어 판단 모듈 (C++)
Domain : Domain · DataFlowDomain · Logger
Test   : UILayerMicroApp
```

- **타겟별 모듈 분리**: App, SystemExtension, HelperTool이 각자의 책임만 갖고, 공통 비즈니스 로직은 `Domain` 패키지에 둡니다.
- **iOS 앱 ↔ App Extension 통신**: 앱과 App Extension은 Unix Socket으로 필터링할 패킷 헤더 정보 등을 주고받습니다.
- **Domain 프로토콜 추상화**: 비즈니스 로직을 프로토콜로 정의하고, 구현체는 의존성 주입으로 연결합니다. UILayer는 Domain 프로토콜만 알고, Data · PacketAuthentication · FIDOModule 같은 구현체 모듈은 App이 의존해 생성한 뒤 UILayer에 주입합니다.
- **TCA**: 상태와 액션을 Reducer 단위로 나눠 ViewModel 비대화 문제를 해결했습니다.

---

## 담당 역할 및 기여

- **아키텍처 설계 주도**: 타겟별 모듈 구조, TCA 적용, 모듈 간 의존성 주입 체계, 전체 프로세스 흐름 정의·구현
- **패킷 제어 프로세스 개발**: 패킷 제어에 필요한 정보를 얻기 위해 NEFilterDataProvider와 NEFilterPacketProvider를 결합한 System Extension 구현
- **패킷 제어 판단 모듈 구현**: 패킷 허용/차단을 판단하던 기존 모듈을 코드 컨벤션과 코드 깊이(depth)를 개선해 새로 구현
- **테스트 환경 구축**: Unit Test 작성·자동화, Micro App 테스트, Preview 가능한 구조
- **기술 공유**: 모듈화, TCA, Unit Test, Micro App Test 도입을 팀원과 논의하고 학습 자료 공유

---

## 주요 기능 및 구현

### 1. Network Extension — System Extension (macOS)

- **문제**: 고도화된 PacketGo OS 네트워크 필터링은 패킷을 보낸 **로컬 정보(프로세스, local endpoint)**가 필요했는데, ZTNA 구조에서는 이 정보를 얻을 수 없었습니다. Raw 패킷만 보는 NEFilterPacketProvider에는 프로세스 정보가 없고, Flow 단위로 보는 NEFilterDataProvider는 패킷 단위로 판단할 수 없습니다.
- **구현**: 하나의 System Extension(ControlFilterData-macOS) 안에 세 Provider를 두고 역할을 나눴습니다.
  1. **NEFilterDataProvider**: 새 Flow가 생기면 `NEFilterSocketFlow`에서 PID와 프로세스 이름을 추출해 원격 IP·Port를 키로 Flow 저장소에 기록 (Flow 자체는 허용)
  2. **NEFilterPacketProvider**: Raw 패킷 헤더(IPv4/IPv6, utun·ipsec 등 터널 인터페이스 포함)를 파싱해 5-tuple을 만들고, Flow 저장소에서 프로세스 정보를 찾아 5-tuple 캐시에 보관
  3. **패킷 제어 판단 모듈 (C++)**: 5-tuple과 프로세스 정보를 Objective-C++ Wrapper로 전달해 정책 기준 허용/차단 판단 (JSON 응답)
  4. 판단 결과는 XPC로 앱에 전달해 비즈니스 로직(정책 요청 등)을 수행하고, 같은 패킷이 처리 중이면 중복 전송하지 않음
- **NEPacketTunnelProvider**: SSL VPN 터널도 같은 System Extension에서 동작해, 터널 인터페이스로 나가는 패킷도 같은 판단 흐름을 거칩니다.
- 관련 글: [VPN 패킷 흐름 — NEFilterPacketProvider와 NEPacketTunnelProvider의 관계]({% post_url 2026-07-07-vpn-packet-flow %})

### 2. Network Extension — App Extension (iOS)

- **문제**: iOS에는 System Extension과 NEFilterPacketProvider가 없어, macOS와 같은 방식으로 패킷을 제어할 수 없습니다.
- **구현**: App Extension의 NEPacketTunnelProvider에서 패킷을 직접 판단합니다.
  1. `packetFlow.readPackets`로 터널에 들어온 패킷을 읽고 IPv4/IPv6 헤더를 파싱해 5-tuple 생성
  2. 패킷 제어 판단 모듈(C++)이 허용/차단을 판단 → 허용 패킷만 SSL VPN 세션으로 전송, 차단 패킷은 버림
- **기존 방식의 문제 (ZTNA)**: 앱과 Extension이 App Group 컨테이너의 공유 파일로 정보를 주고받았습니다. 보내는 쪽이 `NSFileCoordinator`로 파일을 덮어쓰면 받는 쪽이 `NSFilePresenter`로 변경을 감지해 읽고, 다시 콜백 파일에 ack를 써야 다음 메시지를 보낼 수 있는 구조였습니다. 메시지가 하나씩 순차로 처리되고, 매번 파일 쓰기와 변경 감지를 거쳐 느렸습니다.
- **개선 — Unix Domain Socket**: App Group 컨테이너에 방향별 소켓 두 개를 두고 양쪽이 각각 서버를 엽니다.
  - 앱 → Extension: 데이터 플로우, 데이터 플로우 라우팅, 세션 정보처럼 필터링에 필요한 정보를 전달해 판단 모듈에 등록
  - Extension → 앱: 판단 결과(패킷 헤더 정보 + 허용 여부)를 전달해 앱이 비즈니스 로직 수행
- **비교 측정 (macOS에서 두 방식 재현, 300B 메시지 왕복)**: 공유 파일 방식은 1건 왕복에 약 1.08초(단방향 약 0.54초, 초당 약 1건), Unix Domain Socket은 1건 왕복(connect → send → ack)에 약 0.02ms였습니다.

### 3. 서버와 독립적인 개발 — Domain 프로토콜 추상화와 Mock

- **문제**: 서버(컨트롤러) 개발 일정에 맞춰 기다리면 클라이언트 개발이 늦어집니다.
- **구현**: Domain 모듈(비즈니스 로직)을 프로토콜로 추상화하고, **Mock 객체**로 전체 비즈니스 로직과 프로세스 흐름을 테스트했습니다. 서버가 준비되면 실제 구현체로 바꾸기만 하면 되는 구조입니다.

### 4. 테스트 가능한 구조 — Unit Test, Preview, Micro App

- **기존 구조 (ZTNA)**: 하나의 프로젝트(타겟 12개)에서 Unit Test가 앱을 호스트(`TEST_HOST`)로 실행됐습니다. 그래서 화면 하나를 Preview로 보거나 테스트 하나를 돌려도 앱 타겟 전체를 빌드해야(프로젝트 전체 Swift 파일 541개) 해서 오래 걸렸고, 결국 대부분을 실기기에서 확인했습니다.
- **개선**: 레이어를 Domain(비즈니스 로직 프로토콜)에만 의존하도록 나눠, Preview와 Unit Test가 필요한 레이어만 빌드합니다.
  - **Preview**: UILayer는 Domain에만 의존해 UILayer와 Domain만 빌드합니다(`#Preview` 106개, `MockDependencies`로 서버 없이 확인).
  - **Unit Test**: Data 레이어에서 실서버 통신 프로토콜 메시지별로 테스트합니다. Data도 Domain에만 의존해 Data와 Domain만 빌드합니다.
- **구현**: 모듈화, 의존성 정리, 프레임워크 설정으로 ZTNA에서는 불가능했던 **SwiftUI Preview와 Unit Test**를 가능하게 했습니다. 타겟별로 프로젝트를 나눠 테스트 시간도 줄였습니다.
- **효과**: 예를 들어 컨트롤러 통신 프로토콜이 바뀌어도 해당 모듈만 빠르게 테스트할 수 있게 됐습니다.

### 5. TCA 도입

- **기존 구조 (ZTNA)**: 모듈 경계 없이 하나의 Model을 여러 화면이 함께 써서 상태와 로직이 계속 쌓였습니다. 예를 들어 `LoginModel`은 1,064줄(본체 420줄 + extension 644줄)로 커졌고 Login·Signup·Settings·Space·Home·비밀번호 찾기 등 32개 파일에서 사용됐습니다. `SpaceModel`도 31개 파일에서 사용됐습니다.
- **개선된 구조**: UILayer를 macOS·iOS 프로젝트별로 나누고(macOS 195개, iOS 207개 파일), 화면마다 `Feature`(Reducer)와 `View`를 한 쌍으로 둔 폴더 구조로 정리했습니다. NewTab(macOS), FIDO 등록·로그인·Verification(iOS)처럼 플랫폼 전용 화면은 해당 UILayer에만 있고, 의존성은 한 방향으로만 흐릅니다: `HomeView`는 자기 Feature인 `HomeFeature` 하나만 보고, `HomeFeature`는 `@Dependency`로 Dependencies에서 필요한 것을 꺼내 쓰며, Dependencies는 `AppDependencyFactory`가 `withDependencies`로 채웁니다. Factory에 넣는 구현체는 App target이 생성해 주입합니다.
- **구현**: ZTNA의 MVI 패턴에서 생긴 비대한 ViewModel 문제를 해결하기 위해 TCA를 연구해 적용했습니다. ZTNA보다 프로젝트 규모가 작다는 점을 감안하더라도 유지보수성과 가독성이 좋아졌습니다.
- 관련 글: [TCA await send(.action) 내부 동작 원리]({% post_url 2026-10-07-tca-await-send-internals %})

---

## 트러블슈팅

### UI 모듈을 Dynamic Framework로 추가하자 HelperTool이 크래시한 문제

- **문제**: `UILayerModule`을 Dynamic Framework로 앱에 추가하자, 관련 없는 HelperTool이 `Library not loaded: @rpath/Domain...framework` 오류로 크래시했습니다.
- **원인**: SPM은 패키지 product의 링킹 타입을 **워크스페이스 단위로 결정**합니다. Dynamic Framework가 `Domain`에 의존하면서 `Domain`이 동적 링킹으로 바뀌었고, 이 결정이 HelperTool에도 적용됐습니다. 그런데 HelperTool은 App Bundle 바깥(`/Library/PrivilegedHelperTools`)에서 실행되고 `LC_RPATH`도 없어서 Framework를 찾지 못했습니다. `otool`, `lsof`로 타겟별 RPATH와 실제 로딩 경로를 비교해 원인을 확인했습니다.
- **해결**: `UILayerModule`을 **Static Framework**로 바꿔 `Domain`이 각 바이너리에 정적으로 포함되게 했습니다.
- **결과**: HelperTool이 정상 실행되고, 멀티 타겟 프로젝트에서 타겟별 실행 위치와 Framework 접근 여부를 확인하는 기준을 세웠습니다.
- 관련 글: [Dynamic Framework 전파와 HelperTool 크래시]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %})

### 시스템 확장 프로그램 설정 화면으로 바로 안내하기

- **문제**: System Extension이 꺼져 있을 때 사용자를 시스템 설정의 확장 프로그램 토글 화면으로 안내해야 했습니다. 알려진 URL scheme으로는 상위 페이지까지만 열렸습니다.
- **원인 분석**: OS 시스템 팝업의 "시스템 설정 열기" 버튼은 정확한 화면을 엽니다. 시스템 로그로 두 경로를 비교하고, `sysextd`가 보내는 GURL Apple Event를 추적한 뒤 **바이너리에서 URL 포맷 문자열을 추출**했습니다.
- **해결**: 찾아낸 URL scheme으로 앱의 확장 프로그램 토글 화면을 바로 열도록 구현했습니다.
- 관련 글: [sysextd 바이너리 리버싱으로 찾은 시스템 확장 프로그램 딥링크]({% post_url 2026-10-22-sysextd-deeplink-and-activation-flow %})

---

## 성과

- PacketGo OS macOS·iOS 에이전트 아키텍처 설계 및 개발 (2025년 기준 60% 진행)
- ZTNA에서 불가능했던 Preview·Unit Test 환경 구축 → 프로토콜 변경 등 수정 사항의 테스트 속도 향상
- 서버 일정과 독립적으로 비즈니스 로직 개발·검증
- 모듈화, TCA, 테스트 방식을 팀에 공유해 협업 체계 개선

---

## 회고

- **잘한 점**: 이전 프로젝트를 회고해서 찾은 문제를 다음 프로젝트 설계에 직접 반영했습니다. 사이드 프로젝트에서 먼저 검증한 Tuist, Clean Architecture, TCA를 회사 프로젝트에 도입했습니다.
- **배운 점**: 모듈화는 코드만 나누는 일이 아니라 **링킹과 실행 환경까지 함께 설계하는 일**이라는 것을 HelperTool 크래시를 겪으며 배웠습니다.
- **아쉬운 점**: [작성 필요]
