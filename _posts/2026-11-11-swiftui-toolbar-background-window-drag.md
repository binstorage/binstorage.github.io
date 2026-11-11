---
layout: post
title: "툴바 배경색 한 줄에 창이 끌리지 않는다 — toolbarBackground와 onTapGesture"
date: 2026-11-11 12:00:00 +0900
categories: [macOS]
description: "SwiftUI 창에 toolbarBackground(Color, for: .windowToolbar)를 넣자 일부 화면에서 툴바를 잡고 창을 끌 수 없게 됐다. 같은 modifier를 쓰는 다른 화면은 멀쩡했다. 차이가 modifier가 아니라 화면 본문의 onTapGesture에 있었던 이유를 hit-test와 제스처 처리 순서로 정리한다."
---

> 이 글은 [클릭과 터치는 어떻게 버튼까지 가는가 — macOS와 iOS의 이벤트 전달, Hit-test, Gesture, Responder Chain]({% post_url 2026-11-11-macos-ios-event-handling %})에서 정리한 이벤트 처리 흐름을 바탕으로 한다.

툴바 색을 맞추려고 공통 내비게이션 modifier에 한 줄을 넣었다.

```swift
.toolbarBackground(Color.navBar, for: .windowToolbar)
```

그러자 로그인 화면에서 툴바를 잡고 창을 끌 수 없게 됐다. 이상한 건, 같은 줄이 들어 있는 다른 modifier를 쓰는 화면은 여전히 잘 끌린다는 점이었다.

---

## 증상

| 화면 | 사용 modifier | 툴바 드래그 |
|---|---|---|
| LoginScreen | `navBarWithoutBackButton` | 안 됨 |
| EmailVerificationScreen | `navBarWithoutBackButton` / `navBar` | 안 됨 |
| SelectMFATypeScreen | `navBarWithFlag` | 됨 |

세 modifier 모두 `toolbarBackground(Color.navBar, for: .windowToolbar)`를 갖고 있다. 그 줄을 빼면 LoginScreen도 다시 끌린다.

```swift
struct NavBarWithoutBackButtonModifier: ViewModifier {
    let title: String

    func body(content: Content) -> some View {
        content
            .navigationTitle(Text(LocalizedStringKey(title)))
            .toolbar { /* 가운데 제목 */ }
            .toolbarBackground(Color.navBar, for: .windowToolbar)   // 이 줄을 넣으면 LoginScreen이 안 끌림
            .toolbarBackground(.visible, for: .windowToolbar)
    }
}
```

`navBarWithFlag`에도 같은 두 줄이 있다. 그러니 원인은 modifier가 아니라 **각 화면의 본문**에 있다.

---

## 창 구조

이 앱의 창은 모두 타이틀바를 숨긴다.

```swift
WindowGroup { ... }
    .windowToolbarStyle(.unified(showsTitle: false))
    .windowStyle(.hiddenTitleBar)
```

`.hiddenTitleBar`는 AppKit 기준으로 타이틀바가 투명하고(`titlebarAppearsTransparent`) 콘텐츠가 창 전체를 덮는(`fullSizeContentView`) 상태다. SwiftUI 콘텐츠가 툴바 **아래까지** 깔려 있고, 그 위에 타이틀바·툴바 뷰가 올라가 있다.

```
NSWindow
 └─ NSThemeFrame
     ├─ NSHostingView        ← SwiftUI 콘텐츠 (툴바 밑까지 확장)
     └─ NSTitlebarView       ← 툴바 영역 (z-order상 위)
          └─ NSToolbarView
```

`NSHostingView`와 `NSTitlebarView`는 **형제**다. 한쪽이 다른 쪽의 부모가 아니다.

---

## 클릭이 처리되는 순서

[이전 글]({% post_url 2026-11-11-macos-ios-event-handling %})에서 본 흐름을 이번 상황에 필요한 만큼만 다시 적으면 이렇다.

```
NSWindow.sendEvent(mouseDown)
  ① hit-test          NSThemeFrame부터 앞쪽 뷰 순서로 hitTest → 처음 nil이 아닌 뷰가 hit view
  ② 창 드래그 판단      타이틀바 영역이고 hit view가 창 이동을 허용하면 창을 옮김
  ③ 전달              hit view.mouseDown → 처리 안 하면 superview 쪽으로 (responder chain)
```

SwiftUI가 끼면 한 단계가 더 생긴다. AppKit 입장에서 SwiftUI의 `Button`이나 `onTapGesture`는 존재하지 않는다. AppKit의 hit-test는 `NSHostingView`에서 멈추고, 그 안에서 SwiftUI가 **자기 뷰 트리로 hit-test를 다시 하고 제스처 경쟁**을 한다.

```
[AppKit]   hit-test → hit view가 NSHostingView일 때만
[SwiftUI]              → SwiftUI 뷰 트리 hit-test → 제스처 경쟁 → onTapGesture 실행
```

여기서 중요한 조건이 나온다.

**SwiftUI의 `onTapGesture`가 이벤트를 받으려면, AppKit의 hit view가 `NSHostingView`이거나 그 하위 뷰여야 한다.**

- hit view가 `NSHostingView` 하위면, 처리하지 않은 이벤트도 responder chain을 따라 `NSHostingView`로 올라온다.
- hit view가 `NSTitlebarView`면, responder chain은 `NSTitlebarView` → `NSThemeFrame` → `NSWindow`로 올라간다. 형제인 `NSHostingView`는 이 경로에 없다. SwiftUI는 이 클릭을 볼 수 없다.

---

## 원인

### 툴바 밑에 깔린 onTapGesture

세 화면의 본문에서 툴바 아래 영역에 무엇이 깔려 있는지 보면 차이가 드러난다.

LoginScreen이 쓰는 `LoginTextFieldView`:

```swift
ScrollView(showsIndicators: false) { ... }
    .edgesIgnoringSafeArea(.all)      // safe area 무시 → 툴바 밑까지 확장
    .background(Color.bg1)
    .onTapGesture {                   // 확장된 영역 전체가 탭 영역
        hideKeyboard()
    }
```

EmailVerificationScreen:

```swift
var body: some View {
    VStack {
        ...
            .background(Color.bg1)    // Color 배경은 기본적으로 safe area까지 확장
    }
    .onTapGesture {                   // 화면 바깥 컨테이너 전체
        hideKeyboard()
    }
}
```

SelectMFATypeScreen:

```swift
GeometryReader { geo in
    ScrollView(showsIndicators: true) { ... }
}
.background(Color.bg1)
.navBarWithFlag(...)                  // onTapGesture 없음
```

| 화면 | 툴바 밑 콘텐츠 |
|---|---|
| LoginScreen | 탭 제스처 영역 |
| EmailVerificationScreen | 탭 제스처 영역 |
| SelectMFATypeScreen | 스크롤뷰와 배경뿐, 제스처 없음 |

드래그가 안 되는 두 화면에만 툴바 밑까지 덮는 `onTapGesture`가 있다.

### 그런데 탭 제스처는 툴바 클릭을 볼 수 없어야 한다

앞에서 본 조건대로라면 이상하다. 툴바 위를 클릭하면 hit view는 위에 있는 `NSTitlebarView` 쪽이어야 하고, 그러면 형제인 `NSHostingView` 안의 `onTapGesture`는 이 클릭을 볼 수 없다.

탭 제스처가 클릭을 가져갔다면, **hit view가 `NSHostingView` 쪽으로 바뀌어 있었다**는 뜻이다. 그리고 바꾼 것은 `toolbarBackground(Color.navBar)` 한 줄이다.

```
toolbarBackground(Color.navBar)
  → 툴바 쪽 뷰가 hit-test에서 빠지고 hit view가 NSHostingView로 바뀜   (추정)
  → SwiftUI가 이벤트를 받아 onTapGesture가 가져감                       (SwiftUI 처리 규칙)
  → 창 드래그가 일어나지 않음
```

"hit-test가 콘텐츠로 내려간다"와 "탭 제스처가 이벤트를 가져간다"는 서로 다른 설명이 아니다. 앞의 것이 일어나야 뒤의 것이 가능하다.

---

## hit view가 바뀐다고 보는 근거

hit view를 직접 찍어 본 것은 아니다. 관찰한 결과를 위의 규칙에 맞춰 거꾸로 추론했다. 그래서 첫 단계는 추정으로 남겨 둔다.

### 근거 1. 기본 배경에서는 탭 제스처가 있어도 끌린다

`toolbarBackground(Color.navBar)`를 빼면 LoginScreen도 끌린다. 이때도 `onTapGesture`는 툴바 밑에 그대로 깔려 있다.

탭 제스처가 이벤트를 가져가지 못했으니, hit view는 `NSHostingView` 체인 밖이어야 한다.

```
NSWindow
 └─ NSThemeFrame
     ├─ NSHostingView                 ← 체인 밖 → SwiftUI가 클릭을 못 봄
     │    └─ LoginView (.onTapGesture)
     └─ NSTitlebarView
          ├─ 툴바 배경 뷰 (시스템 재질)  ★ hit view
          └─ NSToolbarView
```

기본 배경일 때 hit view는 툴바 쪽 뷰다. 콘텐츠의 제스처가 끼어들 수 없으니 창 이동이 처리된다.

### 근거 2. 커스텀 배경을 넣으면 탭 제스처가 가져간다

같은 화면에서 한 줄만 넣으면 끌리지 않는다. 콘텐츠의 탭 제스처가 클릭을 받았으니, hit view는 `NSHostingView`나 그 하위여야 한다.

```
NSWindow
 └─ NSThemeFrame
     ├─ NSHostingView                 ★ hit view → SwiftUI로 전달
     │    └─ LoginView (.onTapGesture)  ← 이벤트를 가져감 → 드래그 안 됨
     └─ NSTitlebarView                ← hit-test에서 빠짐 (nil 반환)
          ├─ 툴바 배경 (Color.navBar)
          └─ NSToolbarView
```

### 근거 3. 바뀐 건 한 줄뿐이다

근거 1과 2에서 콘텐츠와 제스처는 똑같다. ★의 위치만 다르다.

```
modifier 없음:  NSTitlebarView 쪽 ★  →  SwiftUI가 클릭을 못 봄  →  드래그 됨
modifier 있음:  NSHostingView 쪽 ★   →  onTapGesture가 가져감    →  드래그 안 됨
```

SwiftUI 제스처가 클릭을 받을 수 있는지는 hit view로 정해진다. 결과가 뒤집혔다면, 이 modifier가 그 지점의 hit view를 바꿨다고 보는 게 가장 자연스럽다.

### 근거 4. SelectMFATypeScreen과도 맞는다

```
NSWindow
 └─ NSThemeFrame
     ├─ NSHostingView                 ★ hit view (근거 2와 같음)
     │    └─ SelectMFATypeScreen (ScrollView + 배경, 제스처 없음)
     │         → 가져갈 제스처 없음 → 창 이동 허용 → 드래그 됨
     └─ NSTitlebarView                ← hit-test에서 빠짐
```

hit view는 근거 2와 같은 `NSHostingView`다. 그 지점에 제스처가 없으니 SwiftUI가 창 이동을 막지 않는다. `.hiddenTitleBar` 창에서 툴바가 없어도 상단 빈 곳을 끌면 창이 움직이는 것과 같은 동작이다.

### 확정이 아니라 추정인 이유

- **직접 확인하지 않았다.** 계층도의 ★는 결과에서 거꾸로 추론한 위치다.
- **SwiftUI 제스처가 hit view 규칙을 따른다고 가정했다.** SwiftUI가 제스처를 창 단위로 처리한다면, hit view가 툴바여도 이벤트를 가져갈 수 있다. 다만 그러면 근거 1(기본 배경에서는 끌림)을 설명하기 어렵다.
- **왜 툴바 뷰가 빠지는지는 모른다.** 커스텀 색을 줄 때 SwiftUI가 시스템 배경 뷰를 어떻게 바꾸는지는 공개되지 않았다. 시스템 재질 뷰를 빼고 hit-test에 걸리지 않는 레이어로 색만 칠하는 식일 수 있다. "hit view가 바뀐다"는 결과는 추론할 수 있어도, 왜 바뀌는지는 설명할 수 없다.

---

## 해결

두 화면의 탭 제스처는 모두 `hideKeyboard()`를 부른다.

```swift
extension View {
    func hideKeyboard() {
#if os(iOS)
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
#endif
    }
}
```

구현이 `#if os(iOS)` 안에만 있다. macOS에서는 **아무 일도 하지 않는 제스처가 툴바 밑 클릭만 가로채고 있었다.** 두 곳의 `.onTapGesture`를 지웠다.

```swift
ScrollView(showsIndicators: false) { ... }
    .edgesIgnoringSafeArea(.all)
    .background(Color.bg1)
//    .onTapGesture {
//        hideKeyboard()
//    }
```

이제 툴바 영역에서 hit view가 `NSHostingView`로 바뀌어도 가져갈 제스처가 없다. SelectMFATypeScreen과 같은 상태가 된다.

탭 제스처가 실제로 필요한 화면이라면 지우는 대신 범위를 줄이면 된다.

- `.onTapGesture`를 `.edgesIgnoringSafeArea(.all)`보다 **먼저** 붙여 safe area 안쪽에만 걸리게 한다.
- 배경은 `Color.bg1.ignoresSafeArea()`로 따로 깔고, 제스처는 콘텐츠에만 붙인다.
- 툴바 아이템이나 상단 영역에 `WindowDragGesture()`를 붙여 드래그를 명시적으로 보장한다(macOS 15 이상).

---

## 확인할 것

### hit view 찍어 보기

추정한 첫 단계를 확정하려면, 앱 시작 시점에 Local Monitor를 잠깐 넣고 툴바 빈 곳을 클릭해 hit view를 찍는다.

```swift
NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
    if let frameView = event.window?.contentView?.superview,
       let hit = frameView.hitTest(event.locationInWindow) {
        var chain: [String] = []
        var view: NSView? = hit
        while let current = view {
            chain.append("\(type(of: current)) canMove=\(current.mouseDownCanMoveWindow)")
            view = current.superview
        }
        print(chain.joined(separator: "\n  ↑ "))
    }
    return event
}
```

`contentView.superview`가 `NSThemeFrame`이다. 상위 뷰가 없으므로 `locationInWindow`를 그대로 넘기면 된다.

| `toolbarBackground(Color.navBar)` | 예상 hit view (첫 줄) |
|---|---|
| 없음 | `NSTitlebarView`나 툴바 배경 뷰 |
| 있음 | `NSHostingView` 계열 |

예상대로 나오면 추정이 확인된다. 커스텀 배경을 넣었는데 `NSTitlebarView`가 나오면서도 드래그가 안 된다면, SwiftUI가 제스처를 다른 경로로 받고 있다는 뜻이다. 어느 쪽이든 해결 방향은 같다.

### 같은 패턴의 다른 화면

화면 전체에 `hideKeyboard()` 탭 제스처를 건 곳이 더 있다.

- `OTPCertainTimeVerificationScreen`
- `TerminalApprovalScreen`
- `RequestApprovalScreen`
- `RequestDataFlowMFAEmailScreen`

툴바가 있는 화면이라면 같은 문제가 생길 가능성이 높다. 이 코드를 iOS와 같이 쓴다면 지우는 대신 `#if os(iOS)`로 감싸야 한다.

---

## 정리

- `.hiddenTitleBar` 창에서는 SwiftUI 콘텐츠가 툴바 밑까지 깔린다.
- SwiftUI 제스처는 AppKit의 hit view가 `NSHostingView` 쪽일 때만 클릭을 받는다. 툴바 뷰가 hit view면 형제인 콘텐츠는 클릭을 볼 수 없다.
- `toolbarBackground(Color, for: .windowToolbar)`를 넣으면 툴바 영역의 hit view가 `NSHostingView`로 바뀌는 것으로 보인다(추정).
- 그 위치에 `onTapGesture`가 있으면 제스처가 클릭을 가져가 창 드래그가 일어나지 않는다. 없으면 창 이동이 처리된다.
- 같은 modifier를 써도 화면마다 결과가 달랐던 건, 툴바 밑에 탭 제스처가 있느냐의 차이였다.
