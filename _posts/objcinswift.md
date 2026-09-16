# Swift `@objc` / `#selector` — Objective-C 상호운용 원리

Swift 코드를 Objective-C 런타임(Runtime)과 상호운용(Interop)할 수 있도록 연결하기 위한 장치.

## 1. `@objc`를 붙이는 원리와 헤더 파일

- Objective-C는 컴파일 시점에 헤더 파일(`.h`)만 보고 메서드의 존재를 확인한다.
- Swift는 헤더 파일 없이 모듈 시스템과 메타데이터를 사용한다.
- 그럼에도 Objective-C가 Swift 코드를 인식할 수 있는 이유:

1. **컴파일러의 자동 헤더 생성**: Swift 코드를 빌드할 때 컴파일러는 Objective-C가 읽을 수 있는 숨겨진 호환 헤더 파일(`AppName-Swift.h`)을 자동으로 생성한다.
2. **Objective-C 런타임 등록**: `@objc`를 붙이면 컴파일러는 해당 클래스/메서드/프로퍼티를 이 자동 생성 헤더에 포함시키고, Objective-C 런타임이 접근할 수 있는 '메서드 테이블'에 등록한다.
3. **포워딩 래퍼(Wrapper) 생성**: Objective-C는 메시지 전달(Message Passing) 방식으로 작동한다. `@objc` 메서드가 호출되면, 내부적으로 Objective-C의 메시지를 Swift의 실제 구현체 호출로 전환해주는 내부 래퍼 함수가 실행된다.

즉, `@objc`는 "이 Swift 코드를 Objective-C 스타일의 헤더와 런타임 데이터 구조로 변환해라"라는 컴파일러 지시어다.

## 2. `#selector`를 쓰는 이유

- Objective-C에서는 메서드 이름 자체를 하나의 식별자(셀렉터, Selector)로 사용하며, 내부적으로 텍스트(문자열) 형태로 등록·관리된다.
- 과거에는 `@selector(myMethod)` 또는 `Selector("myMethod")`처럼 문자열을 직접 썼는데, 오타가 나면 컴파일러가 잡지 못하고 런타임에 크래시로 이어졌다.
- `#selector(myMethod)`를 쓰면 컴파일러가 해당 메서드가 실제로 존재하고 `@objc`로 노출되어 있는지 검사한다. 오타가 있거나 `@objc`가 없으면 컴파일 에러로 방지된다.

## 3. 동작 원리 비교

| 구분 | Swift 고유 방식 | Objective-C 호환 방식 (`@objc`, `#selector`) |
|---|---|---|
| 메서드 찾기 | 컴파일 시점에 주소 결정(VTable) 또는 가벼운 탐색 | 런타임에 문자열(Selector) 기반 동적 탐색 |
| 호출 방식 | 직접 호출 (빠름) | 메시지 전달 (Message Passing, 유연함) |
| 주요 용도 | 순수 Swift 앱 로직 | `Timer`, `NSNotificationCenter`, UIKit 이벤트 핸들링 등 |

## 결론

`Timer`나 `UIButton`의 타겟-액션 패턴처럼, iOS 프레임워크 내부(Objective-C 기반 코드)에서 내 Swift 메서드를 호출해야 할 때 그 교량 역할을 하기 위해 `@objc`와 `#selector`를 사용한다.
