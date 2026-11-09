---
title: "PacketGO Switch 고도화 및 POC — PRIBIT Connect 2.6"
period: "2024.05 - 2024.12"
description: "macOS·iOS 보안 에이전트(PRIBIT Connect 2.6)의 기능 고도화와 고객사 POC 대응. 대량 패킷 필터링 시 화면 끊김을 Instruments로 분석해 Animation Hitch를 약 60% 줄이고, SPM 모듈화로 유지보수 구조를 개선했습니다."
skills: [Swift, SwiftUI, Combine, Network Extension, System Extension, Instruments, Swift Package Manager]
order: 3
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 연구소 Mobile 파트 |
| 기간 | 2024.05 - 2024.12 (2025년 유지보수·추가 개발과 ZTP 설계로 이어짐) |
| 인원 | [확인 필요 — 예: Apple 파트 N명] |
| 담당 | macOS·iOS 에이전트 기능 개발, 성능 개선, 배포 |
| 플랫폼 | macOS (M 시리즈, Intel), iOS |
| 배포 | macOS: 공증·패키징 배포 / iOS: App Store, TestFlight |

2023년에 새로 개발한 [PacketGO Switch 에이전트]({{ '/portfolio/packetgo-switch/' | relative_url }})를 **PRIBIT Connect 2.6**으로 고도화한 프로젝트입니다. 2.5 이후 바뀐 기획과 고객사 POC 요구사항을 반영해 비즈니스 로직과 UI를 개발했고, 품질 인증(QA)을 거쳐 macOS는 공증·패키징, iOS는 App Store로 배포했습니다.

---

## 배경 및 목표

- **배경**
  - 고객사 POC가 늘면서 요구사항 반영과 버그 대응 속도가 중요해졌습니다.
  - 네트워크 필터링에서 많은 양의 패킷이 처리되면 에이전트 화면이 끊기는 문제가 있었습니다.
  - 프로젝트가 커지면서 기능 추가·수정 시 유지보수와 UI 테스트에 시간이 오래 걸렸습니다.
- **목표**
  - PRIBIT Connect 2.6 기획과 POC 요구사항 반영
  - 사용자 통제(보안 컴플라이언스) 기능 강화
  - UI 성능 개선, 유지보수하기 쉬운 구조로 개선

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++, Objective-C++ |
| UI | SwiftUI, Combine |
| Apple Platform | Network Extension, System Extension |
| Modularization | Swift Package Manager |
| Tooling | Xcode Instruments, TestFlight, Git |
| Distribution | Developer ID, Notarization, Installer Package (macOS) / App Store Connect, TestFlight (iOS) |

---

## 담당 역할 및 기여

- **기능 고도화**: 2.6 기획과 고객사 POC 요구사항에 맞춘 비즈니스 로직·UI 개발
- **보안 컴플라이언스 개발**: 프로세서(M 시리즈, Intel)와 OS 버전을 고려한 사용자 행위 통제 기능 (IPv6, 스크린 세이버, 방화벽 등)
- **UI 성능 개선**: 대량 패킷 처리 시 화면 끊김 해결
- **OS 업데이트 대응**: macOS 15 이상에서 바뀐 네트워크 필터링 동작에 맞춰 버그 수정
- **구조 개선**: SPM 모듈 분리, UI 테스트용 Target 분리
- **협업 프로세스**: QA 버그 수정을 위한 Git 브랜치 전략 제안 및 적용
- **배포**: macOS 공증·패키징, iOS App Store 심사·배포, 고객사 TestFlight 권한 관리

---

## 주요 기능 및 구현

### 1. 보안 컴플라이언스 — 사용자 행위 통제

- **설명**: 주요 네트워크 기능 외에, 기획에 맞춰 단말 사용자의 행위를 통제하는 기능을 개발했습니다. (IPv6, 스크린 세이버, 방화벽 등)
- **구현**: Apple 보안 정책상 App Store로 배포하는 iOS는 행위 통제 범위가 좁고, 공증·패키징으로 배포하는 macOS는 훨씬 넓습니다. 그래서 macOS에서는 **시스템 레벨에서 통제할 수 있는 Extension과 권한**을 연구해 적용했고, M 시리즈와 Intel, OS 버전별로 동작을 확인했습니다. [확인 필요 — 기능별로 사용한 API/Extension]

### 2. SPM 기반 모듈화와 UI 테스트 Target 분리

- **설명**: 프로젝트가 커지면서 생긴 유지보수·테스트 부담을 줄였습니다.
- **구현**
  - 기능을 **Swift Package Manager 모듈**로 분리해 따로 개발·테스트하고, 기존 코드는 모듈의 인터페이스만 보고 결합하도록 바꿨습니다.
  - UI와 비즈니스 로직을 분리하고 **UI 테스트 전용 Target**을 만들어, 전체 앱을 실행하지 않고도 화면을 개발·확인할 수 있게 했습니다. → UI 개발·테스트 시간 단축

### 3. 배포와 인증서·프로파일 관리

- **설명**: 두 플랫폼의 배포 방식이 달라 각각 관리했습니다.
- **구현**: macOS는 행위 통제 권한을 포함하므로 Developer ID 서명·공증 후 패키지로 배포했습니다. iOS는 App Store 심사 정책에 맞춰 심사·배포했습니다. Apple 개발자 계정의 인증서, 프로파일, 기기, 식별자를 관리하며 고객사에 TestFlight 권한을 부여하고 테스트했습니다.

---

## 트러블슈팅

### 대량 패킷 필터링 시 에이전트 화면이 끊기는 문제

- **문제**: 네트워크 필터링에서 많은 양의 패킷이 제어되면, 제어 기록을 보여주는 화면이 끊기고 반응이 느려졌습니다.
- **원인**: Instruments로 분석한 결과 [확인 필요 — 예: 기록 업데이트가 메인 스레드에서 처리되고, 업데이트마다 리스트 전체가 다시 그려짐]
- **해결**: 데이터 처리를 **멀티 스레딩**으로 메인 스레드에서 분리하고, 대량 업데이트에 맞는 **UI 컴포넌트로 변경**했습니다. [확인 필요 — 바꾼 컴포넌트, 업데이트 묶음 처리 여부]
- **결과**: **Animation Hitch 약 60% 감소**
- 관련 글: [Swift Concurrency 내부 동작]({% post_url 2026-09-08-swift-concurrency-internals %})

### macOS 15 이상에서 네트워크 필터링 버그

- **문제**: macOS 15.0 이상에서 네트워크 필터링 관련 버그가 발생했습니다.
- **원인**: OS 업데이트로 네트워크 필터링 기술이 바뀌었습니다. [확인 필요 — 바뀐 동작이나 Deprecated API]
- **해결**: 바뀐 동작을 파악해 수정하고, Deprecated 메서드가 영향을 줄 수 있는 로직(패킷 정보 수집 등)을 OS 버전 변화에 대응하기 쉬운 구조로 설계했습니다.
- **결과**: macOS 15 이상에서 정상 동작

### 이슈 대응 방식

이슈를 처리할 때는 아래 과정을 지켰습니다.

1. 이슈에 적힌 재현 절차를 테스트하고, 기획서를 검토해 **같은 문제가 생길 수 있는 다른 흐름**까지 테스트
2. 기존 기능에 영향이 없도록 역할을 분리해 사이드 이펙트를 줄이며 수정
3. 원인을 커밋 메시지와 이슈 트래커(다우오피스)에 남기고, 트러블슈팅은 Apple 공식 문서를 참고해 Notion에 정리
4. 개발 단말뿐 아니라 **OS 버전과 프로세서가 다른 단말**에서도 테스트한 뒤 배포

---

## 성과

- PRIBIT Connect 2.6 macOS·iOS 에이전트 개발 및 배포, 고객사 POC 대응
- 대량 패킷 처리 시 **Animation Hitch 약 60% 감소**
- SPM 모듈화와 UI 테스트 Target 분리로 UI 개발·테스트 시간 단축
- QA 버그 수정용 Git 브랜치 전략 제안·적용

---

## 회고

- **배운 점**: 같은 Apple 플랫폼이라도 배포 방식(App Store / 공증)에 따라 할 수 있는 통제 범위가 크게 다르다는 것을 경험했습니다. 성능 문제는 추측하지 않고 Instruments로 측정해서 원인을 찾아야 한다는 것도 배웠습니다.
- **아쉬운 점**: 2.6을 진행하면서 테스트 방법과 유지보수 구조의 한계를 느꼈습니다. 이를 바탕으로 다음 프로젝트인 [PacketGo ZTP]({{ '/portfolio/packetgo-ztp/' | relative_url }})의 구조 설계, 형상 관리, 테스트 방식을 제안했습니다.
