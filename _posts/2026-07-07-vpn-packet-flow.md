---
layout: post
title: "VPN 패킷 흐름 — NEFilterPacketProvider와 NEPacketTunnelProvider의 관계"
date: 2026-07-07
categories: [macOS]
description: "NEFilterPacketProvider에서 drop된 패킷이 NEPacketTunnelProvider까지 도달하는지, VPN 터널의 패킷 캡슐화가 실제로 어떻게 이루어지는지 OSI 계층 관점에서 정리합니다."
---

## NEFilterPacketProvider에서 drop하면 NEPacketTunnelProvider에서 읽히는가?

**아니요, 읽지 못합니다.**

`NEFilterPacketProvider`가 drop하면 그 패킷은 커널에서 버려지기 때문에 `NEPacketTunnelProvider`의 `readPackets()`까지 도달하지 않습니다.

실행 순서는 다음과 같습니다.

```
OS 네트워크 스택
      ↓
NEFilterPacketProvider  ← 여기서 drop되면 끝
      ↓ (pass한 경우만)
utun0
      ↓
NEPacketTunnelProvider readPackets()
```

`NEFilterPacketProvider`가 `utun0`보다 먼저 패킷을 가로채는 위치에 있어서, drop 결정이 나면 터널 인터페이스까지 패킷이 내려가지 않습니다.

---

## VPN 패킷 흐름 (OSI 관점)

### 환경 전제

- VPN 대역: `10.0.0.0/8`
- 목적지: `10.10.20.5`
- 터널 인터페이스: `utun0`
- 물리 인터페이스: `en0`
- VPN 서버 공인 IP: `203.0.113.1`

### 첫 번째 사이클 — 브라우저 → utun0

```
7  HTTP 요청 생성
4  TCP 세그먼트 (dst port: 443)
3  IP 패킷 (dst: 10.10.20.5)
   → 라우팅 테이블: 10.0.0.0/8 via utun0
2  (가상 인터페이스, 실제 프레임 없음)
```

`utun0`에 패킷이 쓰여지는 순간 `NEPacketTunnelProvider`가 읽어갑니다.

### 두 번째 사이클 — NEPacketTunnelProvider → en0

`NEPacketTunnelProvider`가 원본 패킷을 암호화하고 UDP 소켓으로 `send()` 합니다. 7, 6, 5계층 없이 3계층부터 시작합니다.

```
3  IP 패킷 조립 (dst: 203.0.113.1, payload: UDP + 암호화된 원본 패킷)
2  이더넷 프레임 (dst MAC: 공유기)
1  en0으로 물리 전송
```

4계층 UDP는 3계층 IP 패킷을 조립할 때 payload로 이미 포함된 상태입니다. 독립적인 단계로 끼어드는 게 아닙니다.

### VPN 서버 — 역순

```
1 → 2 → 3: IP 패킷 수신, dst가 자신 → 위로 올림
UDP 51820 → WireGuard 복호화 → 원본 IP 패킷 추출
추출된 패킷 dst: 10.10.20.5 → 사내 네트워크로 포워딩
```

### 핵심 사실

**터널의 본질** — 원본 3계층 IP 패킷이 새로운 3계층 IP 패킷의 payload로 들어갑니다.

```
[2 이더넷][3 IP(dst:203.0.113.1)][UDP][암호화된 원본 IP 패킷]
```

**라우팅 테이블에 두 경로가 반드시 공존해야 합니다.**

```
10.0.0.0/8     → utun0   (VPN 대역)
203.0.113.1/32 → en0     (VPN 서버 자체)
```

두 번째 엔트리가 없으면 VPN 서버행 패킷도 `utun0`으로 들어가 무한 루프가 발생합니다.

---

## VPN 패킷 캡슐화 흐름

### 환경

- 로컬 IP: `192.168.30.51` (en0)
- 터널 IP: `10.8.0.2` (utun0)
- 목적지: `10.10.20.5:443`
- VPN 서버: `203.0.113.1`

### 1. 브라우저 (7계층)

HTTP 요청 데이터만 만들어서 소켓 API로 OS에 넘깁니다. dst IP `10.10.20.5`만 알고 있습니다.

### 2. OS 네트워크 스택이 캡슐화

라우팅 테이블 조회 → `10.0.0.0/8 via utun0` → 나가는 인터페이스가 `utun0`으로 결정됩니다.

src IP를 `utun0`에 할당된 `10.8.0.2`로 자동으로 채웁니다.

```
4계층: TCP 헤더  (src port: 1534, dst port: 443)
3계층: IP 헤더   (src: 10.8.0.2, dst: 10.10.20.5)
2계층: utun0은 가상 인터페이스라 프레임 없음
```

### 3. NEPacketTunnelProvider 개입

`utun0`에 패킷이 도착하면 `NEPacketTunnelProvider`가 읽어서 암호화합니다. 이걸 payload로 삼아 새 패킷을 조립합니다. src IP는 이번엔 실제 물리 인터페이스 `en0`의 IP인 `192.168.30.51`을 씁니다.

```
3계층: IP 헤더  (src: 192.168.30.51, dst: 203.0.113.1)
       + UDP + 암호화된 원본 패킷
2계층: 이더넷 프레임 (dst MAC: 공유기)
1계층: en0으로 물리 전송
```

### 최종 바이트 구조

```
[ 이더넷 헤더 ]
[ IP  src: 192.168.30.51 / dst: 203.0.113.1 ]
[ UDP dst port: 51820 ]
[ 암호화된 { IP src: 10.8.0.2 / dst: 10.10.20.5 / TCP / HTTP } ]
```
