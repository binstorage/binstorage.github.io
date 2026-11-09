---
title: "PacketGo ZTP — macOS·iOS 에이전트 아키텍처 설계 및 개발"
period: "2025.08 - 진행 중"
description: "이전 ZTNA 프로젝트의 구조적 문제를 분석해 차세대 제로트러스트 플랫폼 ZTP의 macOS·iOS 에이전트 아키텍처 설계를 주도했습니다. 타겟별 모듈화, TCA, 프로토콜 기반 의존성 주입을 적용하고, 두 Network Extension Provider를 결합해 패킷 제어를 구현했습니다."
skills: [Swift, TCA, Swift Package Manager, Network Extension, System Extension, XCTest, C++]
order: 1
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 연구소 모바일 파트 |
| 기간 | 2025.08 - 진행 중 |
| 인원 | [확인 필요] |
| 담당 | macOS·iOS 에이전트 **아키텍처 설계 주도**, 패킷 제어 프로세스 개발, 테스트 환경 구축 |
| 플랫폼 | macOS, iOS |

**PacketGo ZTP**는 회사의 차세대 제로트러스트 플랫폼입니다. 저는 Apple 플랫폼 에이전트의 전체 구조 설계를 맡았습니다.

ZTP 설계는 2년간 개발·유지보수한 ZTNA 프로젝트([PacketGO Switch]({{ '/portfolio/packetgo-switch/' | relative_url }}) → [PRIBIT Connect 2.6]({{ '/portfolio/packetgo-switch-advancement/' | relative_url }}))에서 겪은 문제를 분석하는 것에서 출발했습니다.

---

## 배경 및 목표

ZTNA 프로젝트에서 겪은 문제는 다음과 같았습니다.

| 문제 | 영향 |
| --- | --- |
| 하나의 프로젝트에 모든 타겟이 존재 | 수정 범위를 예측하기 어렵고 사이드 이펙트 발생 |
| 많은 전처리(`#if`) 분기 | 가독성 저하 |
| 책임 분리 부족, MVI 패턴에서 비대해진 ViewModel | 유지보수 어려움 |
| 테스트할 수 없는 구조 | Preview, Unit Test 불가 → 모든 확인을 실기기에서 수행 |
| 코드 컨벤션 부재 | 협업 비용 증가 |

**목표**: 이 문제를 구조적으로 해결해 유지보수와 테스트가 쉬운 에이전트를 만들고, 품질 인증과 고객사 대응 속도를 높이는 것

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++ |
| Architecture | TCA (The Composable Architecture), 프로토콜 지향 의존성 주입 |
| Modularization | Swift Package Manager, Framework, Build Phase |
| Apple Platform | System Extension (NEFilterDataProvider + NEFilterPacketProvider), Privileged Helper Tool, XPC |
| Test | XCTest (Unit Test), Micro App, SwiftUI Preview |

---

## 아키텍처

```
App ──────────▶ UILayerModule ──▶ Domain (Swift Package)
App ──────────▶ SystemExtension ─▶ Domain
App ──XPC─────▶ HelperTool (Privileged Daemon) ─▶ Domain
```

- **타겟별 모듈 분리**: App, SystemExtension, HelperTool이 각자의 책임만 갖고, 공통 비즈니스 로직은 `Domain` 패키지에 둡니다.
- **Domain 프로토콜 추상화**: 비즈니스 로직을 프로토콜로 정의하고, 구현체는 의존성 주입으로 연결합니다.
- **TCA**: 상태와 액션을 Reducer 단위로 나눠 ViewModel 비대화 문제를 해결했습니다.

---

## 담당 역할 및 기여

- **아키텍처 설계 주도**: 타겟별 모듈 구조, TCA 적용, 모듈 간 의존성 주입 체계, 전체 프로세스 흐름 정의·구현
- **패킷 제어 프로세스 개발**: NEFilterDataProvider와 NEFilterPacketProvider를 결합한 System Extension 구현
- **PGDFF 모듈 구현**: 패킷 허용/차단을 판단하던 기존 vgw 모듈을 코드 컨벤션과 코드 깊이(depth)를 개선해 새로 구현
- **테스트 환경 구축**: Unit Test 작성·자동화, Micro App 테스트, Preview 가능한 구조
- **기술 공유**: 모듈화, TCA, Unit Test, Micro App Test 도입을 팀원과 논의하고 학습 자료 공유

---

## 주요 기능 및 구현

### 1. 두 Network Extension Provider를 결합한 패킷 제어

- **문제**: 고도화된 ZTP 네트워크 필터링은 패킷을 보낸 **로컬 정보(프로세스, local endpoint)**가 필요했는데, ZTNA 구조에서는 이 정보를 얻을 수 없었습니다.
- **구현**: 하나의 System Extension 안에서 두 Provider를 역할별로 결합했습니다.
  1. **NEFilterDataProvider**: 패킷을 감지하고 Flow 객체에서 프로세스 이름과 ID를 추출해 System Extension의 관리 객체에 저장
  2. **NEFilterPacketProvider**: 관리 객체에 저장된 정보와 Raw 패킷 정보를 함께 보고 허용 여부 판단
- 관련 글: [VPN 패킷 흐름 — NEFilterPacketProvider와 NEPacketTunnelProvider의 관계]({% post_url 2026-07-07-vpn-packet-flow %})

### 2. 서버와 독립적인 개발 — Domain 프로토콜 추상화와 Mock

- **문제**: 서버(컨트롤러) 개발 일정에 맞춰 기다리면 클라이언트 개발이 늦어집니다.
- **구현**: Domain 모듈(비즈니스 로직)을 프로토콜로 추상화하고, **Mock 객체**로 전체 비즈니스 로직과 프로세스 흐름을 테스트했습니다. 서버가 준비되면 실제 구현체로 바꾸기만 하면 되는 구조입니다.

### 3. 테스트 가능한 구조 — Unit Test, Preview, Micro App

- **구현**: 모듈화, 의존성 정리, 프레임워크 설정으로 ZTNA에서는 불가능했던 **SwiftUI Preview와 Unit Test**를 가능하게 했습니다. 타겟별로 프로젝트를 나눠 테스트 시간도 줄였습니다.
- **효과**: 예를 들어 컨트롤러 통신 프로토콜이 바뀌어도 해당 모듈만 빠르게 테스트할 수 있게 됐습니다.

### 4. TCA 도입

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

- ZTP macOS·iOS 에이전트 아키텍처 설계 및 개발 (2025년 기준 60% 진행)
- ZTNA에서 불가능했던 Preview·Unit Test 환경 구축 → 프로토콜 변경 등 수정 사항의 테스트 속도 향상
- 서버 일정과 독립적으로 비즈니스 로직 개발·검증
- 모듈화, TCA, 테스트 방식을 팀에 공유해 협업 체계 개선

---

## 회고

- **잘한 점**: 이전 프로젝트를 회고해서 찾은 문제를 다음 프로젝트 설계에 직접 반영했습니다. 사이드 프로젝트에서 먼저 검증한 Tuist, Clean Architecture, TCA를 회사 프로젝트에 도입했습니다.
- **배운 점**: 모듈화는 코드만 나누는 일이 아니라 **링킹과 실행 환경까지 함께 설계하는 일**이라는 것을 HelperTool 크래시를 겪으며 배웠습니다.
- **아쉬운 점**: [작성 필요]
