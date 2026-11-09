---
title: "PRIBIT Connect(ZTNA) 유지보수 및 추가 기능 개발"
period: "2025.01 - 2025.12"
description: "운영 중인 ZTNA 에이전트에 iOS 선접속 후인증, TOTP·SMS 추가 인증, IPv6 설정 기능을 개발하고, iOS App과 Extension 사이의 컨테이너 파일 통신 병목을 없앴습니다. 고객사별 요구사항(포스코인터내셔널, 한화, 삼양식품)도 대응했습니다."
skills: [Swift, Network Extension, NEPacketTunnelProvider, NEFilterDataProvider, iOS, macOS]
order: 2
---

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 소속 | 프라이빗테크놀로지(주) 연구소 모바일 파트 |
| 기간 | 2025.01 - 2025.12 (ZTP 개발과 병행) |
| 인원 | [확인 필요] |
| 담당 | macOS·iOS 에이전트 기능 개발, 최적화, 고객사 대응 |
| 플랫폼 | macOS, iOS |

2024년에 고도화한 [PRIBIT Connect 2.6]({{ '/portfolio/packetgo-switch-advancement/' | relative_url }})(ZTNA)의 유지보수와 추가 기능 개발입니다. 하반기부터는 [ZTP 프로젝트]({{ '/portfolio/packetgo-ztp/' | relative_url }}) 설계·개발과 병행했습니다.

---

## 배경 및 목표

- **배경**: 운영 중인 제품에 기획 변경, 비즈니스 흐름 변경, 고객사별 요구사항이 계속 들어왔습니다.
- **목표**: 고객사 이슈를 최우선으로 처리하면서 인증·네트워크 기능을 강화하고 성능 병목을 없애기

---

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Language | Swift, C++ |
| Apple Platform | NEPacketTunnelProvider, NEFilterDataProvider, App Extension, App Group 컨테이너 |
| Auth | TOTP, SMS(URL) |

---

## 담당 역할 및 기여

- iOS 선접속 후인증 기능 개발
- 추가 인증 타입(TOTP, SMS URL) 구현
- 네트워크 설정 IPv6 활성화·비활성화 기능 구현
- TCP SYN 관련 수정 사항 적용
- iOS App ↔ App Extension 통신 성능 최적화
- 고객사 요구사항 대응, UI 수정, 버그 수정

---

## 주요 기능 및 구현

### 1. iOS 선접속 후인증

- **설명**: 먼저 연결된 세션을, 이후 인증 결과에 따라 끊을 수 있어야 했습니다.
- **문제**: NEFilterDataProvider는 **이미 허용한 세션을 끊을 수 없는** 제한이 있습니다.
- **구현**: 세션 차단을 NEPacketTunnelProvider 쪽에서 처리하도록 바꿔, 선접속된 세션을 끊을 수 있게 했습니다. [확인 필요 — 터널에서 차단한 구체적인 방식]

### 2. 추가 인증 (TOTP, SMS)

- **설명**: 강화된 인증 타입으로 TOTP와 SMS(URL) 인증을 추가했습니다.

### 3. 고객사 요구사항 대응

| 고객사 | 요구사항 | 대응 |
| --- | --- | --- |
| 포스코인터내셔널 | 엔터프라이즈 앱 프로비저닝 프로파일 이슈 | 프로파일 갱신 및 재배포 |
| 한화 | Server Configuration 대신 네트워크 경계 대역 기준 라우팅 | 터널 라우팅을 네트워크 대역 설정으로 적용 |
| 삼양식품 | 자동 로그인, IPv6 활성화 여부 설정 등 | 기능 개발 |

---

## 트러블슈팅

### iOS App과 Extension 사이 컨테이너 파일 통신 병목

- **문제**: iOS App과 App Extension은 공유 컨테이너의 파일로 데이터를 주고받는데, 이 통신이 느려 패킷 제어 알림과 비즈니스 로직에 병목이 생겼습니다.
- **원인**: [확인 필요 — 예: 하나의 파일을 여러 주체가 읽고 써서 대기·충돌 발생]
- **해결**: 통신에 쓰는 **파일과 파일을 관리하는 주체를 추가**해 역할을 나눴습니다.
- **결과**: 통신 속도가 빨라져 패킷 제어 알림과 비즈니스 로직의 병목이 사라졌습니다. [확인 필요 — 측정 수치가 있다면]

---

## 성과

- iOS 선접속 후인증, TOTP·SMS 인증, IPv6 설정 기능 출시 (2025년 기준 달성도 85%)
- App ↔ Extension 통신 병목 제거
- 포스코인터내셔널, 한화, 삼양식품 요구사항 대응

---

## 회고

- **배운 점**: Network Extension의 Provider마다 할 수 있는 일과 제한이 분명히 다르다는 것을 배웠습니다. 요구사항을 받으면 먼저 어느 Provider에서 처리할 수 있는지 확인하는 습관이 생겼습니다.
- **아쉬운 점**: 운영 중인 제품을 유지보수하면서 구조적 한계(테스트 불가, 사이드 이펙트)를 계속 느꼈고, 이 경험이 ZTP 아키텍처 설계로 이어졌습니다.
