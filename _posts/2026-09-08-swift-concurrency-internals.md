---
layout: post
title: "Swift Concurrency 내부 동작 — Task의 actor context 상속부터 await의 LLVM IR까지"
date: 2026-09-08
categories: [Swift]
description: "Task가 actor context를 상속하는 메커니즘, Actor 격리와 nonisolated/Sendable의 관계, 그리고 await가 LLVM IR 수준에서 어떻게 Partial Function으로 분리되는지 정리합니다."
---

## 연구하게 된 계기

`applicationWillTerminate`에서 비동기 종료 처리를 구현하던 중 문제가 발생했습니다.

`terminate`는 MainActor 격리 메서드입니다. 이 메서드 안에서 Task를 생성하고 비동기 메서드(앱 종료 프로토콜, 서버 통신)를 호출했습니다. 비동기 메서드의 실행을 보장하기 위해 Task 블록 바깥, `terminate` 메서드 안에서 `Thread.sleep`을 호출했습니다. Task가 다른 스레드에서 동작할 것이라 판단했기 때문에, 메인 스레드를 sleep시켜 프로세스 종료를 지연시키려 한 것입니다.

```swift
func terminate() {
    Task {
        // 다른 스레드에서 동작하는 줄 알았음
        await exitProtocol()
    }
    Thread.sleep() // 메인 스레드를 블로킹
}
```

**문제**: Task는 생성된 시점의 actor context를 상속받습니다. `terminate`는 MainActor 메서드이므로, Task 내부도 MainActor에 격리됩니다. 메인 스레드가 sleep으로 블로킹된 상태에서 MainActor에 격리된 Task는 실행 기회를 얻지 못합니다.

이 문제를 파고들면서 중간 언어(SIL, LLVM IR)까지 분석하게 되었고, 그 과정에서 정리한 내용을 공유합니다.

---

## 1. Task는 생성된 시점의 actor context를 상속한다

### actor context 상속이란

Task가 생성된 시점의 actor isolation을 이어받는 것입니다. 해당 actor의 격리 규칙을 그대로 따르게 됩니다.

```swift
@MainActor
func someMainActorFunc() {
    Task { // MainActor context 상속 → MainActor에 격리됨
        let _ = await present() // 이미 MainActor이므로 actor hop 없음
        let hello = await hello() // nonisolated이므로 actor hop 발생
    }
}

// non-actor context
Task { // actor context 없음
    let _ = await present() // MainActor로 actor hop 발생
    let hello = await hello() // actor hop 없음
}
```

### 실행되지 않은 케이스

```swift
// applicationWillTerminate → MainActor context
appDelegate.terminateEvent = {
    Task { // MainActor context 상속 → MainActor에 격리됨
        try await appLifeCycleManager?.terminateApp()
    }
}
Thread.sleep(3.0) // 메인스레드 블로킹 → Task 실행 기회 없음
```

MainActor에 격리된 Task는 메인 스레드에서만 실행될 수 있는데, `Thread.sleep(3.0)`이 메인 스레드를 블로킹하고 있어서 실행 기회를 얻지 못하고 프로세스가 종료됩니다.

### 정상 실행된 케이스

```swift
appDelegate.terminateEvent = {
    try appLifeCycleManager?.terminateApp() // 동기 호출
}
Thread.sleep(3.0)

// AppLifeCycleManager → non-MainActor context
func terminateApp() throws {
    Task { // actor context 없음 → MainActor에 격리되지 않음
        await DCFBS() // cooperative thread pool에서 실행 가능
    }
}
```

`terminateApp()` 내부의 Task는 non-MainActor context에서 생성되므로 MainActor에 격리되지 않습니다. `Thread.sleep(3.0)` 동안 cooperative thread pool에서 실행할 수 있습니다.

### 스레드 vs actor context

- **스레드**: 물리적인 실행 단위
- **actor context**: 논리적인 격리 단위

둘은 서로 다른 관점이며, MainActor만 예외적으로 actor context와 메인 스레드가 1:1로 대응됩니다.

### 공식 근거

SE-0304에서 다음과 같이 명시하고 있습니다.

> "A closure passed to the Task initializer will implicitly inherit the actor execution context and isolation of the context in which the closure is formed."

구현 메커니즘으로는 `Task`의 클로저 파라미터에 `@_inheritActorContext` 어트리뷰트가 붙어 있어서, 컴파일 타임에 actor context 상속이 결정됩니다.

---

## 2. Actor 격리, nonisolated, Sendable

### Actor 격리 기본 원리

```swift
actor MyActor {
    var data = 0        // 격리됨 (await 필요)
    func method() {}    // 격리됨 (await 필요)
}

let actor = MyActor()
await actor.method()    // 격리 때문에 await 필요
```

### nonisolated의 역할

```swift
actor MyActor {
    var isolatedData = 0                    // 격리됨 (await 필요)
    nonisolated let publicData = "공개"      // 격리 해제 (await 불필요)

    nonisolated func publicMethod() {}      // 격리 해제 (await 불필요)
}

let actor = MyActor()
let data = actor.publicData      // await 없이 접근 가능
actor.publicMethod()             // await 없이 호출 가능
```

### Sendable과의 관계

```swift
// ❌ non-Sendable 타입은 nonisolated 불가
class NonSendable { var value = 0 }

actor MyActor {
    // nonisolated let danger: NonSendable = NonSendable()  // 컴파일 에러
}

// ✅ Sendable 타입만 nonisolated 가능
actor MyActor {
    nonisolated let safe: String = "안전"     // String은 Sendable
    nonisolated let publisher: AnyPublisher<String, Never>  // Sendable
}
```

`nonisolated`는 "여러 스레드에서 동시 접근 가능"하다는 의미이므로, 반드시 **Sendable** 타입이어야 안전합니다.

### Protocol에서 Actor 상속

Actor를 상속하지 않는 프로토콜로 캐스팅하면 격리가 손실됩니다.

```swift
// ❌ Actor 상속 없음 → 격리 손실
protocol RegularProtocol {
    func dangerousMethod()
}

actor MyActor: RegularProtocol {
    func dangerousMethod() {}
}

let actor: any RegularProtocol = MyActor()
actor.dangerousMethod()  // await 없이 호출됨 (위험)
```

```swift
// ✅ Actor 상속 있음 → 격리 유지
protocol ActorProtocol: Actor {
    func safeMethod()
}

actor MyActor: ActorProtocol {
    func safeMethod() {}
}

let actor: any ActorProtocol = MyActor()
await actor.safeMethod()  // await 필수 (안전)
```

### 요약

| 구분 | 접근 방식 | 안전성 |
| --- | --- | --- |
| **actor-isolated** | `await` 필요 | 격리 보장 |
| **nonisolated** | `await` 불필요 | Sendable이면 안전 |
| **Protocol: Actor** | `await` 필요 | 격리 유지 |
| **Protocol: 일반** | `await` 불필요 | 격리 손실 (위험) |

### 실무 패턴

```swift
actor PopupManager: PopupManagerProtocol {
    // 자주 접근하는 것 → nonisolated (Sendable 필수)
    nonisolated let publisher: AnyPublisher<Model, Never>

    // 상태 변경하는 것 → isolated (await 필요)
    private var currentID: Int = 0
    func addPopup() async { currentID += 1 }
}

protocol PopupManagerProtocol: Actor {  // Actor 상속 필수
    func addPopup() async
    nonisolated var publisher: AnyPublisher<Model, Never> { get }
}
```

---

## 3. await의 내부 동작 — LLVM IR 분석

> LLVM IR (`-emit-ir`) 직접 분석 기반

### 원본 코드

```swift
func returnNumber() async -> Int { return 42 }

func taskClosure() async {
    let number = await returnNumber()
    print(number)
}
```

### 일반 함수 vs async 함수 콜스택 비교

**일반 함수**의 경우 로컬 변수가 전부 스택에 존재합니다.

```
스택:
┌──────────────┐
│ taskClosure  │  ← number 등 로컬변수 전부 스택에 존재
├──────────────┤
│  caller      │
└──────────────┘
```

**async 함수**의 경우 await를 만나면 스택을 해제하고 힙의 Frame에 상태를 보존합니다. 재개 시 스택은 새로 생성됩니다.

```
await 전:                        await 후 (suspend):
스택:                            스택:
┌──────────────┐                 (비어있음 - 스레드 반환됨)
│ taskClosure  │
└──────────────┘
힙:                              힙:
┌──────────────────────┐         ┌──────────────────────────┐
│ taskClosure Frame    │    →    │ taskClosure Frame        │
│  [0] parent→caller   │         │  [0] parent→caller       │
│  [1] resume_fn       │         │  [1] resume_fn = TY1_    │
│  [2] number debug    │         │  [2] number debug        │
│  [3] callee context  │         │  [3] callee (해제됨)     │
│  [4] result (미완성) │         │  [4] result = 42         │
└──────────────────────┘         └──────────────────────────┘
```

### swift.context 구조

모든 async 함수는 `%swift.context*`를 첫 번째 인자로 받습니다.

```llvm
%swift.context = type {
    %swift.context*,        // parent context 포인터
    void (%swift.context*)* // resume fn 포인터
}
```

Frame의 앞부분이 `swift.context`와 동일한 구조이므로, Frame 포인터를 그대로 `%swift.context*`로 캐스팅해서 사용합니다.

| 항목 | 역할 |
| --- | --- |
| **parent** | 나를 호출한 함수의 Frame. 완료 시 여기로 돌아감 |
| **resume_fn** | 다음에 실행할 함수 포인터. 호출마다 덮어씌워짐 |
| **callee context** | 내가 호출하는 함수를 위해 임시로 힙에 할당. 피호출 함수 입장에선 parent. 완료 후 해제 |

```
caller Frame
    ↓ parent
taskClosure Frame
    [0] parent → caller Frame
    [1] resume_fn → (교체됨)
    [3] callee → returnNumber context ─┐
                                       ↓
                          returnNumber context (임시)
                              parent    → taskClosure Frame
                              resume_fn → TQ0_
```

### 컴파일러가 생성하는 Partial Function

컴파일러는 `await` 기준으로 함수를 3개로 분리합니다.

**Part 0: taskClosure**

```
taskClosure Frame 힙 할당
callee context 힙 할당
    { parent → taskClosure Frame, resume_fn → TQ0_ }
musttail → returnNumber(callee_context)
스택 해제, 스레드 반환
```

**Part 1: TQ0_** (returnNumber 완료 후 — await 완료 처리. 컴파일러가 생성한 코드)

```
인자: %0 = callee_context
      %1 = 42               ← 결과값을 매개변수로 받음

callee_context.parent       → taskClosure Frame으로 context 전환
taskClosure Frame[4] = 42   ← Frame에 저장
swift_task_dealloc(callee_context)
swift_task_switch(taskClosure Frame, TY1_)
    → taskClosure Frame.resume_fn = TY1_ 덮어씀
스레드 반환
```

**Part 2: TY1_** (executor 복귀 후 — print 라인부터)

```
인자: %0 = taskClosure Frame

taskClosure Frame[4] → number = 42
print(number)
taskClosure Frame[0] → caller Frame
caller Frame.resume_fn(caller Frame)   ← caller로 복귀
taskClosure Frame 해제
```

### 호출 순서

```
1. taskClosure 실행
   Frame 할당, callee_context 할당 { parent→Frame, resume_fn→TQ0_ }
   returnNumber(callee_context) musttail 호출 → 스레드 반환

2. returnNumber 실행
   자기 context = callee_context
   완료 → callee_context.resume_fn(callee_context, 42) = TQ0_ 호출

3. TQ0_ 실행
   callee_context.parent → taskClosure Frame으로 context 전환
   Frame[4] = 42 저장
   callee_context 해제
   swift_task_switch(Frame, TY1_) → Frame.resume_fn = TY1_ 설정
   스레드 반환

4. executor가 Frame 꺼내서
   Frame.resume_fn(Frame) = TY1_(Frame) 호출

5. TY1_ 실행
   Frame[4] → number = 42
   print(42)
   Frame[0] → caller Frame
   caller Frame.resume_fn(caller Frame) → 완료
   Frame 해제
```

### Continuation

```
Continuation = callee context + resume_fn (= 다음 Partial 포인터)
```

- `await` 도달 → callee context에 TQ0_ 등록 = **Continuation 생성**
- `returnNumber` 완료 → TQ0_ 호출 = **Continuation resume**
- TQ0_ 완료 → Frame.resume_fn = TY1_ 설정 = **다음 Continuation 생성**

### Executor와 Actor

모든 `swift.context`는 executor 정보를 가집니다.

```
일반 async context:
    executor → Global Cooperative Thread Pool
    → await 이후 임의 스레드에서 재개 가능

Actor context:
    executor → Actor의 Serial Executor
    → await 이후 반드시 Actor의 serial queue로 복귀
    → 동시 접근 불가 = Actor 격리 보장
```

`hop_to_executor`의 동작:

```
현재 executor == 목적지 executor?
    같으면 → 그냥 실행
    다르면 → 목적지 executor queue에 job 등록 + 스레드 반환
```

**Task와 executor 상속**

| 생성 위치 | executor | await 이후 |
| --- | --- | --- |
| `Task { }` (Actor 안) | Actor executor 상속 | Actor serial queue로 복귀 |
| `Task { }` (일반 async 안) | cooperative thread pool 상속 | 임의 스레드 |
| `Task.detached { }` | 상속 없음 | 임의 스레드 |

`Task { }`가 parent context를 상속하는 이유가 바로 executor 정보를 물려받아 Actor 격리를 유지하기 위해서입니다.

---

## 결론

| 항목 | 일반 콜스택 | async / await |
| --- | --- | --- |
| 함수 호출 | 스택에 frame push | 힙에 Frame 할당 + Continuation 등록 |
| 대기 중 | 스레드 블로킹 | 스택 해제 + 스레드 반환 |
| 로컬 변수 | 스택에 존재 | 힙 Frame에 보존 |
| 돌아갈 곳 | 스택의 return address | 힙의 parent 포인터 체인 |
| 다음 실행 | return address | Frame.resume_fn (호출마다 교체) |
| 재개 위치 | 동일 스레드 | executor가 결정 |

| 항목 | 실제 동작 (LLVM IR 확인) |
| --- | --- |
| 함수 분리 | `await` 기준으로 Partial Function으로 컴파일 타임에 분리 |
| Continuation | callee context + resume_fn → 다음 Partial 등록 |
| await 결과 전달 | 매개변수(`i64 %1`)로 받아 Frame에 저장 |
| 로컬 변수 전달 | 힙 Frame 공유 → store 후 load |
| 스택 | await 시점에 해제, 재개 시 새로 생성 |
| resume_fn | swift_task_switch로 덮어씌워짐 |
| Actor 격리 | executor의 serial queue가 보장 |
| Frame 생명주기 | `swift_task_alloc` 할당 / `swift_task_dealloc` 해제 |

확인에 사용한 명령어:

```bash
swiftc -emit-sil confirmAwait.swift  # 고수준 (hop_to_executor 확인)
swiftc -emit-ir  confirmAwait.swift  # 저수준 (Partial 분리 직접 확인)
swiftc -parse-as-library -emit-ir test_executorApp.swift 2>&1 | cat
```
