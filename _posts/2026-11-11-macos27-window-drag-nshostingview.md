---
layout: post
title: "macOS 27에서 창이 끌리지 않는다 — NSHostingView와 isMovableByWindowBackground"
date: 2026-11-11 11:00:00 +0900
categories: [macOS]
description: "macOS 27로 올린 뒤 타이틀바 없는 메인 창이 드래그로 움직이지 않았다. isMovableByWindowBackground가 NSHostingView 위에서 동작하지 않는 문제를 이벤트 처리 흐름에서 짚어 보고, Local Monitor와 performDrag로 해결한 과정을 정리한다."
---

> 이 글은 [클릭과 터치는 어떻게 버튼까지 가는가 — macOS와 iOS의 이벤트 전달, Hit-test, Gesture, Responder Chain]({% post_url 2026-11-11-macos-ios-event-handling %})에서 정리한 이벤트 처리 흐름을 바탕으로 한다.

macOS 27.2와 Xcode 27.2로 업데이트한 뒤 앱을 빌드하자, 메인 창을 마우스로 끌어도 움직이지 않았다.

창 관련 코드는 한 줄도 바꾸지 않았다. `isMovableByWindowBackground = true`도 그대로였다.

---

## 프로젝트 구조

메인 창은 SwiftUI `WindowGroup`으로 만들지만, 타이틀바를 없애기 위해 창을 바꿔 끼운다.

```swift
private struct removeStatusBar: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            guard let originalWindow = view.window else { return }
            let window = KeyReceivingWindow(
                contentRect: originalWindow.frame,
                styleMask: [.borderless, .miniaturizable],
                backing: .buffered,
                defer: false
            )
            window.contentView = originalWindow.contentView   // SwiftUI 콘텐츠를 새 창으로 옮김
            window.isMovableByWindowBackground = true
            originalWindow.orderOut(nil)
            window.makeKeyAndOrderFront(nil)
        }
        return view
    }
}
```

`.titled` 창이면 팝업이 뜬 뒤 메인 창 텍스트필드에 입력이 안 되는 버그가 있어서, 타이틀바가 아예 없는 `.borderless` 창을 새로 만든 것이다. `.borderless` 창은 기본적으로 키 윈도우가 될 수 없으므로 `canBecomeKey`를 오버라이드한 `KeyReceivingWindow`를 쓴다.

팝업 창은 이렇게 하지 않는다. `.windowStyle(.hiddenTitleBar)`로 타이틀바를 투명하게 만들고, 창을 띄운 뒤 신호등 버튼만 숨긴다.

| | 메인 창 | 팝업 창 |
|---|---|---|
| 창 종류 | `.borderless` (`KeyReceivingWindow`) | `.titled` (SwiftUI 기본 창) |
| 타이틀바 처리 | 창을 새로 만들어 교체 | `.hiddenTitleBar` + 신호등 버튼 숨김 |
| 이동 수단 | **배경 드래그뿐** | 투명한 타이틀바 드래그 |

메인 창은 타이틀바가 없으므로, 창을 옮기는 방법은 `isMovableByWindowBackground` 하나뿐이다.

---

## 원인

### 배경 드래그는 NSWindow.sendEvent에서 판단한다

이전 글에서 본 macOS 흐름에서, 배경 드래그는 창이 hit-test로 뷰를 찾은 직후에 판단한다.

```
  ② NSApplication.sendEvent
       └ Local Monitor 호출
  ③ NSWindow.sendEvent
       ├ hit-test로 받을 뷰 찾기
       ├ 키 윈도우 / first mouse 처리
       ├ 배경 드래그 판단           ← 여기
       ├ first responder 지정
       └ 찾은 뷰의 mouseDown 호출
```

`isMovableByWindowBackground`가 켜져 있고, hit-test로 찾은 뷰의 `mouseDownCanMoveWindow`가 `true`면 AppKit이 창 이동을 시작한다. 창 콘텐츠가 SwiftUI면 hit-test 결과는 항상 `NSHostingView`다.

### macOS 27에서 NSHostingView일 때 이 단계가 빠졌다

Apple 공식 문서나 릴리즈 노트는 찾지 못했다. 다만 macOS 27에서 같은 문제를 고친 프로젝트가 여럿 있고, 보고 내용이 일치한다.

- 마우스 이벤트는 창에 정상 도착한다
- `hitTest`는 `NSHostingView`를 반환하고, `mouseDownCanMoveWindow`도 `true`다
- 그런데도 AppKit이 창을 자동으로 옮기지 않는다
- 같은 창에 일반 `NSView`를 넣으면 정상적으로 옮겨진다

조건은 모두 맞는데 결과가 없다. `NSHostingView`일 때 **창을 자동으로 옮기는 단계만 빠진 것**으로 보인다. 이벤트 전달 문제는 아니다. Xcode(SDK) 업데이트와는 시기만 겹친 것으로 추정한다.

```
removeStatusBar → .borderless 창 → 이동 수단은 배경 드래그뿐
                                          │
                     macOS 27에서 NSHostingView 위 배경 드래그 동작 안 함
                                          ▼
                                 메인 창을 옮길 방법이 없음
```

팝업 창은 투명한 타이틀바가 남아 있어서, 상단 영역을 끄는 시스템 기본 동작은 영향을 받지 않는다.

---

## 시도한 방법

| 시도 | 방법 | 결과 |
|---|---|---|
| 1 | 콘텐츠 뒤(`.background`)에 투명 레이어 + `WindowDragGesture` | 실패 |
| 2 | `KeyReceivingWindow.sendEvent`에서 직접 `performDrag` | 부분 성공 |
| 3 | Local Monitor + `performDrag` + 제외 영역 표시 | 채택 |

### 1. 뒤에 깐 투명 레이어

```swift
background {
    Color.clear
        .contentShape(Rectangle())
        .gesture(WindowDragGesture())
}
```

빈 영역만 드래그되도록 콘텐츠 **뒤에** 드래그 레이어를 깔았다. 창이 전혀 움직이지 않았다.

`.background`로 깐 뷰는 콘텐츠 뒤의 **형제**다. SwiftUI hit-test는 앞에 있는 것부터 찾으므로 앞의 콘텐츠가 먼저 걸리고, SwiftUI에는 responder chain이 없으니 "처리 안 하면 뒤로 넘어가는" 일도 없다. 뒤의 레이어까지 클릭이 오지 않는다.

### 2. 창의 sendEvent에서 직접 처리

메인 창은 직접 만든 `KeyReceivingWindow`이므로 `sendEvent`를 오버라이드할 수 있다. mouseDown 후 드래그가 시작되면 `performDrag(with:)`를 호출하게 했다. 메인 창은 움직였지만 문제가 두 가지 남았다.

- **팝업 창에는 적용할 수 없다.** SwiftUI가 만든 창은 `sendEvent`를 오버라이드할 수 없다.
- **텍스트필드 여백에서도 창이 움직인다.** 클릭 지점의 hit-test 결과가 `NSControl`인지 확인해서 텍스트필드를 제외했는데, 입력 칸 위아래 여백에서는 창이 움직였다.

여백 문제는 입력 칸의 크기 때문이다. 디자인상 입력 칸은 패딩을 포함해 50pt인데, 실제 AppKit 텍스트필드는 가운데 16pt뿐이다. 계층을 찍어 보면 이렇다.

```
NSHostingView (0, 0, 200, 50)                         ← 입력 칸 전체 (흰 배경 + 패딩)
  AppKitPlatformViewHost<…PlatformTextFieldAdaptor> (0, 17, 200, 16)
    AppKitTextField (-2, 0, 204, 16)                  ← 실제 텍스트필드는 16pt
```

```
hit y=5   → NSHostingView     ← 아래 여백
hit y=20  → AppKitTextField
hit y=35  → NSHostingView     ← 위 여백
```

여백을 클릭하면 hit-test 결과가 `NSHostingView`라서 걸러지지 않는다.

---

## 해결: Local Monitor로 직접 창 옮기기

AppKit이 창을 자동으로 옮겨 주던 단계가 사라졌으니, **마우스 이벤트를 직접 받아 `performDrag(with:)`로 창 이동을 시작**한다. `performDrag(with:)`는 원래 AppKit이 배경 드래그 때 쓰던 API다. 빠진 호출 한 단계만 직접 해 주는 셈이다.

### 사용 방법

```swift
AppContentView(...)
    .windowDraggable()      // 이 뷰가 들어간 창을 배경 드래그로 옮길 수 있게 함

NomalTextField(...)
    .windowDragExcluded()   // 이 영역을 끌 때는 창을 옮기지 않음
```

```swift
extension View {
    func windowDraggable() -> some View {
        background(WindowDragHandler())      // WindowDragHandlerView를 깖
    }

    func windowDragExcluded() -> some View {
        background(WindowDragExclusion())    // WindowDragExclusionView를 깖
    }
}
```

### 이벤트는 hit-test보다 먼저 받는다

```swift
final class WindowDragHandlerView: NSView {
    private var monitor: Any?
    private var dragStartEvent: NSEvent?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        dragStartEvent = nil
        if window == nil {
            removeMonitor()
        } else if monitor == nil {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] event in
                let consumed = MainActor.assumeIsolated { self?.shouldConsume(event) ?? false }
                return consumed ? nil : event
            }
        }
    }
    // ...
}
```

`addLocalMonitorForEvents`는 흐름의 **② `NSApplication.sendEvent`** 단계에 끼어든다. 창의 hit-test보다 먼저 호출되므로, 어떤 뷰가 앞에 있든 이벤트를 볼 수 있다. 1번 시도가 막혔던 SwiftUI hit-test와도 상관없다.

- 클로저가 `event`를 반환하면 원래대로 전달되고, `nil`을 반환하면 이벤트가 사라진다.
- 반환값 `monitor`는 핸들러가 아니라 **등록 해제용 토큰**이다. 핸들러는 AppKit이 보관하고 직접 호출한다. 토큰은 중복 등록 방지(`monitor == nil`), 창에서 빠질 때 해제, `deinit` 정리에 쓴다.
- 모니터는 앱 전체 이벤트를 받으므로 `event.window === window`로 자기 창 이벤트만 처리한다.
- 창이 아니라 뷰에 둔 이유는 2번 시도의 팝업 문제 때문이다. 뷰 기반이면 어느 창에 붙여도 동작한다.

### 처리 흐름

```swift
private func shouldConsume(_ event: NSEvent) -> Bool {
    guard let window, event.window === window else { return false }
    switch event.type {
    case .leftMouseDown:
        dragStartEvent = isExcluded(event.locationInWindow, in: window) ? nil : event
    case .leftMouseDragged:
        if let start = dragStartEvent {
            dragStartEvent = nil
            window.performDrag(with: start)
            return true
        }
    case .leftMouseUp:
        dragStartEvent = nil
    default:
        break
    }
    return false
}
```

| 이벤트 | 동작 | 반환 |
|---|---|---|
| `leftMouseDown` | 제외 영역이 아니면 `dragStartEvent`에 기억 | `false` (버튼 등이 평소처럼 클릭을 받음) |
| `leftMouseDragged` | 기억한 mouseDown이 있으면 `performDrag` | `true` (드래그 이벤트는 뷰에 전달 안 함) |
| `leftMouseUp` | 기억한 값 초기화 | `false` |

클릭만 하고 끌지 않으면 아무 일도 하지 않는다.

### 제외 영역

```swift
private func containsExcludedView(_ view: NSView, at location: NSPoint) -> Bool {
    if view.isHiddenOrHasHiddenAncestor { return false }
    if view is NSControl || view is NSText || view is WindowDragExclusionView,
       view.convert(view.bounds, to: nil).contains(location) {
        return true
    }
    return view.subviews.contains { containsExcludedView($0, at: location) }
}
```

hit-test 결과 하나만 보지 않고 창의 뷰 계층을 모두 훑는다. 텍스트필드 위에 placeholder용 `Text`가 겹쳐 있어도 제외되도록 하기 위해서다.

| 대상 | 이유 |
|---|---|
| `NSControl` | SwiftUI `TextField`도 내부적으로 `AppKitTextField`(NSControl) 사용 |
| `NSText` | 편집 중인 텍스트의 드래그 선택 |
| `WindowDragExclusionView` | 2번 시도의 50pt 입력 칸 여백처럼 직접 지정한 영역 |

공통 텍스트필드 컴포넌트(`NomalTextField`, `PasswordTextField`, `EmailTextField`)의 입력 칸 전체에 `.windowDragExcluded()`를 붙였다.

### 텍스트필드에 windowDragExcluded()를 붙인 이유

`WindowDragHandlerView`는 창 콘텐츠 전체 뒤에 깔려서 **창 어디서든** 드래그를 감시한다. mouseDown 위치가 `NSControl`이나 `NSText`가 아니면, 그대로 끌었을 때 창 이동을 시작한다.

문제는 2번 시도에서 본 입력 칸의 크기다.

```
┌──────────────────────────────────────┐  ← 입력 칸 (50pt, 흰 배경)
│            위 여백 16pt              │     NSHostingView → 창 이동 대상
│  [AppKitTextField 16pt]  [지우기]    │     텍스트필드만 자동 제외, 지우기 버튼은 SwiftUI
│            아래 여백 16pt            │     NSHostingView → 창 이동 대상
└──────────────────────────────────────┘
```

사용자에게 입력 칸은 하나의 컨트롤이다. 그런데 자동으로 제외되는 건 가운데 16pt의 `AppKitTextField`뿐이라, 입력 칸 안에서도 이런 일이 생긴다.

| 동작 | `windowDragExcluded()` 없으면 | 있으면 |
|---|---|---|
| 여백을 눌러 포커스를 주다가 살짝 끌림 | 창이 움직임 | 창이 안 움직임 |
| 텍스트를 드래그로 선택하려고 여백에서 시작 | 창이 움직임 | 창이 안 움직임 |
| 지우기 / 비밀번호 보기 버튼을 누른 채 끌림 | 창이 움직이고, 버튼은 `mouseUp`을 못 받아 눌린 채로 남을 수 있음 | 창이 안 움직임 |

`.windowDragExcluded()`로 입력 칸 전체를 표시해 두면, `WindowDragHandlerView`가 mouseDown 위치를 확인할 때 이 영역을 제외한다. **입력 칸 안에서는 어디를 누르고 끌어도 창이 움직이지 않는다.**

### 보조 뷰는 hitTest를 오버라이드하지 않는다

`WindowDragHandlerView`와 `WindowDragExclusionView`는 둘 다 SwiftUI 콘텐츠 뒤에 깔리는 보조 뷰다. 처음에는 둘 다 `hitTest`에서 `nil`을 반환하게 했다. 클릭을 가로채면 버튼이 안 눌릴 거라고 생각했기 때문이다. 테스트해 보니 필요 없었다.

#### 보조 뷰가 붙는 위치

`.background(NSViewRepresentable)`로 깐 뷰가 실제로 어디 붙는지 찍어 보면 이렇다.

```
NSHostingView                       ← SwiftUI 콘텐츠(Button 등)는 여기서 처리
 ├ KeyViewProxy
 ├ AppKitPlatformViewHost           ← .background(NSViewRepresentable)
 │   └ WindowDragHandlerView        ← 자식 없음
 ├ _FocusRingView
 └ AppKitPlatformViewHost           ← TextField
     └ AppKitTextField
```

- 버튼은 보조 뷰의 하위 뷰가 **아니다.** SwiftUI 버튼은 NSView가 아니라 목록에 없고, `NSHostingView`가 직접 처리한다.
- 보조 뷰는 `NSHostingView`의 **하위 뷰**다.

#### 테스트: hitTest가 있을 때와 없을 때

실제 `WindowDrag.swift`를 그대로 가져와 `hitTest`를 `nil`로 반환하는 버전과 오버라이드하지 않는 버전을 빌드하고, 같은 화면에 클릭 이벤트를 보냈다. 이벤트는 `NSApp.sendEvent`로 보내서 Local Monitor도 거치게 했다.

```swift
VStack(spacing: 0) {
    HStack(spacing: 0) {
        Button("B") { ... }
        Spacer()                       // 아무것도 없는 빈 곳
    }
    TextField("", text: $text)
    Spacer()                           // 아무것도 없는 빈 곳
}
.windowDraggable()
```

| 클릭 위치 | `nil` 반환: hit-test 결과 | 오버라이드 안 함: hit-test 결과 | 동작 |
|---|---|---|---|
| 버튼 | `NSHostingView` | `NSHostingView` | 둘 다 버튼 실행 |
| 텍스트필드 | `AppKitTextField` | `AppKitTextField` | 둘 다 포커스 받음 |
| 빈 곳 | `NSHostingView` | **`WindowDragHandlerView`** | 둘 다 차이 없음 |
| 텍스트필드 포커스 중 빈 곳 | `NSHostingView` | **`WindowDragHandlerView`** | 둘 다 포커스 유지 |

부모에 `.contentShape(Rectangle()).onTapGesture`를 단 화면도 테스트했다. 이때는 빈 곳도 SwiftUI 콘텐츠로 덮이므로 두 버전 모두 hit-test 결과가 `NSHostingView`였고, 부모 탭이 실행됐다.

#### 앞에 SwiftUI 콘텐츠가 있으면 보조 뷰는 걸리지 않는다

`NSHostingView`의 hit-test는 SwiftUI 뷰 트리의 앞뒤 순서를 따른다. 보조 뷰가 hit-test에 걸리는 건 **앞에 SwiftUI 콘텐츠가 전혀 없는 곳뿐**이다. 버튼, 텍스트, `Color` 같은 콘텐츠가 있는 곳은 `NSHostingView`가 먼저 받는다.

#### 걸려도 responder chain으로 NSHostingView까지 올라간다

빈 곳에서는 hit-test 결과가 보조 뷰로 바뀌었지만 동작은 같았다. 배경이 투명한 줄에 보조 뷰를 깔고 부모에 `.onTapGesture`를 단 경우도, hit-test 결과는 보조 뷰였는데 부모 탭이 실행됐다.

보조 뷰는 `mouseDown`을 구현하지 않으므로, `NSResponder` 기본 구현이 이벤트를 부모로 넘긴다.

```
NSWindow ──(전달)──▶ 보조 뷰.mouseDown
                       │ 구현 안 함 → NSResponder 기본 구현
                       ▼
                    AppKitPlatformViewHost.mouseDown
                       ▼
                    NSHostingView.mouseDown     ← 결국 SwiftUI가 받음
```

[이전 글]({% post_url 2026-11-11-macos-ios-event-handling %})에서 정리한 responder chain이 실제로 동작하는 예시다.

#### 처음 판단이 틀렸던 이유

- **오버레이 패턴을 그대로 가져왔다.** 화면 **앞에** 덮는 오버레이는 hit-test에서 `nil`을 반환해야 뒤의 뷰가 클릭을 받는다. 보조 뷰는 콘텐츠 **뒤**에 깔리는데 같은 상황으로 생각했다.
- **"hit-test에 걸리면 클릭을 빼앗긴다"고 가정했다.** 빼앗기는 건 걸린 뷰가 이벤트를 직접 처리하거나, `NSHostingView`와 관계없는 곳에 있을 때다. 보조 뷰는 `NSHostingView`의 하위 뷰이고 `mouseDown`을 구현하지 않으니, 이벤트는 responder chain을 따라 `NSHostingView`로 돌아간다.
- **hit-test 결과만 보고 동작을 판단했다.** 처음에는 계층과 hit-test 결과만 찍었고, 실제 클릭 이벤트를 보내 동작을 확인한 건 나중이었다.

창 드래그는 hit-test보다 먼저 Local Monitor에서 처리하므로, `hitTest` 오버라이드와 관계없다. 제외 영역 판단도 hit-test가 아니라 위치(frame) 비교로 한다. 그래서 두 보조 뷰 모두 `hitTest`를 지웠다.

```swift
// 클릭을 받지 않고 영역 표시만 함. 제외 여부는 WindowDragHandlerView가 frame으로 판단
final class WindowDragExclusionView: NSView {}
```

### isMovableByWindowBackground를 제거했다

`hitTest`를 지우면 메인 창의 빈 곳을 클릭했을 때 hit-test 결과가 `NSHostingView`가 아니라 **일반 `NSView`**(`WindowDragHandlerView`)가 된다.

macOS 27 보고에 따르면 AppKit의 자동 배경 드래그는 `NSHostingView`에서만 동작하지 않고, 일반 `NSView`에서는 여전히 동작한다. `isMovableByWindowBackground = true`가 남아 있으면, 빈 곳을 끌 때 AppKit의 자동 이동과 Local Monitor의 `performDrag`가 **둘 다** 시작될 수 있다.

실제 드래그는 가짜 이벤트로 재현할 수 없어서 이 충돌이 생기는지는 확인하지 못했다. 다만 이제 창 이동은 `.windowDraggable()`이 전부 맡으므로, 쓰지 않는 설정을 남겨 둘 이유가 없다. `removeStatusBar`에서 지우고, 창 이동 경로를 `performDrag` 하나로 맞췄다.

```swift
window.maxSize = fixedSize
// 창 이동은 .windowDraggable()에서 처리 (macOS 27부터 NSHostingView 위에서 isMovableByWindowBackground 동작 안 함)
window.hasShadow = true
```

### 메인 창 교체 대응

`removeStatusBar`가 콘텐츠를 `KeyReceivingWindow`로 옮길 때 `WindowDragHandlerView`도 함께 옮겨지면서 `viewDidMoveToWindow`가 다시 불린다. 처리할 창을 고정해 두지 않고, 이벤트마다 그 시점의 `self.window`와 비교하므로 옮겨진 창에서도 동작한다.

---

## 남은 것

- 버튼을 누른 채로 끌어 창을 옮기면, 창 이동이 시작된 뒤 버튼은 `mouseUp`을 받지 못한다. 눌린 모양으로 남을 수 있다.
- 공통 컴포넌트 없이 `TextField`를 직접 쓰는 화면은 실제 텍스트필드 영역만 제외된다. 여백까지 막으려면 `.windowDragExcluded()`를 붙여야 한다.
- `DragGesture`를 쓰는 뷰를 추가하면 창 이동과 겹친다. 그 뷰에도 `.windowDragExcluded()`가 필요하다.
- 원인을 우리 앱에서 직접 확인하려면 `.windowDraggable()`을 잠시 빼고 `isMovableByWindowBackground = true`를 다시 켠 뒤, `sendEvent`에 로그를 넣어 `mouseDownCanMoveWindow`와 `isMovableByWindowBackground`가 모두 `true`인데도 창이 안 움직이는지 보면 된다.

```swift
override func sendEvent(_ event: NSEvent) {
    if event.type == .leftMouseDown, let contentView {
        let hit = contentView.hitTest(contentView.convert(event.locationInWindow, from: nil))
        print("mouseDown hit:", hit.map { "\(type(of: $0))" } ?? "nil",
              "canMove:", hit?.mouseDownCanMoveWindow ?? false,
              "movableByBG:", isMovableByWindowBackground)
    }
    super.sendEvent(event)
}
```

---

## 참고

- [Cannot move window by its background (macOS 27) – Apple Developer Forums](https://developer.apple.com/forums/thread/853823)
- [Snapzy PR #584 – Restore pinned window dragging on macOS 27](https://github.com/duongductrong/Snapzy/pull/584)
- [meeting-reminder PR #46](https://github.com/adamswbrown/meeting-reminder/pull/46) / [Issue #39](https://github.com/adamswbrown/meeting-reminder/issues/39)
- [DoublEnder PR #2](https://github.com/sevmorris/DoublEnder/pull/2)
- [meeting-transcriber PR #730](https://github.com/pasrom/meeting-transcriber/pull/730)
