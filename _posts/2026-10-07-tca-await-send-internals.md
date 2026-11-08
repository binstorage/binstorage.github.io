---
layout: post
title: "TCA await send(.action) 내부 동작 원리 — Send 구조체부터 RootStore 콜스택까지"
date: 2026-10-07
categories: [Swift]
description: "TCA .run Effect 내부의 await send가 reducer 완료까지 기다리는 이유와, 비동기 Effect 완료까지는 기다리지 않는 이유를 내부 콜스택으로 분석한다."
---

TCA에서 `.run` Effect 내부의 `await send(.action)`는:

- **reducer의 동기적 처리(state 변경 + Effect 반환)가 완료될 때까지 suspend된다.**
- **반환된 Effect 중 `.run`과 같은 비동기 Effect의 실행 완료까지는 기다리지 않는다.**

---

## TCA 내부 콜스택: await send가 reducer 완료까지 기다리는 이유

### 1단계: `Send<Action>` 구조체 — Effect.swift

`.run` Effect 내부에서 사용하는 `send`는 `Send<Action>` 타입이다.

```swift
// Effect.swift
@MainActor
public struct Send<Action>: Sendable {
    let send: @MainActor @Sendable (Action) -> Void

    public func callAsFunction(_ action: Action) {
        guard !Task.isCancelled else { return }
        self.send(action)  // ← 내부 클로저를 동기적으로 호출
    }
}
```

- `callAsFunction`은 **동기 함수**이다.
- `@MainActor` 격리되어 있으므로, 다른 컨텍스트에서 호출할 때 `await`이 필요하다.
- 즉, `await send(.action)`의 `await`는 **MainActor로의 컨텍스트 전환**을 기다리는 것이지, 비동기 작업 완료를 기다리는 것이 아니다.

### 2단계: Send 클로저 생성 — RootStore.swift

`.run` Effect가 실행될 때, TCA는 `Send` 인스턴스를 생성하여 operation 클로저에 전달한다.

```swift
// RootStore.swift - .run Effect 처리 부분
case let .run(priority, operation):
    let task = Task(priority: priority) { @MainActor in
        await operation(
            Send { effectAction in
                // ↓ 이 클로저가 Send의 내부 send 프로퍼티
                self.send(effectAction, originatingFrom: action)
            }
        )
    }
```

- `Send`의 내부 클로저는 `RootStore.send(_:originatingFrom:)`를 직접 호출한다.
- 이 호출은 **동기적**으로 실행된다.

### 3단계: RootStore.send() — 동기적 reducer 실행

```swift
// RootStore.swift
func send(_ action: Any, originatingFrom: Any?) -> Task<Void, Never>? {
    self.bufferedActions.append(action)
    guard !self.isSending else { return nil }  // 재진입 방지

    self.isSending = true
    var currentState = self.state as! State

    defer {
        self.state = currentState    // state 반영
        self.isSending = false
    }

    // 버퍼에 쌓인 액션을 순차적으로 처리
    while index < self.bufferedActions.endIndex {
        let action = self.bufferedActions[index] as! Action

        // ✅ reducer 호출 — 동기적으로 실행됨
        let effect = reducer.reduce(into: &currentState, action: action)

        // effect 처리 (Task 생성만, 실행 완료를 기다리지 않음)
        switch effect.operation {
        case .none: break
        case let .run(priority, operation):
            // Task를 생성하여 tasks 배열에 추가만 함
            tasks.withValue { $0.append(task) }
        case let .publisher(publisher):
            // publisher subscribe만 함
        }
    }

    // ✅ 모든 effect Task를 래핑한 Task를 반환 (즉시 반환, await 아님)
    return Task { @MainActor in
        await withTaskCancellationHandler {
            for task in tasks { await task.value }
        }
    }
}
```

### 콜스택 요약: `.none`을 반환하는 액션의 경우

```
await send(.someAction)
  │
  ├─ [await] MainActor 컨텍스트 전환 대기
  │
  ├─ Send.callAsFunction(_:)                    ← 동기
  │   │
  │   └─ self.send(action)                      ← 동기 (내부 클로저)
  │       │
  │       └─ RootStore.send(_:originatingFrom:)  ← 동기
  │           │
  │           ├─ bufferedActions.append(action)
  │           ├─ reducer.reduce(into:action:)     ← 동기: state 변경
  │           ├─ effect.operation == .none         ← 추가 작업 없음
  │           └─ return nil
  │
  └─ [완료] → 다음 줄로 진행
```

---

## TCA 내부 콜스택: .run Effect 완료까지 기다리지 않는 이유

### 핵심: `Send.callAsFunction`의 반환 타입은 `Void`

```swift
// Send의 callAsFunction 시그니처
public func callAsFunction(_ action: Action)  // → Void 반환
```

`RootStore.send()`는 `Task<Void, Never>?`를 반환하지만, `Send`의 내부 클로저는 이 반환값을 **무시(discard)**한다.

```swift
Send { effectAction in
    // send()의 반환값 Task<Void, Never>?를 사용하지 않음
    // ↓ @discardableResult와 동일한 효과
    self.send(effectAction, originatingFrom: action)
}
```

### 콜스택 요약: `.run` Effect를 반환하는 액션의 경우

```
await send(.someAction)
  │
  ├─ [await] MainActor 컨텍스트 전환 대기
  │
  ├─ Send.callAsFunction(_:)                        ← 동기
  │   │
  │   └─ self.send(action)                          ← 동기
  │       │
  │       └─ RootStore.send(_:originatingFrom:)      ← 동기
  │           │
  │           ├─ reducer.reduce(into:action:)         ← 동기
  │           │   └─ return .run { ... } 또는 .merge(...)
  │           │
  │           ├─ effect.operation == .run             ← Effect 처리
  │           │   ├─ Task { operation(Send{...}) }    ← Task 생성 (실행은 나중에)
  │           │   └─ tasks.append(task)               ← 배열에 추가만 함
  │           │
  │           └─ return Task { await tasks... }       ← 래핑 Task 반환
  │                                                      BUT: Send가 이 반환값을 무시
  │
  └─ [완료] → callAsFunction 종료, await 해제
               │
               └─ 이 시점에서 .run 내부의 Task들은
                  MainActor 큐에 예약된 상태이며,
                  아직 실행되지 않았거나 실행 중
```

### 비동기 Effect가 실행되는 시점

```
[메인 실행 흐름]                    [별도 Task들]
     │
await send(.someAction)
     │
     ├─ reducer 실행 (동기)
     ├─ Task 생성 (예약만)
     │
     └─ 완료, 다음 코드로 →
                                        ├─ Task 1: .run Effect 1 실행
                                        └─ Task 2: .run Effect 2 실행
```

---

## 핵심 정리

| 구분 | 동작 | 이유 |
|------|------|------|
| `await` 키워드의 역할 | MainActor 컨텍스트 전환 대기 | `Send`가 `@MainActor` 격리 |
| reducer 실행 | 동기적, 즉시 완료 | `reducer.reduce(into:action:)`는 동기 함수 |
| state 변경 | reducer 실행 시 즉시 반영 | `inout State`에 직접 변경 |
| `.none` 반환 시 | 추가 작업 없이 즉시 완료 | effect.operation == .none |
| `.run` 반환 시 | Task 생성 후 즉시 반환 | `Send`가 반환된 `Task<Void, Never>?`를 await하지 않음 |
| Effect Task 실행 | MainActor 큐에서 별도로 실행 | 생성된 Task는 독립적으로 스케줄링 |

### 외부에서 Effect 완료를 기다리려면

View나 테스트에서 `Store.send()`를 호출하면 `StoreTask`가 반환되며, `.finish()`를 호출하여 Effect 완료를 명시적으로 기다릴 수 있다.

```swift
// Store.swift
public struct StoreTask {
    let rawValue: Task<Void, Never>?

    public func finish() async {
        await self.rawValue?.cancellableValue  // ← 모든 Effect Task 완료 대기
    }
}

// 사용 예시 (테스트)
await store.send(.startTimer).finish()  // Effect까지 완료 대기
```

`.run` 내부의 `Send`에서는 이 `StoreTask`에 접근할 수 없으므로, Effect 완료를 기다릴 방법이 없다. 이는 **의도된 설계**로, 순환 대기(deadlock)를 방지한다.
