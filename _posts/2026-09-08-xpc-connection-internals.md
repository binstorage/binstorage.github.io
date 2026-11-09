---
layout: post
title: "XPC 연결의 내부 동작 — Mach 포트부터 메시지 전송까지"
date: 2026-09-08
categories: [macOS]
description: "프로세스 A가 connect하고 프로세스 B가 listen할 때, 커널 수준에서 Mach 포트가 어떻게 생성되고 메시지가 어떻게 전달되는지 XPC의 전체 흐름을 정리합니다. Endpoint Security 익스텐션 사례와 터미널 실습까지 다룹니다."
---

## XPC란 무엇인가

XPC(Cross Process Communication)는 macOS에서 프로세스 간 통신을 수행하는 프레임워크입니다. 내부적으로 Mach 메시지를 기반으로 동작하며, libxpc와 launchd가 협력하여 연결을 중개합니다.

XPC는 직접 Mach 포트를 다루는 복잡함을 숨기고, 직렬화된 메시지 딕셔너리 또는 NSXPCConnection 기반의 Objective-C 인터페이스를 제공합니다.

---

## 핵심 개념 — Mach 포트

XPC를 이해하려면 먼저 Mach 포트를 알아야 합니다.

### Mach 포트란

macOS 커널(XNU)의 Mach 계층이 제공하는 **단방향 메시지 큐**입니다. 파일 디스크립터가 파일 I/O의 핸들인 것처럼, Mach 포트는 IPC의 핸들입니다.

```
┌─────────────────────────────────────────────┐
│                  XNU 커널                    │
│                                             │
│   ┌─────────┐    메시지 큐    ┌─────────┐   │
│   │ 포트 A  │ ◄───────────── │ 포트 B  │   │
│   │ (수신)  │                │ (송신)  │   │
│   └─────────┘                └─────────┘   │
│       ▲                          ▲          │
└───────┼──────────────────────────┼──────────┘
        │                          │
   프로세스 B                 프로세스 A
   (receive right)           (send right)
```

### 포트 권한(Port Rights)

Mach 포트에는 권한 개념이 있습니다.

| 권한 | 설명 |
|------|------|
| **Receive right** | 포트에서 메시지를 꺼내 읽을 수 있는 권한. 한 포트당 하나의 태스크만 보유 |
| **Send right** | 포트에 메시지를 넣을 수 있는 권한. 여러 태스크가 동시에 보유 가능 |
| **Send-once right** | 단 한 번만 메시지를 보낼 수 있는 일회용 권한 |

프로세스 A가 프로세스 B에게 메시지를 보내려면, 프로세스 B가 receive right를 가진 포트에 대한 **send right**를 프로세스 A가 보유해야 합니다.

---

## launchd의 역할 — 이름 서버

프로세스 A가 프로세스 B의 Mach 포트를 어떻게 알 수 있을까요? 여기서 **launchd**가 등장합니다.

launchd는 macOS의 PID 1 프로세스이면서 동시에 **Mach 포트 이름 서버(bootstrap server)** 역할을 합니다.

```
┌──────────────────────────────────────────────────────┐
│                      launchd                          │
│                                                      │
│   서비스 이름 등록부 (bootstrap namespace)             │
│   ┌────────────────────────────────────────────┐     │
│   │ "com.example.myservice"  → Mach port 0x307 │     │
│   │ "com.example.helper"     → Mach port 0x50b │     │
│   │ ...                                        │     │
│   └────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

서비스(프로세스 B)는 자신의 Mach 포트를 **문자열 이름과 함께** launchd에 등록합니다. 클라이언트(프로세스 A)는 그 문자열 이름으로 launchd에게 send right를 요청합니다.

이 과정은 `LaunchDaemon plist`의 `MachServices` 키로 선언됩니다.

```xml
<key>MachServices</key>
<dict>
    <key>com.example.helper</key>
    <true/>
</dict>
```

---

## 전체 연결 흐름 — 프로세스 A(클라이언트)와 프로세스 B(서버)

프로세스 A가 connect하고, 프로세스 B가 listen하는 전체 과정을 단계별로 설명합니다.

### 1단계: 프로세스 B 등록 (listen 준비)

프로세스 B(서버/데몬)가 시작되면서 XPC 리스너를 생성합니다.

```swift
// 프로세스 B (서버)
let listener = NSXPCListener(machServiceName: "com.example.myservice")
listener.delegate = self
listener.resume()
RunLoop.current.run()
```

이때 커널 수준에서 일어나는 일:

```
프로세스 B                    커널                      launchd
    │                         │                          │
    │  mach_port_allocate()   │                          │
    │ ──────────────────────► │                          │
    │  ◄── receive right ──── │                          │
    │                         │                          │
    │        bootstrap_check_in("com.example.myservice") │
    │ ──────────────────────────────────────────────────► │
    │                         │    포트를 이름에 바인딩    │
    │  ◄───── 확인 ──────────────────────────────────── │
    │                         │                          │
    │  [수신 대기 상태]        │                          │
```

`NSXPCListener`가 `resume()`되면:

1. 커널이 Mach 포트를 할당하고 프로세스 B에게 **receive right**를 부여합니다.
2. 프로세스 B는 `bootstrap_check_in()`을 통해 launchd에 "이 이름으로 등록하겠다"고 알립니다.
3. launchd는 서비스 이름과 포트를 매핑하여 자신의 네임스페이스에 저장합니다.
4. 프로세스 B는 해당 포트에서 메시지가 도착하기를 기다립니다.

> **on-demand 실행**: `KeepAlive`가 `false`인 데몬은 이 시점에 아직 프로세스가 존재하지 않을 수 있습니다. launchd가 해당 서비스 이름의 포트를 **대리 보유**하고 있다가, 클라이언트 연결 요청이 오면 그때 프로세스 B를 fork/exec합니다.

### 2단계: 프로세스 A 연결 요청 (connect)

프로세스 A(클라이언트)가 XPC 연결을 생성합니다.

```swift
// 프로세스 A (클라이언트)
let connection = NSXPCConnection(machServiceName: "com.example.myservice",
                                 options: .privileged)
connection.remoteObjectInterface = NSXPCInterface(with: MyProtocol.self)
connection.resume()
```

커널 수준의 동작:

```
프로세스 A                    커널                      launchd
    │                         │                          │
    │  bootstrap_look_up("com.example.myservice")        │
    │ ──────────────────────────────────────────────────► │
    │                         │                          │
    │                         │  [프로세스 B가 없으면]     │
    │                         │  fork/exec 프로세스 B     │
    │                         │  ◄── check_in ────────── │
    │                         │                          │
    │  ◄── send right ────────────────────────────────── │
    │                         │                          │
    │  mach_port_allocate()   │                          │
    │ ──────────────────────► │                          │
    │  ◄── receive right ──── │ (응답용 reply 포트)       │
    │                         │                          │
```

1. 프로세스 A가 `bootstrap_look_up()`으로 launchd에게 서비스 이름에 대한 **send right**를 요청합니다.
2. launchd는 해당 이름에 매핑된 포트의 send right를 프로세스 A에게 복사하여 전달합니다.
3. 프로세스 B가 아직 실행 중이 아니면, launchd가 이 시점에 프로세스 B를 시작합니다.
4. 프로세스 A는 자신도 **응답 수신용 포트**(reply port)를 커널에 할당합니다.

### 3단계: 연결 수립

이제 프로세스 A는 프로세스 B의 포트에 대한 send right를 가지고 있습니다. XPC 프레임워크는 초기 핸드셰이크 메시지를 교환하여 양방향 채널을 구성합니다.

```
프로세스 A                        커널                      프로세스 B
    │                              │                          │
    │  ① 연결 요청 메시지 전송       │                          │
    │  (send right로 B의 포트에)    │                          │
    │ ───────────────────────────► │                          │
    │                              │  mach_msg 큐에 적재       │
    │                              │ ────────────────────────► │
    │                              │                          │
    │                              │    ② B가 수락/거부 판단    │
    │                              │    listener(_ :           │
    │                              │     shouldAcceptNew       │
    │                              │     Connection:)          │
    │                              │                          │
    │                              │  ◄─ ③ 수락 응답 ──────── │
    │                              │     (A의 reply 포트로)    │
    │  ◄────────────────────────── │                          │
    │                              │                          │
    │  ════ 양방향 XPC 채널 수립 ══════════════════════════   │
```

프로세스 B의 delegate에서 연결 수락이 이루어집니다:

```swift
// 프로세스 B
func listener(_ listener: NSXPCListener,
              shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
    connection.exportedInterface = NSXPCInterface(with: MyProtocol.self)
    connection.exportedObject = MyService()
    connection.resume()
    return true  // 수락
}
```

이 시점에서 **양방향 통신이 가능**해집니다. 내부적으로 각 프로세스가 상대방의 포트에 대한 send right를 보유하게 됩니다.

```
┌──────────────┐                              ┌──────────────┐
│  프로세스 A   │                              │  프로세스 B   │
│              │   send right ──────────────►  │              │
│  (클라이언트) │                              │  (서버/데몬)  │
│              │  ◄────────────── send right   │              │
└──────────────┘                              └──────────────┘
        │                                            │
        │          ┌──────────────────┐              │
        └─────────►│    XNU 커널      │◄─────────────┘
                   │  Mach 메시지 큐   │
                   └──────────────────┘
```

---

## 메시지 전송 원리

연결이 수립된 후 실제 메시지가 어떻게 전달되는지 설명합니다. 먼저 NSXPCConnection의 **프록시 메서드 호출 한 번**이 어떤 파이프라인을 거치는지 보고, 이어서 커널 수준에서 Mach 메시지가 어떻게 이동하는지 살펴봅니다.

### 프록시 호출이 XPC 메시지가 되기까지

```swift
let proxy = connection.remoteObjectProxyWithErrorHandler { error in
    print("XPC 에러:", error)
} as? MyProtocol
```

| 단계 | 일어나는 일 |
|------|------------|
| **1. 프록시 획득** | `remoteObjectProxy`가 돌려주는 것은 실제 원격 객체가 아니라 `_NSXPCDistantObject`라는 프록시입니다. 프로토콜을 준수하는 것처럼 보이지만 메서드 구현(IMP)은 없습니다. |
| **2. `forwardInvocation:`으로 떨어짐** | 프록시는 `methodSignatureForSelector:`에는 응답하지만 IMP가 없으므로, Objective-C 런타임 디스패치가 실패하고 `forwardInvocation:`이 호출됩니다. 이때 셀렉터와 인자가 `NSInvocation`으로 캡처됩니다. |
| **3. 인자 타입 분석** | `NSXPCInterface`는 연결 셋업 시점에 프로토콜을 분석해 둡니다(`setClasses(_:for:argumentIndex:ofReply:)` 등). 어떤 인자가 reply 블록인지, `NSSecureCoding` 객체인지, 또 다른 XPC 프록시인지 미리 알아야 직렬화 방식을 정할 수 있습니다. |
| **4. 인코딩** | `NSInvocation`이 `xpc_object_t`(사실상 dictionary)로 변환됩니다. 셀렉터 이름과 인코딩된 인자가 담기며, `NSSecureCoding` 객체는 keyed archive 방식으로 직렬화됩니다. |
| **5. `mach_msg()` 전송** | dictionary가 Mach 포트로 전송됩니다. reply 블록이 있으면 별도의 **reply 포트**가 만들어져 함께 전달됩니다. |
| **6. 수신측 invoke** | 리스너 쪽에서 메시지를 `NSInvocation`으로 재구성하고, `exportedObject`에 대해 `invoke(withTarget:)`을 호출합니다. 이때 비로소 실제 메서드 본문이 실행됩니다. |
| **7. reply 경로** | 서버가 reply 블록을 호출하면 그 호출도 대칭적으로 캡처 → 직렬화 → reply 포트로 전송되고, 클라이언트 쪽에서 원래 블록이 실행됩니다. |

> **핵심**: 클라이언트 코드에서는 일반 메서드 호출처럼 보이지만, 매 호출마다 `forwardInvocation:` 트랩 → `NSInvocation` 캡처 → XPC 메시지 인코딩 → `mach_msg` 전송 → 원격 invoke → (필요 시) reply 전송 파이프라인이 실행됩니다. 그래서 XPC 호출은 일반 Objective-C 메시지 전송보다 오버헤드가 훨씬 크고, 인자로 넘긴 객체가 `NSSecureCoding`을 지키지 않으면 4단계 인코딩에서 런타임 에러가 발생합니다.

### 프로세스 A → 프로세스 B 메시지 전송

```swift
// 프로세스 A
let proxy = connection.remoteObjectProxy as! MyProtocol
proxy.doSomething(arg: "hello") { result in
    print(result)
}
```

이 한 줄의 호출이 내부적으로 거치는 과정:

```
프로세스 A (유저 스페이스)
┌───────────────────────────────────────────┐
│ 1. NSXPCConnection이 메서드 호출을 가로챔   │
│    (NSProxy 기반 프록시 객체)               │
│                                           │
│ 2. 직렬화 (serialization)                  │
│    - 셀렉터 이름: "doSomething:withReply:" │
│    - 인자: "hello"                         │
│    - reply 포트 (send-once right 첨부)     │
│    → xpc_dictionary 생성                   │
│                                           │
│ 3. mach_msg() 시스템 콜                    │
│    - 목적지: 프로세스 B의 포트 (send right)  │
│    - 메시지 바디: 직렬화된 xpc_dictionary    │
│    - reply 포트: send-once right 첨부      │
└───────────────────┬───────────────────────┘
                    │ trap (유저→커널 전환)
                    ▼
┌───────────────────────────────────────────┐
│              XNU 커널 (Mach 계층)          │
│                                           │
│ 4. 메시지를 목적지 포트의 큐에 적재          │
│    - 메시지 헤더 검증                       │
│    - send right 유효성 확인                 │
│    - 포트 큐에 enqueue                     │
│                                           │
│ 5. 프로세스 B가 대기 중이면 깨움(wakeup)     │
│    - 스케줄러가 프로세스 B를 runnable로 전환  │
└───────────────────┬───────────────────────┘
                    │
                    ▼
프로세스 B (유저 스페이스)
┌───────────────────────────────────────────┐
│ 6. mach_msg()로 메시지 수신                 │
│    - 포트 큐에서 dequeue                    │
│                                           │
│ 7. 역직렬화 (deserialization)               │
│    - xpc_dictionary → 셀렉터 + 인자 복원    │
│    - reply 포트 추출                        │
│                                           │
│ 8. exportedObject의 메서드 실제 호출         │
│    doSomething(arg: "hello")               │
│                                           │
│ 9. 결과를 reply 포트로 전송                  │
│    - send-once right 사용 (일회성)          │
│    - 사용 후 자동 소멸                      │
└───────────────────────────────────────────┘
```

### mach_msg의 구조

모든 XPC 메시지는 결국 `mach_msg()` 시스템 콜로 전달됩니다.

```
┌─────────────────────────────────────┐
│         mach_msg_header_t           │
│  ┌────────────────────────────┐     │
│  │ msgh_bits:   send/receive  │     │
│  │ msgh_size:   메시지 크기    │     │
│  │ msgh_remote: 목적지 포트    │     │
│  │ msgh_local:  reply 포트     │     │
│  │ msgh_id:     메시지 ID      │     │
│  └────────────────────────────┘     │
├─────────────────────────────────────┤
│         mach_msg_body_t             │
│  ┌────────────────────────────┐     │
│  │ descriptor count           │     │
│  │ OOL descriptor (대용량)    │     │
│  │ port descriptor (포트전송) │     │
│  └────────────────────────────┘     │
├─────────────────────────────────────┤
│       inline payload                │
│  ┌────────────────────────────┐     │
│  │ 직렬화된 xpc_dictionary    │     │
│  │ (셀렉터, 인자, 메타데이터)  │     │
│  └────────────────────────────┘     │
└─────────────────────────────────────┘
```

### 대용량 데이터 전송 — OOL(Out-Of-Line)

작은 메시지는 inline으로 복사되지만, 큰 데이터는 **OOL(Out-Of-Line)** 방식을 사용합니다.

```
일반 메시지 (inline):
  프로세스 A 메모리 → 커널 버퍼로 복사 → 프로세스 B 메모리로 복사

OOL 메시지 (대용량):
  프로세스 A 메모리 ─── 커널이 가상 메모리 페이지를 ───► 프로세스 B 주소공간에
                      copy-on-write로 매핑              직접 매핑
```

OOL 전송은 물리 메모리 복사 없이 **가상 메모리 페이지 매핑**만 변경하므로, 수 MB 이상의 데이터도 효율적으로 전달됩니다.

---

## Reply 패턴 — 양방향 통신의 비밀

XPC에서 응답(reply)이 돌아오는 원리는 **send-once right**에 있습니다.

```
프로세스 A                    커널                      프로세스 B
    │                         │                          │
    │  ① 요청 메시지           │                          │
    │  + reply 포트            │                          │
    │    (send-once right)    │                          │
    │ ──────────────────────► │ ───────────────────────► │
    │                         │                          │
    │                         │                          │  ② 처리
    │                         │                          │
    │                         │  ③ 응답 메시지             │
    │                         │  (reply 포트에 전송)       │
    │  ◄───────────────────── │ ◄─────────────────────── │
    │                         │                          │
    │  ④ reply handler 호출    │   send-once right 소멸   │
```

1. 프로세스 A가 요청을 보낼 때, 자신이 만든 reply 포트의 **send-once right**를 메시지에 첨부합니다.
2. 커널이 이 포트 권한을 메시지와 함께 프로세스 B에게 전달합니다.
3. 프로세스 B가 처리를 마치면, 전달받은 send-once right로 reply 포트에 응답을 보냅니다.
4. send-once right는 사용 즉시 소멸하므로, 하나의 요청에 정확히 하나의 응답만 가능합니다.

---

## 커널 관점의 전체 그림

```
유저 스페이스                커널 스페이스                유저 스페이스
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│ 프로세스 A   │         │    XNU 커널       │         │ 프로세스 B   │
│             │         │                  │         │             │
│ NSXPCConn   │ trap    │  ┌────────────┐  │  wakeup │ NSXPCListener│
│ .resume()   │ ──────► │  │ ipc_space  │  │ ──────► │ .resume()   │
│             │         │  │ (태스크별   │  │         │             │
│ proxy.      │ trap    │  │  포트 테이블)│  │  wakeup │ exported    │
│  method()   │ ──────► │  └────────────┘  │ ──────► │  Object     │
│             │         │                  │         │  .method()  │
│ reply       │  wakeup │  ┌────────────┐  │  trap   │             │
│  handler()  │ ◄────── │  │ Mach 포트   │  │ ◄───── │ reply       │
│             │         │  │  메시지 큐   │  │         │  (result)  │
└─────────────┘         │  └────────────┘  │         └─────────────┘
                        │                  │
                        │  ┌────────────┐  │
                        │  │ 스케줄러    │  │
                        │  │ (컨텍스트   │  │
                        │  │  스위칭)    │  │
                        │  └────────────┘  │
                        └──────────────────┘
```

모든 XPC 통신은 이 경로를 따릅니다:

1. **유저→커널 전환** (trap/syscall): `mach_msg()` 호출 시 CPU가 커널 모드로 전환
2. **메시지 큐잉**: 커널이 목적지 포트의 큐에 메시지를 적재
3. **스케줄링**: 수신 프로세스가 sleep 상태면 커널 스케줄러가 깨움
4. **커널→유저 전환**: 수신 프로세스가 유저 모드로 복귀하여 메시지를 읽음

프로세스 간에 직접적인 메모리 접근은 **절대 발생하지 않습니다**. 모든 데이터는 커널을 경유하며, 커널이 포트 권한을 검증하여 **무단 접근을 차단**합니다.

---

## launchd on-demand 실행과 XPC의 관계

SMJobBless로 설치된 Privileged Helper처럼 `KeepAlive`가 `false`인 데몬은 평소에 프로세스가 존재하지 않습니다.

```
[데몬 미실행 상태]

프로세스 A                    launchd                    프로세스 B
    │                          │                         (존재하지 않음)
    │  bootstrap_look_up()     │
    │ ───────────────────────► │
    │                          │  fork() + exec()
    │                          │ ──────────────────────►  프로세스 B 시작
    │                          │                          │
    │                          │  ◄── check_in() ──────── │
    │                          │                          │
    │  ◄── send right ──────── │                          │
    │                          │                          │
    │  ═══ 연결 수립 ══════════════════════════════════   │
    │                          │                          │
    │  ... 통신 ...            │                          │
    │                          │                          │
    │  connection.invalidate() │                          │
    │                          │                          │
    │                     [idle timeout 후]                │
    │                          │  SIGTERM ───────────────► │
    │                          │                     프로세스 B 종료
```

launchd가 해당 서비스의 Mach 포트를 **대리 보유(holding port)**하고 있기 때문에, 클라이언트는 서버가 살아있든 죽어있든 동일한 방식으로 연결할 수 있습니다. launchd가 첫 메시지 도착 시점에 데몬을 시작하고, 유휴 상태가 지속되면 종료시킵니다.

---

## 보안 검증

XPC 연결이 수립될 때 프로세스 B는 연결을 수락하기 전에 클라이언트를 검증할 수 있습니다.

```swift
func listener(_ listener: NSXPCListener,
              shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
    // 연결 요청한 프로세스의 PID
    let pid = connection.processIdentifier

    // 연결 요청한 프로세스의 audit token
    let auditToken = connection.auditToken

    // 코드 서명 검증
    // SecCodeCopyGuestWithAttributes로 pid 기반 검증
    // ...

    return isValid
}
```

커널이 Mach 메시지에 **audit token**을 자동으로 첨부합니다. 이 토큰에는 송신 프로세스의 PID, UID, GID 등이 포함되며, **커널이 설정하므로 위조가 불가능**합니다.

---

## LaunchDaemon과 Network Extension — MachServiceName 등록 경로의 차이

지금까지 설명한 MachServiceName 등록은 LaunchDaemon plist에 직접 선언하는 방식이었습니다. 그런데 Network Extension(System Extension)도 MachServiceName을 사용하여 XPC 통신을 합니다. 두 방식은 **등록 경로**가 다르지만, 최종적으로 **같은 launchd `system/` 도메인**에 등록됩니다.

### LaunchDaemon — 직접 등록

```
plist 파일을 /Library/LaunchDaemons/에 배치
    → launchd가 직접 로드
    → system/ 도메인에 MachServices 등록
```

```xml
<!-- /Library/LaunchDaemons/com.example.helper.plist -->
<key>MachServices</key>
<dict>
    <key>com.example.helper</key>
    <true/>
</dict>
```

개발자가 plist 파일을 작성하고, `SMJobBless` 등으로 설치하면 launchd가 이 plist를 읽어 MachServices를 직접 등록합니다.

### Network Extension (System Extension) — sysextd 경유 등록

```
익스텐션 Info.plist에 NEMachServiceName 선언
    → OSSystemExtensionManager로 활성화 요청
    → sysextd가 바이너리를 /Library/SystemExtensions/에 복사
    → sysextd가 launchd 설정을 생성
    → launchd에 등록
    → system/ 도메인에 MachServices 등록
```

```xml
<!-- NetworkExtension.appex/Info.plist -->
<key>NetworkExtension</key>
<dict>
    <key>NEProviderClasses</key>
    <dict>
        <key>com.apple.networkextension.packet-tunnel</key>
        <string>$(PRODUCT_MODULE_NAME).PacketTunnelProvider</string>
    </dict>
    <key>NEMachServiceName</key>
    <string>$(TeamIdentifierPrefix)com.example.app.extension</string>
</dict>
```

개발자가 LaunchDaemon plist를 직접 작성하지 않습니다. `sysextd`(systemextensionsd)가 중간에서 launchd 설정 생성과 등록을 대행합니다.

### 등록 경로는 다르지만, 도착지는 같다

```
┌─────────────────────────────────────────────────────────┐
│                    launchd system/ 도메인                 │
│                                                         │
│   ┌───────────────────────────────────────────────┐     │
│   │ "com.example.helper"              → port 0x307│ ◄── LaunchDaemon plist에서 직접 등록
│   │ "TEAMID.com.example.app.extension"→ port 0x50b│ ◄── sysextd가 대신 등록
│   │ ...                                           │     │
│   └───────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

두 방식 모두 `launchctl print system/`으로 동일하게 확인할 수 있습니다. 클라이언트 입장에서 `NSXPCConnection(machServiceName:)`으로 연결하는 방식도 동일합니다. 차이는 등록이 **어떤 경로**를 거쳐 launchd에 도달하는가입니다.

### 차이 정리

| | LaunchDaemon | Network Extension (System Extension) |
|---|---|---|
| **MachServiceName 선언 위치** | LaunchDaemon plist의 `MachServices` 키 | 익스텐션 Info.plist의 `NEMachServiceName` 키 |
| **등록 주체** | launchd가 plist를 직접 로드 | sysextd가 launchd 설정을 생성하여 등록 |
| **최종 네임스페이스** | `system/` 도메인 | `system/` 도메인 (동일) |
| **launchd label** | `<BundleID>` (plist의 `Label`) | `NetworkExtension.<BundleID>.<Version>` |
| **바이너리 위치** | `/Library/PrivilegedHelperTools/` 등 | `/Library/SystemExtensions/` |
| **Team ID 접두사** | 불필요 | `$(TeamIdentifierPrefix)` 필수 |
| **라이프사이클 관리** | launchd가 직접 on-demand 관리 | sysextd + NetworkExtension 프레임워크가 활성화/비활성화 관리 |
| **확인 명령어** | `sudo launchctl print system/<BundleID>` | `sudo launchctl print system/NetworkExtension.<BundleID>.<Version>` + `systemextensionsctl list` |

Endpoint Security 익스텐션도 같은 sysextd 경로를 탑니다. 차이는 Info.plist에서 `NEMachServiceName` 대신 **`NSEndpointSecurityMachServiceName`** 키를 쓴다는 점이며, 실제 프로젝트 사례는 아래 **Endpoint Security 익스텐션** 절에서 다룹니다.

> **샌드박스와 네임스페이스의 관계**: System Extension의 샌드박스 여부는 등록되는 네임스페이스에 영향을 주지 않습니다. 샌드박스는 프로세스가 **런타임에 할 수 있는 행위**(파일 접근, 네트워크 등)를 제한하는 것이지, launchd 도메인 등록을 변경하는 것이 아닙니다.

---

## Endpoint Security 익스텐션 — PRIBITEDR 사례

Network Extension 외에 **Endpoint Security(ES) 시스템 익스텐션**도 같은 방식으로 XPC 서비스를 노출합니다. 사내 EDR 프로토타입인 `PRIBITEDR`은 ES 익스텐션이고, 컨테이너 앱이 XPC로 파일 정책(삭제·생성·읽기·수정 거부 경로)을 내려보내는 구조입니다. 등록 경로는 Network Extension과 똑같이 sysextd를 거치며, **선언하는 Info.plist 키와 launchd에 보이는 label 형식만 다릅니다.**

### 전체 구성

```
컨테이너 앱                                    ES 익스텐션 (PRIBITEDR)
 │                                              │
 │ 1. OSSystemExtensionRequest (활성화 요청)    │
 │ ────► sysextd ────► launchd system/ 등록 ──► │ 2. es_new_client()
 │                                              │    NSXPCListener(machServiceName:)
 │ 3. NSXPCConnection(.privileged)              │
 │ ════════════ setPolicy(...) ═══════════════► │ 4. 정책 갱신 + es_subscribe()
 │ ◄═══════════ reply(true) ═══════════════════ │
 │                                              │
 │                     커널 ── AUTH 이벤트 ───► │ 5. 정책 판정 → ALLOW / DENY
```

1. 앱이 `OSSystemExtensionRequest.activationRequest`로 익스텐션 활성화를 요청하면, sysextd가 바이너리를 `/Library/SystemExtensions/`에 복사하고 launchd `system/` 도메인에 등록합니다.
2. 익스텐션 프로세스는 `es_new_client()`로 ES 클라이언트를 만들고, `NSXPCListener(machServiceName:)`으로 XPC 리스너를 엽니다.
3. 앱은 `NSXPCConnection(machServiceName:options: .privileged)`로 연결합니다.
4. 앱이 `setPolicy`를 호출하면 익스텐션이 정책을 갱신하고 `es_subscribe()`로 AUTH 이벤트 구독을 시작합니다.
5. 이후 커널이 파일 이벤트마다 익스텐션에 판정을 요청하고, 익스텐션은 정책에 따라 ALLOW / DENY로 응답합니다.

### 1. 서비스 이름 선언 — 익스텐션 Info.plist

```xml
<!-- PRIBITEDR.systemextension/Contents/Info.plist -->
<key>NSEndpointSecurityMachServiceName</key>
<string><BundleID></string>
```

Network Extension의 `NEMachServiceName`에 해당하는 키입니다. PRIBITEDR에서는 익스텐션 번들 ID를 그대로 서비스 이름으로 사용했습니다. 필요한 entitlement는 다음과 같습니다.

| 대상 | Entitlement |
|------|------|
| 컨테이너 앱 | `com.apple.developer.system-extension.install` |
| ES 익스텐션 | `com.apple.developer.endpoint-security.client` |

### 2. launchd에는 어떤 label로 보이나

`sudo launchctl print system/`으로 보면 세 종류의 서비스가 **서로 다른 label 형식**으로 등록되어 있습니다.

| 종류 | `launchctl print system/`의 label | 클라이언트가 연결할 때 쓰는 이름 |
|------|------|------|
| LaunchDaemon (Privileged Helper) | `<BundleID>` (plist의 `Label`) | plist `MachServices`의 키 |
| Network Extension | `NetworkExtension.<BundleID>.<Version>` | `NEMachServiceName` |
| Endpoint Security | `<TeamID>.<BundleID>` | `NSEndpointSecurityMachServiceName` |

LaunchDaemon은 개발자가 작성한 plist의 `Label`이 그대로 보이지만, 시스템 익스텐션은 **sysextd가 launchd 설정을 생성**하기 때문에 label에 접두사(`NetworkExtension.`, `<TeamID>.`)나 버전이 붙습니다. 그래서 시스템 익스텐션은 `sudo launchctl print system/<BundleID>`로 바로 조회되지 않고, 먼저 label을 찾아야 합니다. (아래 **실습 6** 참고)

> label은 launchd가 job을 구분하는 이름이고, 클라이언트가 `NSXPCConnection(machServiceName:)`에 넘기는 것은 Info.plist에 선언한 **Mach 서비스 이름**입니다. 둘은 다를 수 있으므로, 연결 문자열은 label이 아니라 Info.plist 값과 맞춰야 합니다.

### 3. 공유 프로토콜 — 앱과 익스텐션이 같이 링크하는 Domain 패키지

```swift
@objc public protocol EndpointSecurityIPCProtocol {
    func setPolicy(enabled: Bool,
                   denyDeletePaths: [String], denyCreatePaths: [String],
                   denyReadPaths: [String], denyWritePaths: [String],
                   withReply reply: @escaping (Bool) -> Void)
    func getPolicy(withReply reply: @escaping (Bool, [String], [String], [String], [String]) -> Void)
}
```

`[String]`과 `Bool`만 주고받으므로 별도의 `setClasses` 설정 없이 기본 인코딩으로 충분합니다. `withReply` 블록은 앞의 **Reply 패턴** 절에서 본 send-once reply 포트로 변환됩니다.

### 4. 서버 — 익스텐션의 `main.swift` + `XPCServer.swift`

```swift
// main.swift (요약)
let res = es_new_client(&client) { client, message in
    // AUTH 이벤트마다 FilePolicyManager로 판정 후 응답
}
let xpcServer = XPCServer(machServiceName: bundleID,
                          esClient: client,
                          filePolicyManager: filePolicyManager)
xpcServer.start()
dispatchMain()
```

```swift
// XPCServer.swift
init(machServiceName: String, esClient: OpaquePointer, filePolicyManager: FilePolicyManager) {
    self.listener = NSXPCListener(machServiceName: machServiceName)
    ...
}

func start() {
    listener.resume()   // launchd에 check-in → 서비스 포트의 receive right 획득
}

func listener(_ listener: NSXPCListener,
              shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
    connection.exportedInterface = NSXPCInterface(with: EndpointSecurityIPCProtocol.self)
    connection.exportedObject = XPCHandler(esClient: esClient, filePolicyManager: filePolicyManager)
    connection.resume()
    return true
}
```

`XPCHandler.setPolicy`는 정책을 갱신한 뒤 `es_clear_cache()`로 ES의 판정 캐시를 비우고, `enabled` 값에 따라 `es_subscribe()` / `es_unsubscribe_all()`을 호출합니다. 즉 **익스텐션은 활성화되자마자 XPC 리스너를 열어 두지만, 실제 이벤트 구독은 앱이 XPC로 정책을 보내는 순간 시작**됩니다.

### 5. 클라이언트 — Domain 패키지의 `EndpointSecurityIPCConnection`

```swift
let conn = NSXPCConnection(machServiceName: machServiceName, options: .privileged)
conn.remoteObjectInterface = NSXPCInterface(with: EndpointSecurityIPCProtocol.self)
conn.invalidationHandler = { [weak self] in
    self?.connection = nil   // 다음 호출 때 새로 연결
}
conn.resume()
```

시스템 익스텐션의 서비스는 사용자 세션이 아닌 `system/` 도메인에 등록됩니다. `.privileged`는 이렇게 권한 있는(privileged) 부트스트랩 영역의 서비스에 연결할 때 지정하는 옵션입니다.

### 실전 주의점 — reply와 에러 핸들러는 둘 중 하나만 호출된다

`remoteObjectProxyWithErrorHandler`로 얻은 프록시에서 reply 블록이 있는 메서드를 호출하면, **reply 블록과 에러 핸들러 중 정확히 하나만** 호출됩니다. 익스텐션이 아직 활성화되지 않았거나 서비스 조회에 실패하면 reply는 오지 않고 에러 핸들러만 불립니다.

PRIBITEDR의 `EndpointSecurityManager`는 reply를 `withCheckedThrowingContinuation`으로 감싸 `async`로 노출하는데, 현재 에러 핸들러는 로그만 남깁니다.

```swift
// 현재 구조: 에러 시 completion이 호출되지 않음 → continuation이 영원히 resume되지 않음
return connection?.remoteObjectProxyWithErrorHandler { error in
    NSLog("[XPCClient] XPC 에러: %{public}@", error.localizedDescription)
} as? EndpointSecurityIPCProtocol
```

익스텐션 활성화 전에 정책을 보내면 `await xpcClient.setPolicy(...)`가 끝나지 않습니다. 호출마다 에러 핸들러에서도 completion을 보장하도록 바꾸면 해결됩니다.

```swift
private func proxy(onError: @escaping (Error) -> Void) -> EndpointSecurityIPCProtocol? {
    // connection 생성 로직은 동일
    return connection?.remoteObjectProxyWithErrorHandler(onError) as? EndpointSecurityIPCProtocol
}

func setPolicy(..., completion: @escaping (Bool) -> Void) {
    guard let proxy = proxy(onError: { _ in completion(false) }) else {
        completion(false)
        return
    }
    proxy.setPolicy(..., withReply: completion)
}
```

---

## 터미널에서 검증하기

지금까지 설명한 네임스페이스 등록, Mach 포트 할당, 서비스 이름 ↔ 포트 매핑이 실제로 존재하는지 터미널에서 직접 확인해 봅니다. LaunchDaemon, Network Extension, Endpoint Security 익스텐션 모두 같은 명령어로 검증할 수 있습니다.

> **읽는 법**: 초록색 선이 있는 **Terminal** 블록은 그대로 복사해 실행하는 명령어이고, 점선 테두리의 **출력 예시** 블록은 실행 결과 예시입니다. `<BundleID>`, `<pid>`처럼 꺾쇠로 감싼 부분은 자신의 값으로 바꿔 입력하세요.

### 실습 1. Bootstrap 네임스페이스(도메인) 둘러보기

launchd는 여러 계층의 도메인을 관리합니다.

| 도메인 | 담기는 것 |
|------|------|
| `system/` | 시스템 데몬 (LaunchDaemon, 시스템 익스텐션) |
| `gui/<uid>/` | GUI 세션의 사용자 에이전트 (LaunchAgent) |
| `user/<uid>/` | 사용자 도메인 |
| `login/<asid>/` | 로그인 세션 도메인 |
| `pid/<pid>/` | 프로세스별 도메인 |

```bash
# 시스템 도메인 (LaunchDaemon / 시스템 익스텐션 영역)
sudo launchctl print system/

# 현재 사용자의 GUI 도메인 (LaunchAgent 영역)
launchctl print gui/$(id -u)/
```

### 실습 2. 등록된 서비스(MachServiceName) 확인하기

특정 서비스 이름이 launchd에 등록되어 있고, 어떤 포트에 매핑되어 있는지 확인하는 가장 직접적인 방법입니다.

```bash
sudo launchctl print system/<BundleID>
```

```text
<BundleID> = {
    active count = 1
    path = /Library/PrivilegedHelperTools/<BundleID>
    state = running
    program = /Library/PrivilegedHelperTools/<BundleID>
    ...
    endpoints = {
        "<BundleID>" = {
            port = 0x7b30b
            active = 1
            managed = 1
            reset = 0
            hide = 0
        }
    }
    ...
}
```

**확인 포인트**: `endpoints` 블록에 plist의 `MachServices`에 선언한 이름이 있고, 포트(`0x7b30b`)가 매핑되어 있으면 등록은 정상입니다. 시스템 익스텐션은 label 형식이 다르므로 위 **launchd에는 어떤 label로 보이나** 표를 참고하세요. 전체 출력이 길다면 `endpoints` 블록만 걸러 봅니다.

```bash
# endpoints 블록만 보기
sudo launchctl print system/<BundleID> | grep -A 6 "endpoints"

# 서비스 이름이 어디에 등록되어 있는지 전체 상태에서 검색
sudo launchctl dumpstate | grep "<BundleID>"
```

### 실습 3. 로드된 Job과 on-demand 상태 확인하기

```bash
sudo launchctl list | grep <BundleID>
```

```text
PID     Status  Label
1234    0       <BundleID>
-       0       com.example.ondemand.service
```

**확인 포인트**: PID가 `-`인 항목은 로드는 되었지만 프로세스가 실행 중이지 않은 상태(on-demand 대기)입니다. 앞에서 본 것처럼 launchd가 서비스 포트를 **대리 보유**하고 있는 상태입니다.

### 실습 4. 프로세스가 가진 Mach 포트 권한 보기

`lsmp`(list mach ports)로 특정 프로세스가 보유한 포트와 권한을 확인합니다.

```bash
sudo lsmp -p <pid>
```

```text
Process (1234) : <BundleID>
  name      ipc-object    rights     flags   boost  reqs  recv  send ...
---------   ----------  ----------   -----   -----  ----  ----  ----
0x00000307  0x7b30b123  recv         ------      0     -     1     0
0x0000050b  0x2a1c4567  send         ------      0     -     0     1
0x00000707  0x3d5e7890  send-once    ------      0     -     0     1
...
```

| 컬럼 | 의미 |
|------|------|
| **name** | 태스크 로컬 포트 이름 (`ipc_space` 내의 인덱스) |
| **ipc-object** | 커널 내부의 실제 포트 객체 식별자 |
| **rights** | 이 프로세스가 해당 포트에 대해 가진 권한 (`recv`, `send`, `send-once`) |

**확인 포인트**: `recv` 권한 포트가 이 프로세스가 수신 대기하는 서비스 포트이고, `send` 권한 포트가 다른 프로세스에 메시지를 보낼 수 있는 포트입니다.

### 실습 5. plist에 선언된 서비스 이름 확인하기

```bash
plutil -p /Library/LaunchDaemons/<BundleID>.plist
```

```text
{
  "Label" => "<BundleID>"
  "MachServices" => {
    "<BundleID>" => 1
  }
  "Program" => "/Library/PrivilegedHelperTools/<BundleID>"
  ...
}
```

**확인 포인트**: `MachServices`의 키가 곧 launchd에 등록되는 서비스 이름이며, 클라이언트가 `NSXPCConnection(machServiceName:)`에 넘기는 문자열과 **대소문자까지** 일치해야 합니다.

### 실습 6. 시스템 익스텐션 상태와 label 확인하기

```bash
systemextensionsctl list
```

```text
2 extension(s)
--- com.apple.system_extension.network_extension
enabled  active  teamID    bundleID (version)        name       [state]
*        *       <TeamID>  <BundleID> (<Version>)    MyFilter   [activated enabled]
--- com.apple.system_extension.endpoint_security
enabled  active  teamID    bundleID (version)        name       [state]
*        *       <TeamID>  <BundleID> (<Version>)    PRIBITEDR  [activated enabled]
```

익스텐션이 `[activated enabled]`라면 sysextd가 launchd 등록까지 마친 상태입니다. 시스템 익스텐션은 label이 `<BundleID>`와 다르므로 **먼저 label을 찾고**, 그 label로 상세 정보를 조회합니다.

```bash
# 1) 번들 ID로 launchd label 찾기
sudo launchctl print system/ | grep <BundleID>
```

```text
NetworkExtension.<BundleID>.<Version>     ← Network Extension
<TeamID>.<BundleID>                        ← Endpoint Security
```

```bash
# 2) 찾은 label로 상세 조회 (endpoints 블록 확인)
sudo launchctl print system/NetworkExtension.<BundleID>.<Version>
sudo launchctl print system/<TeamID>.<BundleID>

# 익스텐션 바이너리 위치
ls /Library/SystemExtensions/
```

### 실전 디버깅 체크리스트

XPC 연결이 실패하면 위에서부터 차례로 확인합니다. 앞의 실습 번호를 함께 적어 두었습니다.

| # | 확인할 것 | 명령어 | 실습 |
|---|----------|--------|------|
| 1 | 서비스 이름이 선언되어 있는가? | `plutil -p <plist>` | 5 |
| 2 | (익스텐션) 활성화되어 있는가? | `systemextensionsctl list` | 6 |
| 3 | Job이 launchd에 로드되어 있는가? | `sudo launchctl list` 에서 label 검색 | 3 |
| 4 | 서비스가 등록되어 있는가? (`endpoints` 블록) | `sudo launchctl print system/<label>` (익스텐션은 label 형식 주의) | 2, 6 |
| 5 | 프로세스가 receive right를 갖고 있는가? | `sudo lsmp -p <pid>` | 4 |
| 6 | 클라이언트 문자열이 정확히 일치하는가? | 코드의 `machServiceName`과 plist 키 비교 | — |
| 7 | (Network Extension) Team ID 접두사가 맞는가? | `NEMachServiceName`과 실제 Team ID 비교 | — |

---

## 요약

| 단계 | 위치 | 동작 |
|------|------|------|
| 포트 할당 | 커널 | `mach_port_allocate()` — 메시지 큐 생성 |
| 이름 등록 | launchd | `bootstrap_check_in()` — 서비스 이름 ↔ 포트 매핑 |
| 이름 조회 | launchd | `bootstrap_look_up()` — 이름으로 send right 획득 |
| 익스텐션 등록 | sysextd → launchd | `NEMachServiceName` / `NSEndpointSecurityMachServiceName` → `NetworkExtension.<BundleID>.<Version>` / `<TeamID>.<BundleID>` label로 등록 |
| on-demand 실행 | launchd | 첫 연결 시 데몬 fork/exec |
| 메시지 전송 | 커널 | `mach_msg()` — 포트 큐에 메시지 적재 |
| 컨텍스트 전환 | 커널 | 스케줄러가 수신 프로세스를 깨움 |
| 역직렬화 | 유저 | xpc_dictionary → 메서드 호출로 변환 |
| 응답 반환 | 커널 | reply 포트(send-once right)로 결과 전송 |

XPC의 모든 통신은 커널의 Mach 포트 메시지 큐를 통과합니다. 프로세스 간 직접 메모리 접근은 없으며, 커널이 모든 포트 권한과 메시지 전달을 중재합니다. 이것이 XPC가 프로세스 격리를 유지하면서도 통신을 가능하게 하는 원리입니다.
