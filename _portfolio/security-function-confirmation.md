---
title: "보안 기능 확인서 대응 — KCMVP 타겟 OS 에이전트"
period: "2024.01 - 2024.05"
description: "보안 기능 확인서 취득을 위해, 제품보다 낮은 KCMVP 타겟 OS 버전에서 동작하는 macOS·iOS 에이전트를 개발했습니다. SwiftUI를 쓸 수 없어 UIKit·AppKit으로 UI를 다시 만들었습니다."
skills: [Swift, UIKit, AppKit, KCMVP, 보안 기능 확인서]
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

PRIBIT Connect(PacketGO Switch) 에이전트가 **보안 기능 확인서**를 받으려면 검증된 암호 모듈(**KCMVP**)을 적용해야 했습니다. 그런데 KCMVP의 타겟 OS 버전이 당시 제품(PRIBIT Connect 2.5)의 최소 지원 OS보다 낮아, 그 버전에서 동작하는 에이전트를 새로 설계·개발했습니다.

---

## 배경 및 목표

- **배경**: 공공기관 납품을 위해 보안 기능 확인서가 필요했습니다. KCMVP 모듈이 지원하는 OS 버전이 제품의 타겟 버전보다 낮았습니다.
- **목표**
  - KCMVP 타겟 OS 버전에서 동작하는 macOS·iOS 에이전트 개발
  - 낮은 OS 버전에 맞게 소스 코드 변경, KCMVP 적용 및 테스트

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

- 기획 대비 85%까지 진행한 시점에 보안 기능 확인서 일정과 KCMVP 타겟 OS 버전이 바뀌어 중단
- 바뀐 KCMVP 타겟 OS 버전이 높아져 기존 PRIBIT Connect 2.6에 KCMVP를 바로 적용하는 방향으로 전환
- 이후 **보안 기능 확인서 iOS, macOS 취득** [확인 필요 — 취득 시기]

---

## 회고

- **배운 점**: 인증 요건이 OS 지원 범위를 정할 수 있다는 것, 그리고 최신 API에 크게 의존하는 코드는 하위 버전 대응 비용이 크다는 것을 배웠습니다.
- **아쉬운 점**: 일정 변경으로 이 형상은 끝까지 가지 못했습니다. 처음부터 UI와 로직이 더 분리되어 있었다면 전환 비용이 적었을 것이고, 이 경험이 이후 모듈화와 구조 설계에 관심을 갖게 된 계기가 됐습니다.
