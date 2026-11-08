---
layout: post
title: "XPC 연결의 내부 동작 — Mach 포트부터 메시지 전송까지"
date: 2026-09-08
categories: [macOS]
description: "프로세스 A가 connect하고 프로세스 B가 listen할 때, 커널 수준에서 Mach 포트가 어떻게 생성되고 메시지가 어떻게 전달되는지 XPC의 전체 흐름을 정리합니다."
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
│   │ "com.pribit.app.helper"  → Mach port 0x50b │     │
│   │ ...                                        │     │
│   └────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

서비스(프로세스 B)는 자신의 Mach 포트를 **문자열 이름과 함께** launchd에 등록합니다. 클라이언트(프로세스 A)는 그 문자열 이름으로 launchd에게 send right를 요청합니다.

이 과정은 `LaunchDaemon plist`의 `MachServices` 키로 선언됩니다.

```xml
<key>MachServices</key>
<dict>
    <key>com.pribit.application.packetgo.switch.sase.HelperTool</key>
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
호출 시점부터 단계별로 보면:
```
1. Proxy 객체 획득

swift
connection.remoteObjectProxyWithErrorHandler { error in ... }

이게 리턴하는 건 실제 원격 객체가 아니라 _NSXPCDistantObject라는 프록시예요. 이 객체는 NSXPCInterface에 지정된 프로토콜을 준수하는 것처럼 보이지만, 그 프로토콜의 메서드 구현을 실제로 갖고 있지 않습니다.

2. 메시지 전송으로 안 가고 forwardInvocation:으로 감

프록시에서 프로토콜 메서드를 호출하면, _NSXPCDistantObject는 해당 셀렉터에 대한 -methodSignatureForSelector:는 응답하지만 실제 IMP가 없어요. 그래서 Objective-C 런타임의 메시지 디스패치가 실패하고 **forwardInvocation:**으로 떨어집니다. 여기서 호출 정보(셀렉터, 인자들)가 NSInvocation 객체로 캡처돼요.

3. NSXPCInterface가 인자 타입을 사전에 분석

NSXPCInterface는 연결 셋업 시점에 프로토콜을 리플렉션해서 각 메서드의 인자 타입을 파악해 둡니다 (-setClasses:forSelector:argumentIndex:ofReply: 등). 이게 왜 중요하냐면:

어떤 인자가 리플라이 블록인지
어떤 인자가 NSSecureCoding을 준수해야 하는 객체인지
어떤 인자가 또 다른 XPC 프록시(중첩 프록시)인지

를 여기서 미리 알아야 직렬화 방식을 결정할 수 있거든요.

4. Invocation → XPC 메시지로 인코딩

NSInvocation이 xpc_object_t (사실상 dictionary)로 변환돼요. 셀렉터 이름, 각 인자의 인코딩된 값이 담기고, 인자가 NSSecureCoding 객체면 그 안에서 다시 NSKeyedArchiver 유사 방식으로 직렬화됩니다.

5. mach_msg()로 실제 전송

이 xpc dictionary가 저번에 얘기한 Mach port를 통해 전달됩니다. 리플라이 블록이 있으면, 그 블록 자체가 별도의 mach port(reply port)로 매핑돼서 함께 전송돼요 - 나중에 응답이 이 포트로 돌아올 수 있게.

6. 수신측: 역직렬화 → 실제 객체에 invoke

리스너 쪽에서 메시지를 받으면 NSInvocation으로 재구성하고, exportedObject(실제 구현체)에 대고 -invokeWithTarget:을 호출합니다. 이 시점에 비로소 실제 메서드 바디가 실행돼요.

7. 리턴/리플라이 경로

리플라이 블록을 실행측에서 호출하면, 그 호출 자체도 대칭적으로 캡처→직렬화→reply port로 전송되고, 원래 호출한 쪽에서 그 블록이 실행됩니다.

핵심 포인트: 클라이언트 입장에서 동기 메서드처럼 보이지만 실제로는 forwardInvocation: 트랩 → NSInvocation 캡처 → xpc 메시지 인코딩 → mach_msg 전송 → 원격 invoke → (필요시) 대칭적 리플라이 전송의 파이프라인이 매 호출마다 도는 거예요. 그래서 XPC 메서드 호출이 일반 Objective-C 메시지 전송보다 오버헤드가 훨씬 크고, 인자로 넘기는 객체가 NSSecureCoding을 안 지키면 런타임에 크래시 나는 이유도 여기 있습니다 (5번 단계에서 인코딩 실패).
```

연결이 수립된 후 실제 메시지가 어떻게 전달되는지 설명합니다.

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
| **바이너리 위치** | `/Library/PrivilegedHelperTools/` 등 | `/Library/SystemExtensions/` |
| **Team ID 접두사** | 불필요 | `$(TeamIdentifierPrefix)` 필수 |
| **라이프사이클 관리** | launchd가 직접 on-demand 관리 | sysextd + NetworkExtension 프레임워크가 활성화/비활성화 관리 |
| **확인 명령어** | `sudo launchctl print system/<label>` | 동일 + `systemextensionsctl list` |

> **샌드박스와 네임스페이스의 관계**: System Extension의 샌드박스 여부는 등록되는 네임스페이스에 영향을 주지 않습니다. 샌드박스는 프로세스가 **런타임에 할 수 있는 행위**(파일 접근, 네트워크 등)를 제한하는 것이지, launchd 도메인 등록을 변경하는 것이 아닙니다.

---

## 터미널에서 검증하기

지금까지 설명한 네임스페이스 등록, Mach 포트 할당, 서비스 매핑 등이 실제로 어떻게 존재하는지 터미널 명령어로 직접 확인할 수 있습니다. LaunchDaemon과 System Extension(Network Extension) 모두 동일한 명령어로 검증 가능합니다.

### Bootstrap 네임스페이스 구조

launchd는 여러 계층의 도메인(네임스페이스)을 관리합니다. `launchctl print` 명령으로 각 도메인의 상태를 조회할 수 있습니다.

```
도메인 계층 구조:

system/                ← 시스템 데몬 (LaunchDaemon)
gui/<uid>/             ← GUI 세션의 사용자 에이전트 (LaunchAgent)
user/<uid>/            ← 사용자 도메인
login/<asid>/          ← 로그인 세션 도메인
pid/<pid>/             ← 프로세스별 도메인
```

```bash
# 시스템 도메인 전체 조회 (LaunchDaemon 영역)
sudo launchctl print system/

# 현재 사용자의 GUI 도메인 조회 (LaunchAgent 영역)
launchctl print gui/$(id -u)/

# 사용자 도메인 조회
launchctl print user/$(id -u)/
```

### 등록된 서비스(MachServiceName) 확인

특정 MachServiceName이 launchd에 등록되어 있는지 확인하는 가장 직접적인 방법입니다.

```bash
# 시스템 도메인에서 특정 서비스 상세 정보 조회
sudo launchctl print system/com.pribit.application.packetgo.switch.sase.HelperTool
```

출력 예시:

```
com.pribit.application.packetgo.switch.sase.HelperTool = {
    active count = 1
    path = /Library/PrivilegedHelperTools/com.pribit.application.packetgo.switch.sase.HelperTool
    state = running

    program = /Library/PrivilegedHelperTools/com.pribit.application.packetgo.switch.sase.HelperTool
    ...
    endpoints = {
        "com.pribit.application.packetgo.switch.sase.HelperTool" = {
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

여기서 `endpoints` 블록이 핵심입니다. plist의 `MachServices`에 선언한 이름이 실제로 Mach 포트와 매핑되어 있고, 해당 포트 번호(`0x7b30b`)까지 확인할 수 있습니다.

```bash
# 시스템 도메인 전체에서 endpoints(Mach 서비스)만 필터링
sudo launchctl print system/ | grep -A 5 "endpoints"

# 특정 서비스 이름이 어디에 등록되어 있는지 검색
sudo launchctl dumpstate | grep "com.pribit.application.packetgo"
```

### 로드된 Job 목록 확인

`launchctl list`는 현재 도메인에 로드된 모든 Job을 보여줍니다.

```bash
# 현재 사용자 도메인의 로드된 Job 목록
launchctl list

# 특정 서비스 필터링
launchctl list | grep com.pribit

# 출력 형식: PID, 종료 코드, 라벨
#   PID     Status  Label
#   1234    0       com.pribit.application.packetgo.switch.sase.HelperTool
#   -       0       com.apple.some.unloaded.service
```

PID가 `-`인 항목은 로드는 되어 있지만 현재 프로세스가 실행되지 않은 상태(on-demand 대기)입니다. 앞서 설명한 launchd가 포트를 **대리 보유**하고 있는 상태에 해당합니다.

### 프로세스의 Mach 포트 직접 확인

`lsmp`(list mach ports) 명령으로 특정 프로세스가 보유한 Mach 포트와 권한을 직접 확인할 수 있습니다.

```bash
# 특정 PID의 Mach 포트 목록
sudo lsmp -p <pid>
```

출력 예시:

```
Process (1234) : com.pribit.application.packetgo.switch.sase.HelperTool
  name      ipc-object    rights     flags   boost  reqs  recv  send ...
---------   ----------  ----------   -----   -----  ----  ----  ----
0x00000307  0x7b30b123  recv         ------      0     -     1     0
0x0000050b  0x2a1c4567  send         ------      0     -     0     1
0x00000707  0x3d5e7890  send-once    ------      0     -     0     1
...
```

| 컬럼 | 의미 |
|------|------|
| **name** | 태스크 로컬 포트 이름 (ipc_space 내의 인덱스) |
| **ipc-object** | 커널 내부의 실제 포트 객체 식별자 |
| **rights** | 이 프로세스가 해당 포트에 대해 가진 권한 (`recv`, `send`, `send-once`) |

`recv` 권한을 가진 포트가 이 프로세스가 수신 대기하는 서비스 포트이고, `send` 권한을 가진 포트가 다른 프로세스에 메시지를 보낼 수 있는 포트입니다. 앞서 설명한 포트 권한 모델이 실제로 이렇게 존재함을 직접 확인할 수 있습니다.

### plist에 선언된 MachServices 확인

서비스가 어떤 MachServiceName으로 등록될 예정인지는 LaunchDaemon/LaunchAgent plist 파일에서 직접 확인할 수 있습니다.

```bash
# LaunchDaemon plist 위치
ls /Library/LaunchDaemons/

# 특정 plist에서 MachServices 키 확인
plutil -p /Library/LaunchDaemons/com.pribit.application.packetgo.switch.sase.HelperTool.plist
```

출력 예시:

```
{
  "Label" => "com.pribit.application.packetgo.switch.sase.HelperTool"
  "MachServices" => {
    "com.pribit.application.packetgo.switch.sase.HelperTool" => 1
  }
  "Program" => "/Library/PrivilegedHelperTools/com.pribit.application.packetgo.switch.sase.HelperTool"
  ...
}
```

`MachServices` 딕셔너리에 선언된 키가 곧 launchd에 등록되는 서비스 이름이며, 클라이언트가 `NSXPCConnection(machServiceName:)`에 전달하는 문자열과 정확히 일치해야 합니다.

### System Extension(Network Extension) 상태 확인

System Extension은 `systemextensionsctl`로 설치 및 활성화 상태를 확인할 수 있습니다.

```bash
# 설치된 System Extension 목록
systemextensionsctl list
```

출력 예시:

```
1 extension(s)
--- com.apple.system_extension.network_extension
enabled  active  teamID     bundleID (version)                              name       [state]
*        *       TEAMID1234 com.example.app.extension (1.0.0/1)             MyExtension [activated enabled]
```

System Extension의 MachServiceName도 `launchctl print system/`으로 동일하게 확인됩니다.

```bash
# System Extension의 MachService 확인 — LaunchDaemon과 동일한 명령어
sudo launchctl print system/com.example.app.extension

# System Extension 바이너리 위치 확인
ls /Library/SystemExtensions/
```

### 실전 디버깅 흐름

XPC 연결이 실패할 때 다음 순서로 확인하면 원인을 빠르게 좁힐 수 있습니다.

**LaunchDaemon 기반 서비스:**

```
1. plist에 MachServices가 선언되어 있는가?
   → plutil -p /Library/LaunchDaemons/<label>.plist

2. Job이 launchd에 로드되어 있는가?
   → sudo launchctl list | grep <label>

3. 서비스 이름이 endpoint로 등록되어 있는가?
   → sudo launchctl print system/<label> | grep endpoints -A 5

4. 프로세스가 실행 중이고 receive right를 보유하고 있는가?
   → sudo lsmp -p <pid>

5. 클라이언트 코드의 machServiceName 문자열이 정확히 일치하는가?
   → plist의 MachServices 키와 대소문자까지 비교
```

**Network Extension (System Extension) 기반 서비스:**

```
1. System Extension이 활성화되어 있는가?
   → systemextensionsctl list

2. sysextd가 launchd에 등록을 완료했는가?
   → sudo launchctl print system/<bundleID>

3. endpoint가 정상적으로 등록되어 있는가?
   → sudo launchctl print system/<bundleID> | grep endpoints -A 5

4. NEMachServiceName에 Team ID 접두사가 올바른가?
   → Info.plist의 NEMachServiceName과 실제 Team ID 비교

5. 프로세스가 실행 중이고 receive right를 보유하고 있는가?
   → sudo lsmp -p <pid>
```

---

## 요약

| 단계 | 위치 | 동작 |
|------|------|------|
| 포트 할당 | 커널 | `mach_port_allocate()` — 메시지 큐 생성 |
| 이름 등록 | launchd | `bootstrap_check_in()` — 서비스 이름 ↔ 포트 매핑 |
| 이름 조회 | launchd | `bootstrap_look_up()` — 이름으로 send right 획득 |
| on-demand 실행 | launchd | 첫 연결 시 데몬 fork/exec |
| 메시지 전송 | 커널 | `mach_msg()` — 포트 큐에 메시지 적재 |
| 컨텍스트 전환 | 커널 | 스케줄러가 수신 프로세스를 깨움 |
| 역직렬화 | 유저 | xpc_dictionary → 메서드 호출로 변환 |
| 응답 반환 | 커널 | reply 포트(send-once right)로 결과 전송 |

XPC의 모든 통신은 커널의 Mach 포트 메시지 큐를 통과합니다. 프로세스 간 직접 메모리 접근은 없으며, 커널이 모든 포트 권한과 메시지 전달을 중재합니다. 이것이 XPC가 프로세스 격리를 유지하면서도 통신을 가능하게 하는 원리입니다.
