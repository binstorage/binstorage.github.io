---
title: "PacketGO Switch — macOS·iOS 제로트러스트 보안 에이전트"
period: "2023.06 - 2023.11"
description: "제로트러스트 기반 네트워크 보안 에이전트를 macOS와 iOS용으로 새로 개발했습니다. SwiftUI로 두 플랫폼의 UI를 통합하고, C++ 패킷 제어 모듈을 Objective-C++로 Swift와 연결했으며, KISA 실증을 완료했습니다."
skills: [Swift, C++, Objective-C++, SwiftUI, Combine, Network Extension, System Extension, App Extension, Swift Package Manager]
order: 6
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 기술연구소 |
| 기간 | 2023.06 - 2023.11 (약 6개월) |
| 인원 | [확인 필요 — 예: 총 N명 (Apple 플랫폼 N, 서버/컨트롤러 N)] |
| 담당 | macOS·iOS 에이전트 개발 (UI, 패킷 제어 모듈 브릿징, VPN) |
| 플랫폼 | macOS, iOS |
| 용도 | 디버그 빌드로 KISA 실증 (정식 배포 전) |

**PacketGO Switch**는 제로트러스트 기반 네트워크 보안 솔루션(SASE)의 단말 에이전트입니다. 단말에서 나가는 패킷을 확인하고 제어하며, 허가된 사용자와 단말만 보호 대상 자원에 접근할 수 있도록 VPN 터널을 구성합니다.

기존에 없던 macOS·iOS 버전을 **새로 개발**했고, 같은 해 **KISA 실증**을 완료했습니다.

---

## 배경 및 목표

- **배경**: 제로트러스트 솔루션을 고객사의 다양한 단말 환경에 적용하려면 Apple 플랫폼 에이전트가 필요했습니다. 패킷 제어 핵심 로직은 C++ 모듈로 이미 있었기 때문에, 이를 Apple 플랫폼의 Network Extension 구조 안에서 Swift와 함께 동작하게 만드는 것이 핵심 과제였습니다.
- **목표**
  - macOS·iOS 에이전트 신규 개발 및 KISA 실증
  - 두 플랫폼의 UI를 하나의 코드베이스로 관리
  - KISA 실증 통과

---

## 주요 구현

| 구현 | 내용 | 결과 |
| --- | --- | --- |
| 1. SwiftUI 통합 UI | 하나의 SwiftUI 코드베이스로 macOS·iOS 화면을 개발하고, Combine으로 익스텐션·데몬 상태 반영 | 두 플랫폼 화면 동시 개발 |
| 2. 패킷 제어 모듈 브릿징 | Windows 파트에서 넘어온 C++·C·Objective-C·Objective-C++ 모듈을 브릿징해 Swift에서 사용 | 다른 OS와 같은 패킷 제어 모듈 사용 |
| 3. 패킷 필터링·VPN | macOS는 System Extension, iOS는 App Extension의 NEFilterDataProvider로 필터링, SSL VPN·IPSec(IKEv2) VPN 구현 | 패킷 확인·제어, KISA 실증 완료 |

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++, Objective-C++ |
| UI | SwiftUI, Combine |
| Apple Platform | Network Extension, System Extension (macOS), App Extension (iOS) |

---

## 아키텍처

```
┌──────────── macOS ────────────┐   ┌──────────── iOS ─────────────┐
│ App (SwiftUI)                 │   │ App (SwiftUI)                │
│  ├─▶ System Extension          │   │  ├─▶ App Extension            │
│  │    NEFilterDataProvider     │   │  │    NEFilterDataProvider    │
│  │     └─ 패킷 제어 모듈       │   │  │     └─ 패킷 제어 모듈      │
│  └─▶ App Extension             │   │  └─▶ App Extension            │
│       NEPacketTunnelProvider   │   │       NEPacketTunnelProvider │
└───────────────────────────────┘   └──────────────────────────────┘
```

- **App (SwiftUI)**: 두 플랫폼이 공유하는 UI. 연결 상태와 제어 기록을 보여줍니다.
- **NEFilterDataProvider**: macOS는 System Extension, iOS는 App Extension에서 패킷을 필터링합니다. 패킷 제어 모듈이 이 안에 들어 있습니다.
- **NEPacketTunnelProvider**: macOS·iOS 모두 App Extension에서 SSL VPN 터널을 담당합니다.
- **패킷 제어 모듈**: Windows 파트에서 넘어온 C++·C·Objective-C·Objective-C++ 모듈을 Objective-C++ 래퍼로 브릿징해 Swift에서 호출합니다.
- **용도**: 디버그 빌드로 개발해 KISA 실증만 받았고, 정식 배포는 하지 않았습니다. Privileged Daemon, Developer ID 서명·패키지 배포는 이후 [PRIBIT Connect 2.6 고도화]({{ '/portfolio/packetgo-switch-advancement/' | relative_url }})에서 도입했습니다.

---

## 담당 역할 및 기여

- **iOS·macOS 통합 UI**: SwiftUI 기반으로 두 플랫폼 UI를 함께 개발하고 디자인 패턴 설계
- **패킷 제어 모듈 브릿징**: Windows 파트에서 넘어온 패킷 제어 모듈(C++·C·Objective-C·Objective-C++)을 브릿징해 Swift에서 사용
- **VPN 모듈 개발**: Network Extension 기반 VPN 모듈 개발, 네트워크 필터링·VPN 익스텐션 버그 수정
- **형상 관리**: 고객사·버전별로 여러 형상 관리
- **KISA 실증 대응**

---

## 주요 기능 및 구현

### 1. SwiftUI 기반 iOS·macOS 통합 UI

- **설명**: 하나의 SwiftUI 코드베이스로 macOS와 iOS 앱 화면을 함께 개발했습니다.
- **구현**: Combine으로 익스텐션·데몬의 상태를 UI에 반영했습니다. [확인 필요 — 플랫폼별 분기 방식, 사용한 디자인 패턴(MVVM 등)]

### 2. 패킷 제어 모듈 브릿징

- **설명**: Windows 파트에서 넘어온 패킷 제어 모듈(C++·C·Objective-C·Objective-C++)을 macOS·iOS의 NEFilterDataProvider에 넣어 Swift에서 사용할 수 있도록 연결했습니다.
- **구현**: Swift는 C++를 직접 호출할 수 없었기 때문에(당시 Swift 5.9 이전), **Objective-C++(.mm) 래퍼**로 브릿징해 Swift → Objective-C → C++ 순서로 호출하도록 설계했습니다. 이 과정에서 언어 간 호환성과 컴파일·링킹 과정을 깊이 공부했습니다.
- 관련 글: [정적·동적 라이브러리의 빌드·링킹·런타임 차이]({% post_url 2026-10-29-static-vs-dynamic-library-build-runtime %})

### 3. Network Extension 기반 VPN·패킷 필터링

- **설명**: 단말의 패킷을 필터링하고, 허가된 트래픽을 VPN 터널로 보냅니다.
- **구현**:
  - **구조**: macOS는 NEFilterDataProvider가 System Extension, NEPacketTunnelProvider가 App Extension이고, iOS는 두 Provider가 각각 별도 App Extension입니다. 패킷 제어 모듈은 양쪽 NEFilterDataProvider 안에 들어 있습니다.
  - **필터링**: macOS는 System Extension, iOS는 App Extension의 NEFilterDataProvider로 패킷을 필터링했습니다. iOS의 NEFilterDataProvider는 MDM으로 관리되는(감독) 기기에서만 동작해, iOS는 실증까지만 진행했습니다.
  - **VPN 터널**: SSL VPN(NEPacketTunnelProvider)과 IPSec(NEVPNManager · NEVPNProtocolIKEv2) 두 방식을 지원했습니다.
- 관련 글: [VPN 패킷 흐름 — NEFilterPacketProvider와 NEPacketTunnelProvider의 관계]({% post_url 2026-07-07-vpn-packet-flow %})

---

## 트러블슈팅

### [문제 제목 — 확인 필요, 예: C++ 모듈 연동 시 링킹 오류 / 익스텐션 활성화 실패]

- **문제**:
- **원인**:
- **해결**:
- **결과**:

---

## 성과

- macOS·iOS PacketGO Switch 에이전트 **신규 개발** (디버그 빌드로 실증, 정식 배포 전)
- PacketGO Switch 2.5 **KISA 실증 완료** (2023.06 - 2023.11)
- 이후 보안 기능 확인서 대응(2024)과 PRIBIT Connect 2.6 고도화로 이어지는 기반 마련

---

## 회고

- **잘한 점**: 입사 첫해에 Apple 플랫폼 에이전트를 처음부터 만들어 KISA 실증까지 마쳤습니다.
- **배운 점**: 프록시, 패킷, VPN 같은 네트워크 지식과 App Extension·System Extension의 동작 원리를 익혀 제품에 적용하고 매뉴얼로 정리했습니다. C++ 모듈을 Swift에 붙이면서 언어 간 호환성과 링킹 과정을 깊이 이해하게 됐습니다.
- **아쉬운 점**: [작성 필요]
