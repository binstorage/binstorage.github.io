---
title: "PacketGO Switch — macOS·iOS 제로트러스트 보안 에이전트"
period: "2023.06 - 2023.11"
description: "제로트러스트 기반 네트워크 보안 에이전트를 macOS와 iOS용으로 새로 개발했습니다. SwiftUI로 두 플랫폼의 UI를 통합하고, C++ 패킷 제어 모듈을 Objective-C++로 Swift와 연결했으며, KISA 실증을 완료했습니다."
skills: [Swift, C++, Objective-C++, SwiftUI, Combine, Network Extension, System Extension, XPC, Daemon]
order: 6
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 기술연구소 |
| 기간 | 2023.06 - 2023.11 (약 6개월) |
| 인원 | [확인 필요 — 예: 총 N명 (Apple 플랫폼 N, 서버/컨트롤러 N)] |
| 담당 | macOS·iOS 에이전트 개발 (UI, 패킷 제어 모듈 연동, VPN, 패키징·배포) |
| 플랫폼 | macOS, iOS |
| 배포 | macOS: Developer ID 서명·공증 패키지(.pkg) / iOS: [확인 필요] |

**PacketGO Switch**는 제로트러스트 기반 네트워크 보안 솔루션(SASE)의 단말 에이전트입니다. 단말에서 나가는 패킷을 확인하고 제어하며, 허가된 사용자와 단말만 보호 대상 자원에 접근할 수 있도록 VPN 터널을 구성합니다.

기존에 없던 macOS·iOS 버전을 **새로 개발**했고, 같은 해 **KISA 실증**을 완료했습니다.

---

## 배경 및 목표

- **배경**: 제로트러스트 솔루션을 고객사의 다양한 단말 환경에 적용하려면 Apple 플랫폼 에이전트가 필요했습니다. 패킷 제어 핵심 로직은 C++ 모듈로 이미 있었기 때문에, 이를 Apple 플랫폼의 Network Extension 구조 안에서 Swift와 함께 동작하게 만드는 것이 핵심 과제였습니다.
- **목표**
  - macOS·iOS 에이전트 신규 개발 및 출시
  - 두 플랫폼의 UI를 하나의 코드베이스로 관리
  - KISA 실증 통과

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++, Objective-C++ |
| UI | SwiftUI, Combine |
| Apple Platform | Network Extension, System Extension (macOS), App Extension (iOS) |
| macOS 시스템 | Privileged Daemon, XPC, Command Line Tool |
| Distribution | Developer ID, Notarization, Installer Package (비 샌드박스) |

---

## 아키텍처

```
┌────────────── macOS ──────────────┐   ┌──────────── iOS ────────────┐
│ App (SwiftUI)                     │   │ App (SwiftUI)               │
│   │ XPC                           │   │   │                         │
│   ▼                               │   │   ▼                         │
│ Privileged Daemon                 │   │ App Extension               │
│   │                               │   │ (Network Extension)         │
│   ▼                               │   │   │                         │
│ System Extension                  │   │   ▼                         │
│ (Network Extension)               │   │ Swift ↔ Obj-C++ ↔ C++       │
│   │                               │   │ 패킷 제어 모듈              │
│   ▼                               │   └─────────────────────────────┘
│ Swift ↔ Obj-C++ ↔ C++ 패킷 제어 모듈 │
└───────────────────────────────────┘
```

- **App (SwiftUI)**: 두 플랫폼이 공유하는 UI. 연결 상태와 제어 기록을 보여줍니다.
- **Network Extension**: macOS는 System Extension, iOS는 App Extension 형태로 패킷 필터링과 VPN 터널을 담당합니다.
- **Privileged Daemon (macOS)**: 관리자 권한이 필요한 사용자 통제·환경 제어를 맡고, 앱과는 XPC로 통신합니다.
- **패킷 제어 모듈 (C++)**: Objective-C++ 래퍼를 통해 Swift에서 호출합니다.

[확인 필요 — 실제 구조와 다른 부분이 있으면 수정해 주세요]

---

## 담당 역할 및 기여

- **iOS·macOS 통합 UI**: SwiftUI 기반으로 두 플랫폼 UI를 함께 개발하고 디자인 패턴 설계
- **패킷 제어 모듈 연동**: C++ 기반 패킷 제어 모듈 개발, Swift 호환성 설계 (Swift ↔ Objective-C++ ↔ C++)
- **VPN 모듈 개발**: Network Extension 기반 VPN 모듈 개발, 네트워크 필터링·VPN 익스텐션 버그 수정
- **사용자 통제 및 환경 제어 (macOS)**: Privileged Daemon과 XPC를 이용한 단말 환경 제어
- **패키징 및 배포 (macOS)**: 비 샌드박스 앱의 Developer ID 서명, 공증, Installer 패키지 배포
- **형상 관리**: 고객사·버전별로 여러 형상 관리
- **KISA 실증 대응**

---

## 주요 기능 및 구현

### 1. SwiftUI 기반 iOS·macOS 통합 UI

- **설명**: 하나의 SwiftUI 코드베이스로 macOS와 iOS 앱 화면을 함께 개발했습니다.
- **구현**: Combine으로 익스텐션·데몬의 상태를 UI에 반영했습니다. [확인 필요 — 플랫폼별 분기 방식, 사용한 디자인 패턴(MVVM 등)]

### 2. C++ 패킷 제어 모듈의 Swift 연동

- **설명**: C++로 작성된 패킷 제어 모듈을 Swift 기반 Network Extension에서 사용할 수 있도록 연결했습니다.
- **구현**: Swift는 C++를 직접 호출할 수 없었기 때문에(당시 Swift 5.9 이전), **Objective-C++(.mm) 래퍼**를 두어 Swift → Objective-C → C++ 순서로 호출하도록 설계했습니다. 이 과정에서 언어 간 호환성과 컴파일·링킹 과정을 깊이 공부했습니다.
- 관련 글: [정적·동적 라이브러리의 빌드·링킹·런타임 차이]({% post_url 2026-10-29-static-vs-dynamic-library-build-runtime %})

### 3. Network Extension 기반 VPN·패킷 필터링

- **설명**: 단말의 패킷을 필터링하고, 허가된 트래픽을 VPN 터널로 보냅니다.
- **구현**: [확인 필요 — 사용한 Provider 종류(NEPacketTunnelProvider, NEFilterPacketProvider 등)와 역할 분담]
- 관련 글: [VPN 패킷 흐름 — NEFilterPacketProvider와 NEPacketTunnelProvider의 관계]({% post_url 2026-07-07-vpn-packet-flow %})

### 4. macOS 비 샌드박스 앱 패키징·배포

- **설명**: System Extension과 Privileged Daemon을 포함하는 앱은 App Store로 배포할 수 없어, Developer ID로 서명하고 공증받은 Installer 패키지로 배포했습니다.
- **구현**: [확인 필요 — 패키지 구성(앱, 데몬 plist, 설치 스크립트), 공증 자동화 여부]
- 관련 글: [XPC 연결 내부 동작]({% post_url 2026-09-08-xpc-connection-internals %})

---

## 트러블슈팅

### [문제 제목 — 확인 필요, 예: C++ 모듈 연동 시 링킹 오류 / 익스텐션 활성화 실패]

- **문제**:
- **원인**:
- **해결**:
- **결과**:

---

## 성과

- macOS·iOS PacketGO Switch 에이전트 **신규 개발 및 출시**
- PacketGO Switch 2.5 **KISA 실증 완료** (2023.06 - 2023.11)
- 이후 보안 기능 확인서 대응(2024)과 PRIBIT Connect 2.6 고도화로 이어지는 기반 마련

---

## 회고

- **잘한 점**: 입사 첫해에 Apple 플랫폼 에이전트를 처음부터 만들어 출시와 KISA 실증까지 마쳤습니다.
- **배운 점**: 프록시, 패킷, VPN 같은 네트워크 지식과 App Extension·System Extension의 동작 원리를 익혀 제품에 적용하고 매뉴얼로 정리했습니다. C++ 모듈을 Swift에 붙이면서 언어 간 호환성과 링킹 과정을 깊이 이해하게 됐습니다.
- **아쉬운 점**: [작성 필요]
