---
title: "보안 기능 확인서 대응 — KCMVP 타겟 OS 에이전트"
period: "2024.01 - 2024.05"
description: "보안 기능 확인서를 받으려면 VPN 모듈에 KCMVP 암호 모듈을 넣어야 했지만, KCMVP가 Switch가 지원하는 높은 OS 버전과 호환되지 않아 낮은 OS에서 동작하는 macOS(AppKit)·iOS(UIKit) 에이전트를 새로 만들었습니다. KCMVP 상위 버전 제공 예정으로 개발 도중 중단했습니다."
skills: [Swift, C++, Objective-C++, UIKit, AppKit, Combine, Network Extension, System Extension, App Extension, Swift Package Manager, KCMVP]
order: 5
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 연구소 |
| 기간 | 2024.01 - 2024.05 |
| 인원 | [확인 필요] |
| 담당 | KCMVP 타겟 OS용 macOS·iOS 에이전트 설계·개발 |
| 플랫폼 | macOS, iOS (KCMVP 타겟 OS 버전) |

이전에 만든 **PacketGO Switch**로 **보안 기능 확인서**를 받으려면 VPN 모듈에 검증된 암호 모듈(**KCMVP**)을 넣어야 했습니다. 그런데 KCMVP 모듈이 Switch가 지원하는 높은 OS 버전과 호환되지 않아, 낮은 OS에서 동작하는 에이전트를 새로 만들었습니다.

---

## 배경 및 목표

- **배경**: Switch의 최소 OS를 낮추자 SwiftUI 서드파티와 SwiftUI API 일부가 낮은 OS에서 동작하지 않았습니다.
- **판단**: 화면과 기능이 적어, 익숙한 UIKit으로 새로 만드는 쪽이 빠르다고 판단했습니다. AppKit도 OS 동작은 달라도 코드 설계·구현 방식이 UIKit과 비슷해 macOS까지 함께 진행했습니다.
- **목표**: KCMVP 타겟 OS에서 동작하는 iOS(UIKit)·macOS(AppKit) 에이전트를 만들고 VPN 모듈에 KCMVP 암호 모듈 적용

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift |
| UI | UIKit (iOS), AppKit (macOS) |
| Crypto | KCMVP 검증 암호 모듈 |
| Collaboration | Git (별도 형상으로 관리) |

---

## 담당 역할 및 기여

- 타겟 OS 버전에 맞는 macOS·iOS 에이전트 코드 설계 및 개발
- SwiftUI 기반 UI를 **UIKit(iOS), AppKit(macOS)으로 전환**
- 낮은 OS 버전의 Swift 문법·Extension 동작 차이에 맞춰 소스 수정
- 기존 제품과 분리된 **새 코드 형상** 생성·관리, 품질 인증 진행

---

## 주요 기능 및 구현

### 1. SwiftUI → UIKit·AppKit 전환

- **설명**: 낮은 OS 버전에서는 기존 SwiftUI 코드가 쓰는 API를 쓸 수 없어 UI 프레임워크를 바꿨습니다.
- **구현**: iOS는 UIKit, macOS는 AppKit으로 화면을 다시 구현했습니다. [확인 필요 — 쓸 수 없었던 구체적인 SwiftUI API, 비즈니스 로직 재사용 방식]

### 2. 타겟 OS에 맞춘 Extension·로직 수정

- **설명**: 낮은 OS 버전에서 지원하지 않거나 다르게 동작하는 Swift 문법과 Extension API에 맞춰 코드를 바꿨습니다.
- **구현**: [확인 필요 — 예: Swift Concurrency 대체, Network Extension API 차이]

---

## 트러블슈팅

### [문제 제목 — 확인 필요, 예: 낮은 OS 버전에서 Extension이 다르게 동작한 문제]

- **문제**:
- **원인**:
- **해결**:
- **결과**:

---

## 성과

- KCMVP 상위 버전이 제공될 예정이라 개발 도중 중단했습니다. 보안 기능 확인서는 이후 Switch로 받을 예정입니다(미취득).
- 이때 만든 UIKit iOS 앱이 [외교부 MFA QR 인증 앱]({{ '/portfolio/mofa-mfa-authenticator/' | relative_url }})의 바탕이 됐습니다.

---

## 회고

- **배운 점**: 인증 요건이 OS 지원 범위를 정할 수 있다는 것, 그리고 최신 API에 크게 의존하는 코드는 하위 버전 대응 비용이 크다는 것을 배웠습니다.
- **아쉬운 점**: 일정 변경으로 이 형상은 끝까지 가지 못했습니다. 처음부터 UI와 로직이 더 분리되어 있었다면 전환 비용이 적었을 것이고, 이 경험이 이후 모듈화와 구조 설계에 관심을 갖게 된 계기가 됐습니다.
