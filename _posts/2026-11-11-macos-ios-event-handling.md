---
layout: post
title: "클릭과 터치는 어떻게 버튼까지 가는가 — macOS와 iOS의 이벤트 전달, Hit-test, Gesture, Responder Chain"
date: 2026-11-11 10:00:00 +0900
categories: [iOS, macOS]
description: "마우스 클릭과 터치가 하드웨어에서 출발해 시스템, 앱, 창을 거쳐 버튼의 액션까지 도착하는 과정을 macOS와 iOS로 나눠 정리한다. hit-test와 responder chain의 방향과 역할, 제스처 인식기가 끼어드는 시점, SwiftUI가 들어갔을 때 달라지는 점, 여러 창 사이에서 이벤트가 어떻게 나뉘는지 비교한다."
---

버튼을 누르면 액션이 실행된다. 너무 당연해서 그 사이에 무슨 일이 일어나는지 생각해 볼 일이 별로 없다.

그런데 타이틀바 없는 창이 드래그로 움직이지 않는 문제를 고치면서, 클릭이 어디서 어떻게 처리되는지 정확히 알아야 했다. 그 과정에서 hit-test와 responder chain의 방향이 계속 헷갈렸고, 같은 개념이 iOS에서는 또 다르게 동작했다.

이 글은 클릭과 터치가 **하드웨어에서 버튼의 액션까지** 가는 과정을 macOS와 iOS로 나눠 처음부터 정리한다.

---

## 전체 그림

먼저 큰 흐름부터 본다. macOS와 iOS 모두 크게 세 구간으로 나뉜다.

| 구간 | 하는 일 | macOS | iOS |
|---|---|---|---|
| 시스템 | 입력을 이벤트로 만들고 **어느 앱**에 줄지 정함 | IOKit → WindowServer | IOKit → backboardd |
| 앱 | 이벤트를 받아 **어느 창**에 줄지 정함 | `NSApplication` | `UIApplication` |
| 창 | **어느 뷰**에 줄지 정하고 처리 | `NSWindow` → hit-test → responder chain | `UIWindow` → hit-test → gesture → responder chain |

이 글에서 가장 중요한 건 마지막 구간이다. 창 안에서 이벤트는 세 단계를 거친다.

| 단계 | 하는 일 |
|---|---|
| 1. Hit-test | 이벤트를 **받을 뷰를 정함** |
| 2. 전달 | 정해진 뷰에게 이벤트를 **전달** (iOS는 제스처 인식기가 먼저 봄) |
| 3. Responder chain | 받은 뷰가 처리하지 않으면 **부모로 넘김** |

하나씩 본다.

---

## macOS: 클릭이 버튼까지

```
[하드웨어]  마우스 / 트랙패드
    ▼
[커널]  IOKit HID 드라이버 → HID 이벤트 시스템
    ▼
[WindowServer]  커서 아래 창과 그 창의 앱을 찾아 이벤트 전송 (Mach 포트)
    ▼
[앱 - 메인 스레드]
  ① 런루프가 깨어나 NSEvent로 변환
  ② NSApplication.run → nextEvent → sendEvent
       └ Local Monitor 호출
  ③ NSWindow.sendEvent
       ├ hit-test로 받을 뷰 찾기
       ├ 키 윈도우 / first mouse 처리
       ├ 배경 드래그 판단 (isMovableByWindowBackground)
       ├ first responder 지정
       └ 찾은 뷰의 mouseDown 호출
  ④ 뷰의 mouseDown
       ├ AppKit NSButton → 트래킹 루프 → sendAction
       └ NSHostingView  → SwiftUI 내부 처리 → Button action
```

### 시스템: WindowServer가 창까지 정한다

- 마우스를 누르면 커널의 IOKit HID 드라이버가 입력을 이벤트로 만든다.
- **WindowServer**는 화면의 모든 창의 위치와 순서를 알고 있다. 커서 아래에서 맨 앞에 있는 창과, 그 창을 가진 앱을 찾는다.
- 찾은 앱에 Mach 포트로 이벤트를 보낸다.

이 단계에서 **어느 창인지**까지 정해진다. 창 안의 어느 뷰인지는 아직 모른다.

### 앱: NSApplication

- 메인 스레드 런루프가 Mach 포트 메시지를 받고 깨어나 `NSEvent`로 바꾼다.
- `NSApplication.run()`은 `nextEvent(...)`로 이벤트를 꺼내 `sendEvent(_:)`로 보낸다.
- `NSEvent.addLocalMonitorForEvents`로 등록한 **Local Monitor**는 이 단계에서 호출된다. 창이나 뷰보다 먼저 이벤트를 본다. 여기서 `nil`을 반환하면 아래 단계는 일어나지 않는다.
- 마우스 이벤트는 `event.window`의 `NSWindow.sendEvent(_:)`로 간다.

### 창: NSWindow.sendEvent

`leftMouseDown`이 오면 창은 이런 일을 한다.

1. **Hit-test**: 클릭 위치에서 이벤트를 받을 뷰를 찾는다.
2. **창 활성화**: 비활성 창이면 키 윈도우로 만든다. 이때 그 뷰의 `acceptsFirstMouse`가 `false`면 첫 클릭은 활성화에만 쓰이고 뷰에는 전달되지 않는다.
3. **배경 드래그 판단**: `isMovableByWindowBackground`가 켜져 있고 찾은 뷰의 `mouseDownCanMoveWindow`가 `true`면 창 이동을 시작한다.
4. **first responder 지정**: 찾은 뷰가 `acceptsFirstResponder`면 first responder로 만든다. 텍스트필드를 클릭하면 키보드 입력을 받게 되는 이유다.
5. 찾은 뷰의 `mouseDown(with:)`을 호출한다.

mouseDown을 받은 뷰가 이후의 `mouseDragged`, `mouseUp`도 계속 받는다. 드래그하다 영역 밖으로 나가도 다시 hit-test 하지 않는다.

### 뷰: AppKit 버튼

1. `NSControl.mouseDown`이 **트래킹 루프**를 돌린다. 마우스를 뗄 때까지 이벤트를 직접 꺼내 처리한다.
2. 커서가 버튼 안이면 눌린 모양, 밖이면 원래 모양으로 바꾼다.
3. 버튼 안에서 떼면 `NSApp.sendAction(action, to: target, from: self)`를 호출한다.
4. `target`이 `nil`이면 responder chain을 따라 그 액션을 구현한 객체를 찾는다.

---

## Hit-test: 받을 뷰 정하기

### 예시 화면

이후 예시는 모두 이 계층을 기준으로 한다.

```
NSWindow
 └ contentView
     ├ BackView          (먼저 추가 → 뒤에 그려짐)
     └ FrontView         (나중에 추가 → 앞에 그려짐)
         └ Button
```

`Button` 위치를 클릭한다. 그 위치는 `FrontView`와 `BackView`가 모두 덮고 있다.

### hitTest가 묻는 것

`view.hitTest(point)`는 이렇게 묻는 함수다.

> 이 점을 클릭했을 때, **나와 내 하위 뷰 중에서** 누가 받아야 하나?

| 반환값 | 의미 |
|---|---|
| 하위 뷰 | 내 안의 이 뷰가 받아야 한다 |
| `self` | 하위 뷰는 해당 없고, 내가 받는다 |
| `nil` | 나도, 내 하위 뷰도 해당 없다 |

### 기본 구현 (개념)

```swift
func hitTest(_ point: NSPoint) -> NSView? {
    // 점이 내 영역 밖이면 → 해당 없음
    guard !isHidden, frame.contains(point) else { return nil }

    // 하위 뷰에게 '앞에 있는 것부터' 물어봄
    for subview in subviews.reversed() {
        if let hit = subview.hitTest(convert(point, to: subview)) {
            return hit          // 처음으로 답한 뷰로 결정
        }
        // nil이면 → 다음(더 뒤에 있는) 하위 뷰에게 물어봄
    }

    // 하위 뷰가 모두 nil → 내가 받는 걸로 결정
    return self
}
```

### 호출은 부모 → 자식, 답은 자식 → 부모

hitTest는 재귀 함수라서 방향이 두 개 있다.

| | 방향 | 오가는 것 |
|---|---|---|
| 호출 | 부모 → 자식 | "이 점 네 거야?" 라는 질문 |
| 반환 | 자식 → 부모 | "이 뷰야" 또는 "아니(`nil`)" 라는 답 |

이 과정에서 **이벤트는 오가지 않는다.** 누구에게 줄지 정하는 함수 호출일 뿐이다.

### 순서

1. `NSWindow`가 `contentView.hitTest` 호출
2. `contentView`가 하위 뷰 중 **앞에 있는 것부터** 물어봄 → `FrontView.hitTest`
3. `FrontView`가 하위 뷰에게 물어봄 → `Button.hitTest`
4. `Button`은 하위 뷰가 없고, 점이 자기 영역 안 → `Button` 반환
5. `FrontView`, `contentView`도 그대로 `Button` 반환 → **결정: `Button`**
6. `BackView`에게는 묻지 않음

### nil을 반환하면

`nil`은 "내 위에 아무 뷰도 없다"는 뜻이 **아니다.** "나와 내 하위 뷰는 해당 없다"는 뜻이다. 질문한 부모는 그 답을 받고 **다음 하위 뷰에게 묻거나, 자기 자신으로 결정**한다.

| 상황 | 결과 |
|---|---|
| `Button`이 `nil` 반환 | `FrontView`는 다른 하위 뷰가 없으니 자기 자신으로 결정 |
| `FrontView`도 `nil` 반환 | `contentView`가 다음 하위 뷰 `BackView`에게 물어봄 → `BackView`로 결정 |

뒤에 있는 형제 뷰가 클릭을 받으려면, 앞에 있는 뷰가 hit-test에서 `nil`을 반환해야 한다.

---

## 전달: 창이 정해진 뷰에게 한 번

hit-test로 뷰가 정해지면, **`NSWindow`가 그 뷰의 `mouseDown(with:)`을 호출**한다. AppKit에서 뷰에게 이벤트를 전달하는 방법이 이 메서드 호출이다.

```swift
// NSWindow.sendEvent (개념)
let target = contentView.hitTest(point)   // Button
target.mouseDown(with: event)             // NSWindow가 Button에게 전달
```

이벤트 전달은 여기서 **한 번** 일어난다.

---

## Responder Chain: 처리 못 하면 부모로 넘기기

### 누가 넘기나

처음 전달은 창이 하고, 그다음부터는 **각 responder가 자기 `nextResponder`에게** 넘긴다. 모든 뷰는 `NSResponder`를 상속하고, 기본 `mouseDown`이 이렇게 되어 있다.

```swift
// NSResponder 기본 구현 (개념)
func mouseDown(with event: NSEvent) {
    nextResponder?.mouseDown(with: event)   // 다음 responder에게 그대로 넘김
}
```

- `mouseDown`을 오버라이드하지 않으면 기본 구현이 실행되어 부모에게 넘어간다.
- 오버라이드해서 처리하고 `super.mouseDown`을 부르지 않으면 거기서 끝난다.

### nextResponder는 언제 정해지나

이벤트가 올 때 정해지는 게 아니다. **뷰 계층을 만들 때 AppKit이 미리 연결해 둔다.**

| 시점 | 설정되는 값 |
|---|---|
| `superview.addSubview(view)` | `view.nextResponder = superview` |
| `window.contentView = view` | `view.nextResponder = window` |
| `NSViewController`의 view를 계층에 추가 | `view.nextResponder = viewController`, `viewController.nextResponder = superview` |
| `NSWindowController`가 창을 관리 | `window.nextResponder = windowController` |

뷰를 다른 부모로 옮기면 그때 다시 바뀐다. 이벤트가 올 때는 이미 연결된 목록을 따라가기만 한다.

### 순서

`Button`이 `mouseDown`을 처리하지 않으면:

```
NSWindow ──(전달)──▶ Button.mouseDown
                       │ 처리 안 함
                       ▼
                    FrontView.mouseDown       ← Button이 넘김
                       │ 처리 안 함
                       ▼
                    contentView.mouseDown     ← FrontView가 넘김
                       ▼
                    NSWindow.mouseDown        ← contentView가 넘김
                       ▼
                    윈도우 컨트롤러 → 끝
```

**부모로만** 올라가기 때문에 `BackView`는 끼지 않는다. 화면상 바로 뒤에 있어도 부모가 아니면 받지 못한다.

### 마우스에만 쓰이지 않는다

hit-test는 위치가 있는 이벤트에만 쓰인다. responder chain은 더 넓게 쓰인다.

| 이벤트 | 처음 받는 객체 | 처리 못 하면 |
|---|---|---|
| 마우스 클릭 | **hit-test**로 찾은 뷰 | responder chain으로 부모에게 |
| 키보드 입력 | 창의 **first responder** (hit-test 없음) | responder chain으로 부모에게 |
| 메뉴 / 단축키 액션 (target `nil`) | first responder | 액션을 구현한 객체를 찾을 때까지 올라감 |

텍스트필드를 클릭하면 hit-test로 텍스트필드가 찾아지고, 텍스트필드가 first responder가 된다. 이후 키보드 입력은 hit-test 없이 바로 그 텍스트필드로 간다.

### Hit-test와 Responder Chain 비교

| | Hit-test | Responder chain |
|---|---|---|
| 하는 일 | 받을 뷰를 **정하기** | 정해진 뷰가 처리 못 하면 **넘기기** |
| 시점 | 이벤트 전달 전 | 이벤트 전달 후 |
| 이벤트가 오가나 | 안 오감 (질문과 답만) | 오감 |
| 진행 방향 | 호출: 부모 → 자식, 형제끼리는 앞 → 뒤 | 받은 뷰 → 부모 |
| 뒤에 있는 형제 뷰로 가나 | 감 (앞의 뷰가 `nil`이면) | 안 감 |
| 비켜 주는 방법 | `hitTest`에서 `nil` 반환 | 처리하지 않고 넘김 |

hit-test는 이벤트의 **출발점을 찾는 방법**이고, responder chain은 출발점에서 **처리할 객체를 찾아 올라가는 경로**다.

---

## iOS: 터치가 버튼까지

```
[하드웨어]  터치스크린 디지타이저
    ▼
[커널]  IOKit HID 드라이버
    ▼
[backboardd]  터치 위치의 앱 / 씬을 찾아 이벤트 전송 (Mach 포트)
    ▼
[앱]
  ① 이벤트 수신 → UIEvent / UITouch로 변환
  ② UIApplication.sendEvent
  ③ 씬 안의 창들 중 hitTest로 받을 창과 뷰를 찾음
  ④ UIWindow.sendEvent
       ├ hit view와 그 부모들에 붙은 제스처 인식기에 먼저 전달
       └ hit view의 touchesBegan
  ⑤ 제스처 인식 결과에 따라 액션 실행 또는 뷰의 터치 처리
```

큰 흐름은 macOS와 같다. 차이는 두 군데다.

1. 시스템(backboardd)은 **어느 앱(씬)인지**까지만 정한다. 같은 씬 안의 여러 창 중 누가 받을지는 **앱 안의 UIKit이 hitTest로** 정한다.
2. 창 안에서 **제스처 인식기**가 hit view보다 먼저 터치를 본다.

### iOS의 hit-test

원리는 macOS와 같다. 부모 → 자식으로 호출하고, 형제끼리는 앞에 있는 것부터 묻는다. 메서드 모양과 조건이 조금 다르다.

```swift
// UIView 기본 구현 (개념)
func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01,
          self.point(inside: point, with: event) else { return nil }
    for subview in subviews.reversed() {
        if let hit = subview.hitTest(convert(point, to: subview), with: event) {
            return hit
        }
    }
    return self
}
```

- `isUserInteractionEnabled = false`, `isHidden = true`, `alpha`가 거의 0인 뷰는 후보에서 빠진다.
- 영역 판단은 `point(inside:with:)`가 한다. 이걸 오버라이드하면 버튼의 터치 영역을 보이는 크기보다 넓힐 수 있다.

### 제스처 인식기: hit-test 다음에 끼어든다

제스처 인식기가 "먼저 본다"는 건 hit-test와 동시에 판단한다는 뜻이 아니다. 순서대로 일어난다.

```
① hit-test        UIWindow.hitTest → hit view 결정 (인식기는 관여 안 함)
② 인식기 수집      hit view와 그 부모들, 창에 붙은 제스처 인식기를 모두 모음
③ 터치 전달        모은 인식기들에게 먼저 → 그다음 hit view의 touchesBegan
④ 인식 결과        인식기가 인식하면 hit view는 touchesCancelled
```

같은 터치가 인식기와 hit view **둘 다에게** 간다. 인식기가 먼저 받고, 인식에 성공하면 뷰는 받던 터치를 취소당한다.

```
ParentView  ← UITapGestureRecognizer
 └ ChildView   (touchesBegan 구현)
```

ChildView를 탭하면:

1. **hit-test**: `ChildView`로 결정
2. **인식기 수집**: `ChildView`에는 없음 → 부모 `ParentView`의 탭 인식기를 모음
3. **전달**: 탭 인식기가 먼저 터치를 받고, `ChildView.touchesBegan`도 호출됨
4. **인식**: 탭으로 인식됨 → `ChildView`는 `touchesCancelled`, 탭 액션 실행

hit view는 `ChildView`인데 부모의 인식기가 이겼다. responder chain처럼 처리 못 해서 부모로 넘어간 게 아니라, **처음부터 부모의 인식기도 같은 터치를 받았기 때문**이다.

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `cancelsTouchesInView` | `true` | 인식되면 뷰의 터치를 취소 |
| `delaysTouchesBegan` | `false` | `true`면 인식 실패가 확정될 때까지 뷰에 `touchesBegan`을 보내지 않음 |
| `delaysTouchesEnded` | `true` | 인식 여부가 정해질 때까지 `touchesEnded`를 늦춤 |

`UIButton` 같은 `UIControl`의 기본 탭 동작은 부모의 탭 인식기보다 우선한다. 그래서 부모에 탭 인식기가 있어도 버튼은 동작한다.

macOS에도 `NSGestureRecognizer`가 있고 같은 방식으로 끼어든다. 다만 macOS는 `mouseDown` 같은 이벤트 메서드 중심이고, iOS는 제스처 인식기 중심이다.

### UIControl

`UIButton`은 `UIControl`의 하위 클래스다.

1. hit-test로 버튼이 hit view가 된다.
2. `beginTracking`, `continueTracking`, `endTracking`으로 터치를 추적한다.
3. 손가락이 버튼 안에서 떨어지면 `sendActions(for: .touchUpInside)`를 호출한다.
4. target이 `nil`이면 first responder부터 responder chain을 따라 액션을 구현한 객체를 찾는다.

### iOS의 responder chain

창 안에서는 macOS와 같다. 끝부분만 다르다.

```
UIView → (루트 뷰면 UIViewController) → superview → … → UIWindow → (UIWindowScene) → UIApplication → AppDelegate
```

`touchesBegan`을 오버라이드하지 않은 뷰는 기본 구현이 `next`에게 넘긴다. 터치를 받은 뷰는 손을 뗄 때까지 그 터치를 계속 받는다.

---

## SwiftUI가 들어가면

SwiftUI의 `Button`, `Text`, `Color`는 `NSView`나 `UIView`가 아니다. AppKit/UIKit 입장에서는 존재하지 않으므로, 플랫폼의 hit-test와 responder chain은 **호스팅 뷰(`NSHostingView` / `_UIHostingView`)에서 멈춘다.**

```
[AppKit / UIKit]  창 → hit-test → 호스팅 뷰 결정 → 호스팅 뷰에 전달
[SwiftUI]         ① SwiftUI 뷰 트리에서 hit-test (앞 → 뒤, allowsHitTesting / contentShape 반영)
                  ② 제스처 경쟁으로 승자 결정
                  ③ Button action 클로저 실행
```

SwiftUI 안에는 responder chain이 없고, 대신 **제스처 경쟁**으로 정한다. 위치로 후보를 정한 뒤, 그 위치에 걸린 부모와 자식의 제스처가 함께 경쟁한다. iOS의 제스처 인식기와 비슷한 개념이다.

| 부모에 붙인 방식 | 결과 |
|---|---|
| `.gesture` / `.onTapGesture` | 자식이 이김 (기본) |
| `.highPriorityGesture` | 부모가 이김 |
| `.simultaneousGesture` | 둘 다 동작 |

- `.allowsHitTesting(false)`인 뷰는 후보에서 빠진다.
- `Color.clear`나 `Spacer`처럼 아무것도 그리지 않는 영역은 기본적으로 클릭되지 않는다. `.contentShape(Rectangle())`로 영역을 지정할 수 있다.

**예외**: `TextField`, `SecureField`, `NSViewRepresentable` / `UIViewRepresentable`은 내부에 실제 플랫폼 뷰가 있다. 이 경우 플랫폼 hit-test가 호스팅 뷰에서 멈추지 않고 그 뷰까지 내려간다. macOS에서 `TextField`가 들어간 SwiftUI 뷰의 계층을 찍어 보면 이렇다.

```
NSHostingView
  AppKitPlatformViewHost<PlatformViewRepresentableAdaptor<PlatformTextFieldAdaptor>>
    AppKitTextField          ← NSControl 하위 클래스
      NSTextFieldSimpleLabel
```

그래서 텍스트필드는 플랫폼의 first responder가 되어 키보드 입력을 받는다.

SwiftUI 내부 구현은 공개되지 않았으므로, 이 절은 문서에 나온 규칙과 관찰한 동작 기준이다.

---

## 여러 창이 있을 때

A 창 위에 B 창이 겹쳐 있다. B 안의 뷰가 모두 hit-test에서 `nil`을 반환하면 A로 넘어갈까?

### macOS: 넘어가지 않는다

```
마우스 클릭
  ▼
[WindowServer]  화면 좌표에서 '맨 앞에 있는 창' 찾기
  │  - 창 레벨(level)이 높은 창이 앞
  │  - 같은 레벨이면 나중에 앞으로 온 창이 앞
  │  - ignoresMouseEvents = true인 창은 건너뜀
  ▼
[B Window]  B 안에서 hit-test → B의 뷰에게 전달
```

- 창 선택은 앱 밖의 **WindowServer**가 이미 끝냈다. B 안에서 `nil`을 반환해도 결국 B의 contentView나 창이 받는다.
- responder chain도 B 창 → 윈도우 컨트롤러에서 끝난다. A와 B는 서로의 `nextResponder`가 아니다.
- 창 전체를 통과시키려면 `ignoresMouseEvents = true`를 쓴다. 투명한 창(`isOpaque = false`)의 완전히 투명한 픽셀은 WindowServer가 뒤의 창으로 보낼 수 있다.
- 예외로, target이 `nil`인 액션 메시지는 **키 윈도우 → 메인 윈도우 → `NSApp` → 앱 델리게이트** 순서로 처리할 객체를 찾는다.

### iOS: 넘어간다

```
[UIKit]  씬 안의 창들을 windowLevel이 높은 순으로
  ├─ 창C.hitTest(point) → nil       → 다음 창으로
  ├─ 창B.hitTest(point) → nil       → 다음 창으로
  └─ 창A.hitTest(point) → someView  → 결정
```

같은 씬 안의 창 선택을 **앱 안의 UIKit이 hitTest로** 하기 때문에, 위 창이 `nil`을 반환하면 아래 창으로 넘어간다. 플로팅 버튼이나 디버그 오버레이 창에서 자주 쓰는 패턴이다.

```swift
final class PassthroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self || hit === rootViewController?.view ? nil : hit   // 빈 곳이면 아래 창으로
    }
}
```

macOS에서는 이 패턴이 통하지 않는다. responder chain은 iOS도 창을 넘어가지 않는다.

---

## 정리

| | macOS | iOS |
|---|---|---|
| 앱 선택 | WindowServer | backboardd |
| **창 선택** | **WindowServer** (앱 밖) | **UIKit의 hitTest** (앱 안) |
| 위 창이 `nil` 반환 | 뒤의 창으로 **안 감** | 아래 창으로 **감** |
| 창 전체 통과 | `ignoresMouseEvents = true` | `hitTest`에서 `nil`, `isUserInteractionEnabled = false`, `isHidden = true` |
| 창 안의 hit-test | `hitTest(_:)`, 부모 → 자식, 앞 → 뒤 | `hitTest(_:with:)` + `point(inside:with:)`, 같은 순서 |
| 이벤트 전달 | 창이 hit view의 `mouseDown` 호출 | 제스처 인식기에 먼저, 그다음 hit view의 `touchesBegan` |
| 제스처 인식기 | 있지만 이벤트 메서드 중심 | 인식기 중심 |
| Responder chain | 뷰 → 부모 → 창 → 윈도우 컨트롤러 | 뷰 → (뷰 컨트롤러) → 부모 → 창 → 씬 → `UIApplication` → `AppDelegate` |
| 앱 단계에서 먼저 가로채기 | `addLocalMonitorForEvents` | `UIApplication.sendEvent` 오버라이드 |
| SwiftUI | `NSHostingView`에서 플랫폼 처리가 멈추고 제스처 경쟁 | `_UIHostingView`에서 멈추고 제스처 경쟁 |

세 가지만 기억하면 된다.

1. **hit-test는 받을 뷰를 정하는 질문**이다. 호출은 부모 → 자식, 답은 자식 → 부모로 오가고, 이벤트는 오가지 않는다. `nil`은 "나는 아니다"라는 답이다.
2. **responder chain은 처리 못 한 이벤트가 부모로 올라가는 경로**다. 형제나 다른 창으로는 가지 않는다.
3. **창을 고르는 주체가 다르다.** macOS는 앱 밖의 WindowServer가, iOS는 앱 안의 UIKit이 고른다.
