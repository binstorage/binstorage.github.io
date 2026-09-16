# iOS/macOS: 패킷 도착 → knote active → RunLoop/GCD 분기

## 1. 공통 경로: 패킷 도착 → knote active

API 선택과 무관하게 커널이 항상 수행하는 단계.

```
1. NIC(Wi-Fi/셀룰러)에 패킷 도착 → 하드웨어 인터럽트
2. 드라이버가 mbuf에 패킷 담음
3. DLIL(Data Link Interface Layer) → IP 계층
4. TCP/UDP 계층에서 4-tuple(src IP/port, dst IP/port)로 소켓 조회 (demux)
5. 매칭된 소켓의 receive buffer(so_rcv)에 데이터 적재
6. sorwakeup() 호출
   → 그 소켓을 감시 중인 knote가 있으면 KNOTE() 매크로로 active 표시
```

knote는 "이 소켓에 읽을 데이터가 생겼다"는 깃발이 올라간 상태일 뿐, 누가 감시하고 있었는지와는 무관하다.

## 2. 분기 판단 기준

A/B를 가르는 것은 **이 소켓을 감시하는 knote가 등록된 kqueue를 누가 소유하고, 누가 그 kqueue에서 블로킹 중인가**이다. 이는 런타임 분기가 아니라, 소켓을 어떤 API로 생성했는지에 따라 이미 결정되어 있다.

| | A (GCD/libdispatch) | B (CFSocket/NSStream) |
|---|---|---|
| 해당 API | `DispatchSource`, `Network.framework`, `URLSession` | `CFSocket`, `NSStream`, legacy `NSURLConnection` |
| kqueue 소유자 | libdispatch 내부 워커 스레드 | CFSocket이 만든 전용 헬퍼 스레드 |
| 현재 실무 위상 | 표준 (권장) | Legacy |

## 3. 경로 A — GCD/libdispatch

```
knote active
  → libdispatch 워커 스레드의 kevent() 리턴 (이 스레드는 CFRunLoop 없음)
  → 등록된 handler block을 target dispatch queue에 enqueue

  분기 (target queue 종류에 따라):

  ├─ target이 global concurrent queue
  │    → 그 큐를 서비스하는 워커 스레드가 즉시 block 실행
  │    → RunLoop 등장 안 함
  │
  └─ target이 main queue
       → main queue의 wake mach port로 message send
       → 메인 스레드의 CFRunLoop가 mach_msg_receive에서 깨어남
       → RunLoop가 dispatch_main_queue_callback 호출
       → main queue를 드레인하며 handler block 실행
```

RunLoop는 콜백이 메인 큐를 타겟으로 할 때만 등장한다. 실질적인 대기(`kevent()`)는 대부분 RunLoop 밖에서 이루어진다.

## 4. 경로 B — CFSocket/NSStream + 명시적 RunLoop 스케줄링

```
knote active
  → CFSocket이 내부에 만들어둔 헬퍼 스레드의 kevent()/select() 리턴
     (이 스레드는 순수 감시 전용, 앱 로직을 실행하지 않음)
  → CFRunLoopSource (source0, "signal 방식")를 signal
     : CFRunLoopSourceSignal(source)
  → CFRunLoopWakeUp(targetRunLoop) 호출
     → 그 source가 스케줄된 RunLoop가 돌고 있는 스레드의 wake mach port로 message send
  → 해당 스레드가 CFRunLoopRun()의 mach_msg_receive에서 대기 중이었다면 깨어남
  → RunLoop가 signal된 source0을 찾아서 perform 콜백 실행
     (CFSocket 콜백 함수 또는 NSStream delegate 메서드 호출)
```

감시하는 스레드(헬퍼)와 실행하는 스레드(RunLoop가 돌고 있는 스레드)가 분리되어 있고, 그 사이를 `CFRunLoopSource`(source0) + mach port wake-up이 연결한다. 개발자가 어떤 스레드에 스케줄했는지가 곧 실행 스레드를 결정한다.

## 5. 참고: source0 vs source1

- **Version 0 (source0)**: 수동 signal 방식. `CFRunLoopSourceSignal()` 호출 후 반드시 `CFRunLoopWakeUp()`을 호출해야 즉시 처리된다. `CFSocket`이 이 방식으로 구현되어 있다.
- **Version 1 (source1)**: mach port 기반. 커널이 해당 port에 메시지가 도착하면 자동으로 source를 signal한다. `CFMachPort`, `CFMessagePort`, XPC 통신이 이 방식이다.

## 6. 신뢰도 및 macOS 여부

- 커널 레벨(`knote`, `KNOTE`, `kqueue`/`kevent`, `sorwakeup`)과 `CFRunLoopSource` version 0/1 구분(및 CFSocket = version 0라는 사실)은 BSD/XNU 오픈소스와 Apple 공식 문서로 확인됨 — 신뢰도 높음.
- libdispatch 워커 스레드가 kqueue를 감시하고 main queue일 때만 mach port를 거쳐 RunLoop를 깨운다는 구조는 공식 문서에는 없고 libdispatch 오픈소스/리버스 엔지니어링 분석에 근거함 — 전체 구조는 맞지만 세부 함수명은 근사치로 취급할 것.
- macOS와 iOS는 동일한 XNU 커널과 동일한 CoreFoundation/libdispatch를 공유하므로 이 파이프라인 자체는 두 플랫폼에서 동일하다. 차이는 백그라운드 정책, 샌드박스/entitlement 등 주변 제약에서 발생한다.
