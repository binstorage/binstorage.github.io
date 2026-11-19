---
title: "PacketGo OS — macOS·iOS 에이전트 아키텍처 설계 및 개발"
period: "2025.08 - 진행 중"
description: "회사의 차세대 N2SF 제품 PacketGo OS의 macOS·iOS 에이전트를 처음부터 설계·구현했습니다. 타겟별 모듈화, TCA, 프로토콜 기반 의존성 주입을 적용하고, 두 Network Extension Provider를 결합해 패킷 제어를 구현했습니다."
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

**PacketGo OS**는 회사의 차세대 N2SF(국가망 보안체계) 제품입니다. N2SF는 기존의 물리적 망분리 대신, 업무 정보를 중요도에 따라 기밀(C)·민감(S)·공개(O)로 나누고 등급별로 보안 통제를 적용하는 공공기관 보안 체계입니다. PacketGo OS는 이 정책에 맞게 네트워크와 사용자의 행위(OS 비밀번호·방화벽 비활성화, 유·무선 네트워크 환경, IP 변경 등)를 통제하는 제품이며, 저는 macOS·iOS 에이전트를 처음부터 설계·구현했습니다.

---

## 주요 구현

macOS·iOS 에이전트를 모듈 구조부터 패킷 제어, 테스트 환경, 배포 자동화까지 처음부터 설계·구현했습니다.

| 구현 | 내용 | 결과 |
| --- | --- | --- |
| 1. 클린 아키텍처 기반 모듈 구조 | App · UILayer · Module 구현체 · System/App Extension · Helper를 타겟별로 분리하고, UILayer는 Domain에만 의존 | 수정 범위가 명확하고 필요한 모듈만 빌드 |
| 2. 패킷 단위 제어 (macOS) | System Extension에서 NEFilterDataProvider와 NEFilterPacketProvider를 결합해 Raw Packet Header와 프로세스 정보로 판단 | 프로세스·5-tuple 기준 패킷 허용/차단 |
| 3. 패킷 제어와 앱 통신 (iOS) | 풀터널 App Extension(NEPacketTunnelProvider)에서 모든 패킷을 판단하고, 앱과는 Unix Domain Socket으로 통신 | 순차 대기 없이 양방향 메시지 처리 |
| 4. TCA 기반 UI 구조 | 플랫폼별 UILayer, 화면마다 Feature · View 한 쌍, @Dependency로 의존성 주입 | 상태·로직이 화면 단위로 나뉨 |
| 5. 테스트 환경 | Domain 프로토콜 추상화와 Mock, 레이어별 Preview · Unit Test · Micro App | 서버 없이 개발·테스트, 실기기 의존 감소 |
| 6. 공통 패킷 제어 판단 모듈 | C++ 크로스 플랫폼 모듈로 구현해 다른 OS와 공유하고, Objective-C++로 브릿징해 Swift에서 사용 | 여러 OS에서 같은 판단 로직 사용 |
| 7. AI 기반 배포 자동화 | Claude Code 스킬로 macOS pkg 빌드·서명·공증, iOS 아카이브·App Store Connect 업로드·태그 자동화 | 요청 한 번으로 배포, 단계별 검증 |
| 8. VPN 터널과 패킷 인증 | macOS·iOS에서 SSL VPN, IPSec VPN 구현. 정책에 맞는 TCP·UDP 패킷에 암호화된 인증 데이터 삽입 | 보호 자원 접근 시 패킷 단위 인증 |
| 9. Endpoint Security 통제 (진행 중) | 별도 System Extension에서 커널 AUTH 이벤트를 구독해 정책 경로의 파일 삭제·생성·읽기·수정과 프로세스 실행을 차단 | 이동·복제 같은 우회 경로까지 차단, EDR 자기 보호 |
| 10. Swift Concurrency 기반 비동기 흐름 | 서버 통신·XPC reply block 같은 콜백 API를 Continuation으로 감싸 async 함수로 제공하고, 공유 상태는 actor로 격리 | 위에서 아래로 읽히는 호출 흐름, 에러 처리 일원화 |

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
- **패킷 제어 판단 모듈 구현**: 다른 운영체제 에이전트와 같은 코드를 함께 쓰기 위해 C++ 크로스 플랫폼 모듈로 구현하고, Swift에서 호출할 수 있도록 Objective-C++ 래퍼를 두었습니다. 기존 모듈보다 코드 컨벤션과 코드 깊이(depth)를 개선했습니다.
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
- 관련 글: [XPC 연결의 내부 동작]({% post_url 2026-09-08-xpc-connection-internals %})

### 2. Network Extension — App Extension (iOS)

- **문제**: iOS에는 System Extension과 NEFilterPacketProvider가 없어, macOS와 같은 방식으로 패킷을 제어할 수 없습니다.
- **구현**: App Extension의 NEPacketTunnelProvider에서 패킷을 직접 판단합니다.
  1. `packetFlow.readPackets`로 터널에 들어온 패킷을 읽고 IPv4/IPv6 헤더를 파싱해 5-tuple 생성
  2. 패킷 제어 판단 모듈(C++)이 허용/차단을 판단 → 허용 패킷만 SSL VPN 세션으로 전송, 차단 패킷은 버림
  3. 보호 자원으로 가는 TCP SYN·UDP 패킷에 **암호화된 인증 데이터**를 삽입
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

### 6. 공통 패킷 제어 판단 모듈 (C++)

- **구현**: 다른 OS 에이전트와 같은 코드를 공유하도록 C++ 크로스 플랫폼 모듈로 구현하고, Swift에서는 Objective-C++ 래퍼로 호출합니다.
  1. Swift(Network Extension)가 패킷 헤더와 프로세스 정보를 Objective-C++ Wrapper로 전달
  2. C++ `vgw_interface`가 `PacketInfo`를 만들고, `DataFlowManager` · `DataFlowRoutingManager`가 `getMatchedRules`로 Rule 객체를 매칭
  3. DataFlow → DataFlowRouting 순으로 매칭하고 enum(`ForwardingType` 등)으로 허용/차단을 결정해, 매칭된 Rule 정보와 함께 JSON으로 반환
- **기존 구조 (ZTNA)**: 판단 함수까지 C++ 내부에서 8단계를 호출했고, 그중 5단계는 인자를 그대로 넘기기만 하는 함수였습니다. 판단 함수의 중첩은 최대 8단계였고, C 스타일 핸들과 에러코드로 결과를 전달했습니다.
- **효과**: 판단까지 3단계 호출, 중첩 최대 6단계로 줄였습니다.

### 7. AI 기반 배포 자동화 (Claude Code 스킬)

- **배경**: 빌드 → 앱 공증 → pkg 생성 → 서명 → pkg 공증 → staple을 README를 보며 손으로 진행했습니다. 단계가 많고 공증 대기가 길어 실수하기 쉬웠고, 배포본이 어느 커밋에서 나왔는지 추적하기 어려웠습니다.
- **구현**: 배포 절차를 Claude Code 스킬(`packetgo-release`)로 만들었습니다.
  - **macOS**: 사전 확인(서명 · git 상태 · 버전) → 아카이브 · 앱 공증(Developer ID) → pkg 생성 · 서명 → pkg 공증 · 검증(staple · 서명 · spctl · payload) → 커밋 · 푸시. "pkg 만들어줘", "QA에 전달할 빌드" 같은 말로 실행됩니다.
  - **iOS**: 사전 확인(서명 · git 상태 · 버전) → 아카이브(앱 · Extension 버전 일치 검증) → App Store Connect 업로드 → 커밋 · 푸시. `/packetgo-release`로 명시적으로 호출할 때만 실행됩니다.
- **역할 분리**: 반복 단계는 셸 스크립트로 고정하고, 실패 로그 요약과 공증 거절 원인 분석은 AI가 맡습니다.
- **안전장치**: 업로드 · 푸시 전 사용자 확인, 태그 중복 시 질문, 강제 푸시 · 태그 삭제 금지, 허용 명령 제한.

### 8. VPN 터널과 패킷 인증 데이터 삽입

- **VPN 터널**: macOS·iOS에서 SSL VPN, IPSec VPN을 구현했습니다. macOS는 System Extension, iOS는 App Extension 위에서 NEPacketTunnelProvider가 동작합니다.
- **패킷 인증 데이터 삽입**: 정책에 맞는 TCP·UDP 패킷을 캡처하고, 이 패킷에 **암호화된 인증 데이터**를 삽입해 전송합니다.

### 9. Endpoint Security 기반 파일·프로세스 통제 (macOS, 진행 중)

- **구조**: 패킷 필터와 별도인 System Extension에서 Endpoint Security 클라이언트를 만들어 커널의 AUTH 이벤트를 구독하고 허용·거부를 응답합니다. App은 Domain 계층의 Endpoint Security 매니저(Mock 포함)로 확장을 활성화하고 XPC로 정책을 전달합니다.
- **정책**: 정책을 받으면 교체하고 판단 캐시를 비웁니다. 첫 활성화 시 이벤트 구독을 시작합니다.
- **파일**: 정책 경로와 하위 경로의 삭제·생성·읽기·수정을 거부합니다. 이동·이름 변경, APFS 복제, 파일 복사, 내용 비우기, 내용 교환도 원본·대상 기준으로 검사해 우회를 막습니다.
- **프로세스**: 지정 경로의 프로그램 실행을 차단하고, EDR 자신과 같은 팀 서명의 보호 대상 프로세스에 대한 종료·일시정지·제어권 획득을 거부합니다.
- **로그·테스트**: 거부된 동작의 프로세스 정보를 기록하고, EDR 테스트용 Micro App으로 파일 통제를 검증했습니다.

### 10. Swift Concurrency 기반 비동기 흐름

- **설계 배경 (ZTNA)**: 서버 통신과 XPC 응답이 콜백 중첩으로 이어져 흐름을 따라가기 어려웠고, 에러 처리와 스레드 전환이 콜백마다 흩어져 수정할 때 빠뜨리기 쉬웠습니다.
- **래핑**: 서버 통신, XPC reply block 같은 콜백 기반 API를 `withCheckedContinuation`으로 감싸 async 함수로 제공합니다.
- **실패 처리**: 응답의 성공·실패를 `resume(returning:)`·`resume(throwing:)`으로 바꿔 `try`/`catch` 한 곳에서 처리합니다.
- **상태 격리**: 여러 Task가 함께 쓰는 매니저 상태는 actor로 격리합니다.
- 관련 글: [Swift Concurrency 내부 동작]({% post_url 2026-09-08-swift-concurrency-internals %})

---

## 트러블슈팅

### UI 모듈을 Dynamic Framework로 추가하자 HelperTool이 크래시한 문제

- **문제**: `UILayerModule`을 Dynamic Framework로 앱에 추가하자, 관련 없는 HelperTool이 `Library not loaded: @rpath/Domain...framework` 오류로 크래시했습니다.
- **원인**: SPM은 패키지 product의 링킹 타입을 **워크스페이스 단위로 결정**합니다. Dynamic Framework가 `Domain`에 의존하면서 `Domain`이 동적 링킹으로 바뀌었고, 이 결정이 HelperTool에도 적용됐습니다. 그런데 HelperTool은 App Bundle 바깥(`/Library/PrivilegedHelperTools`)에서 실행되고 `LC_RPATH`도 없어서 Framework를 찾지 못했습니다. `otool`, `lsof`로 타겟별 RPATH와 실제 로딩 경로를 비교해 원인을 확인했습니다.
- **해결**: `UILayerModule`을 **Static Framework**로 바꿔 `Domain`이 각 바이너리에 정적으로 포함되게 했습니다.
- **결과**: HelperTool이 정상 실행되고, 멀티 타겟 프로젝트에서 타겟별 실행 위치와 Framework 접근 여부를 확인하는 기준을 세웠습니다.
- 관련 글: [Dynamic Framework 전파와 HelperTool 크래시]({% post_url 2026-10-22-dynamic-framework-rpath-helpertool %})

### Static Framework 이중 포함과 duplicate symbol

- **문제**: HelperTool 크래시를 피하려고 UI 모듈을 Static Framework로 바꾼 뒤, TCA 업데이트에서 duplicate symbol 11,752개로 빌드가 실패했습니다.
- **원인**: Static Framework는 의존 패키지(Domain 등)를 자기 아카이브에 병합합니다. 새 의존성이 넣은 `-ObjC` 플래그가 아카이브 멤버의 지연 로딩을 깨고 병합된 사본까지 강제 로드해, 앱이 직접 링크한 원본과 중복됐습니다.
- **해결**: UI 모듈을 로컬 SPM 패키지로 전환해 패키지 그래프 안에서 모듈이 한 번만 링크되게 했습니다. static 링크를 유지해 HelperTool·System Extension이 정상 동작하는 것도 확인했습니다.
- 관련 글: [Static Framework의 패키지 이중 포함과 -ObjC]({% post_url 2026-11-09-static-framework-duplicate-symbol-objc %})

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
