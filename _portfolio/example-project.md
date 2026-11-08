---
title: "[프로젝트명]"
period: "[YYYY.MM - YYYY.MM]"
description: "[카드에 표시될 한두 줄 요약 — 무엇을 만들었고 어떤 문제를 해결했는지]"
skills: [Swift, macOS, NetworkExtension]
order: 1
# github: https://github.com/...   (없으면 이 줄 생략)
# demo: https://...               (없으면 이 줄 생략)
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | [회사명 / 개인 / 팀 프로젝트] |
| 기간 | [YYYY.MM - YYYY.MM (N개월)] |
| 인원 | [총 N명 (iOS N, macOS N, 서버 N, 디자인 N)] |
| 담당 | [macOS 클라이언트 개발 / 기여도 N%] |
| 플랫폼 | [macOS 12+ / iOS 15+] |
| 배포 | [App Store / 사내 배포 / 미배포] |

[이 프로젝트가 무엇인지 2~3문장으로 설명하세요. 누구를 위한 제품인지, 어떤 문제를 해결하는지 적습니다.]

---

## 배경 및 목표

- **배경**: [이 프로젝트를 시작하게 된 이유, 기존 방식의 문제점]
- **목표**: [달성하려던 것 — 가능하면 측정 가능한 목표로]

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | [Swift, Objective-C, C] |
| Framework | [SwiftUI, AppKit, NetworkExtension, XPC] |
| Architecture | [MVVM, Clean Architecture] |
| Concurrency | [Swift Concurrency, GCD] |
| Tooling | [Xcode, Instruments, SPM, Fastlane] |
| Collaboration | [Git, Jira, Confluence] |

---

## 아키텍처

[전체 구조를 설명하세요. 이미지는 `assets/portfolio/<프로젝트명>/` 에 넣고 아래처럼 연결합니다.]

<!-- ![아키텍처](/assets/portfolio/프로젝트명/architecture.png) -->

```
[App (UI)]  ──XPC──▶  [Helper / System Extension]  ──▶  [Kernel / Network Stack]
```

- **[모듈 A]**: [역할]
- **[모듈 B]**: [역할]

---

## 담당 역할 및 기여

- [내가 맡은 기능/모듈 1 — 구체적으로]
- [내가 맡은 기능/모듈 2]
- [설계·리뷰·문서화 등 개발 외 기여]

---

## 주요 기능 및 구현

### 1. [기능명]

- **설명**: [기능이 하는 일]
- **구현**: [어떤 API/기술로 어떻게 구현했는지, 기술적 의사결정과 그 이유]

```swift
// 핵심 코드가 있다면 짧게 (10~20줄 이내)
```

### 2. [기능명]

- **설명**: [기능이 하는 일]
- **구현**: [구현 방식]

---

## 트러블슈팅

### [문제 제목 — 예: XPC 연결이 간헐적으로 끊기는 문제]

- **문제**: [어떤 현상이 발생했는지]
- **원인**: [분석 과정과 밝혀낸 원인]
- **해결**: [적용한 해결 방법]
- **결과**: [해결 후 개선된 점 — 수치가 있으면 좋음]

### [문제 제목]

- **문제**:
- **원인**:
- **해결**:
- **결과**:

---

## 성과

- [정량적 성과 — 예: 패킷 처리 지연 N% 감소, 크래시율 N% → N%]
- [정성적 성과 — 예: 사내 N개 부서 도입, 고객사 N곳 납품]

---

## 회고

- **잘한 점**: [프로젝트에서 잘 됐던 것]
- **아쉬운 점**: [개선하고 싶은 것]
- **배운 점**: [기술적·협업적으로 배운 것]
