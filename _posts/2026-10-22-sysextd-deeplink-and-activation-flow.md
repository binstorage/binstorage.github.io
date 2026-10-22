---
layout: post
title: "sysextd 바이너리 리버싱으로 찾은 시스템 확장 프로그램 딥링크 — activation 상태 전이까지"
date: 2026-10-22
categories: [macOS]
description: "시스템 설정의 확장 프로그램 토글 화면을 직접 여는 URL scheme이 없었다. sysextd가 GURL Apple Event로 전달하는 URL을 추적하고, 바이너리에서 포맷 스트링을 추출해 해결했다. 부수적으로 발견한 시스템 익스텐션의 staging → activated_waiting_for_user 상태 전이 흐름도 정리한다."
---

시스템 익스텐션이 비활성화된 상태에서 사용자를 시스템 설정의 확장 프로그램 토글 화면으로 안내해야 했다.
기존 URL scheme(`x-apple.systempreferences:com.apple.LoginItems-Settings.extension`)은 "로그인 항목 및 확장 프로그램" 페이지까지만 열렸고, 앱의 확장 프로그램 토글 화면까지는 도달하지 못했다.

반면 OS가 제공하는 시스템 팝업의 "시스템 설정 열기" 버튼은 정확히 해당 앱의 확장 프로그램 토글까지 열어주었다.
이 차이의 원인을 추적하고 해결한 과정을 정리한다.

---

## 1. 시스템 로그로 두 경로 비교

OS 팝업이 System Settings를 여는 메커니즘을 추적하기 위해 로그를 수집했다.

```bash
log show --last 2m --info --debug \
  --predicate 'subsystem == "com.apple.PreferencePanes" or process == "System Settings"' \
  > ~/Desktop/settings_log.txt
```

로그에서 두 개의 System Settings 세션을 비교했다.

**URL scheme으로 열린 경우:**

```
Switch to com.apple.LoginItems-Settings.extension nil
openWindowSignal: true force:true
```

`nil`이 전달된다. 추가 네비게이션 컨텍스트가 없어서 Login Items 페이지만 열린다.

**OS 시스템 팝업에서 열린 경우:**

```
System_Settings.OpenBundleArguments skipReveal:true
openWindowSignal: false force:true
```

`OpenBundleArguments`로 번들 컨텍스트가 전달되어 GeneralSettings → LoginItems-Settings.extension → 시트(토글 다이얼로그) 순서로 네비게이션된다.

---

## 2. GURL Apple Event 추적

OS 팝업이 어떤 메커니즘으로 System Settings를 여는지 확인하기 위해 `sysextd` 프로세스 로그를 수집했다.

```bash
log stream --predicate 'process == "sysextd" or (process == "System Settings" \
  and eventMessage contains "GURL")' --info --debug --level debug
```

결과, `sysextd`가 **GURL/GURL Apple Event**를 통해 System Settings에 URL을 전달하고 있었다.

```
sysextd: (LaunchServices) LAUNCH: Asking CSUI to launch 1 items
sysextd: (AE) cloneForCompatability(src=<private> dst=...)
System Settings: (AE) RECEIVED:(GURL,GURL) {GURL,GURL target=psn ... returnID=-2776}
```

하지만 실제 URL 내용은 `<private>`으로 마스킹되어 있었다. macOS의 개인정보 보호 정책 때문에 `log` 명령어로는 URL 원문을 볼 수 없다.

---

## 3. sysextd 바이너리에서 URL 포맷 스트링 추출

`<private>` 마스킹을 우회하기 위해 `sysextd` 바이너리에서 직접 문자열을 추출했다.

```bash
strings /System/Library/Frameworks/SystemExtensions.framework/Versions/A/Helpers/sysextd \
  | grep -i "x-apple\|systempreferences\|LoginItems"
```

```
ALERT_OPEN_LOGIN_ITEMS_AND_EXTENSIONS
x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=%@&extensionIdentifier=%@
```

`sysextd`가 내부적으로 `%@` 포맷 스트링에 extension point identifier와 extension identifier를 대입해서 URL을 만들고, 이를 GURL Apple Event로 System Settings에 전달하는 구조였다.

동일 바이너리에서 사용 가능한 extension point identifier 목록도 확인했다.

```bash
strings /System/Library/Frameworks/SystemExtensions.framework/Versions/A/Helpers/sysextd \
  | grep "extension-point"
```

```
com.apple.system_extension.cmio.extension-point          # Camera Extension
com.apple.system_extension.network_extension.extension-point  # Network Extension
com.apple.system_extension.endpoint_security.extension-point  # Endpoint Security
com.apple.system_extension.driver_extension.extension-point   # Driver Extension
```

---

## 4. 최종 URL scheme

```
x-apple.systempreferences:com.apple.ExtensionsPreferences
  ?extensionPointIdentifier={카테고리}
  &extensionIdentifier={확장프로그램 번들ID}
```

Network Extension(Content Filter)의 경우:

```
x-apple.systempreferences:com.apple.ExtensionsPreferences
  ?extensionPointIdentifier=com.apple.system_extension.network_extension.extension-point
  &extensionIdentifier=com.pribit.application.packetgo.switch.sase.ContentFilterData-macOS
```

| 파라미터 | 값 | 설명 |
|---------|---|------|
| `extensionPointIdentifier` | `com.apple.system_extension.network_extension.extension-point` | Network Extension 카테고리 |
| `extensionIdentifier` | `com.pribit.application.packetgo.switch.sase.ContentFilterData-macOS` | 시스템 확장 프로그램 번들 ID |

코드 적용:

```swift
// 변경 전: Login Items 페이지만 열림
if let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension") {
    NSWorkspace.shared.open(url)
}

// 변경 후: 확장 프로그램 토글 화면까지 직접 열림
if let url = URL(string: "x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.system_extension.network_extension.extension-point&extensionIdentifier=com.pribit.application.packetgo.switch.sase.ContentFilterData-macOS") {
    NSWorkspace.shared.open(url)
}
```

이 URL은 Apple이 공식 문서화하지 않은 비공식 API이며, `sysextd` 바이너리 내부에서 사용되는 것으로 확인되었다. OS 업데이트 시 변경될 가능성이 있다.

---

## 5. 시스템 익스텐션 Activation 상태 전이

위 조사 과정에서 `sysextd`의 상태 전이 로그(`[com.apple.sx:StateChange]`)도 함께 수집되었다. `OSSystemExtensionRequest.activationRequest`를 호출했을 때 `sysextd`가 처리하는 전체 흐름을 정리한다.

```
realizing
    │
    ▼
staging                          ← /Library/SystemExtensions/ 에 바이너리 복사
    │
    ▼
validating                       ← 코드 서명(Code Signature) 검증
    │
    ▼
validating_by_category           ← 확장 프로그램 카테고리별 추가 검증
    │
    ▼
activated_waiting_for_user       ← 사용자 승인 대기 (시스템 팝업 표시)
    │
    ▼  (사용자가 시스템 설정에서 토글 활성화)
activated_enabled                ← 확장 프로그램 활성화 완료
```

실제 로그:

```
# 1. 기존 확장 프로그램 제거 (재설치 시)
sysextd: [com.apple.sx:DaemonIPC] dispatchRequest(cmd: uninstall)
sysextd: [com.apple.sx:StateChange] extension 23SZ5X36V2
    com.pribit...ContentFilterData-macOS (1.0/669)
    advancing state from activated_waiting_for_user to uninstalling
sysextd: [com.apple.sx:StateChange]
    ...advancing state from uninstalling to uninstalled

# 2. 새 확장 프로그램 제출
sysextd: [com.apple.sx:DaemonIPC] dispatchRequest(cmd: nsxpc)

# 3. 상태 전이 (sysextd가 자동 처리)
sysextd: [com.apple.sx:StateChange]
    ...advancing state from realizing to staging
sysextd: [com.apple.sx:StateChange]
    ...advancing state from staging to validating
sysextd: [com.apple.sx:StateChange]
    ...advancing state from validating to validating_by_category
sysextd: [com.apple.sx:StateChange]
    ...advancing state from validating_by_category to activated_waiting_for_user

# 4. 시스템 팝업 표시
sysextd: (CoreFoundation) BLOCKED_NETWORK_SYSEXT_ALERT_TITLE
    → '%@'에서 새로운 네트워크 확장 프로그램을 사용하려고 합니다.
sysextd: (CoreFoundation) ALERT_OPEN_LOGIN_ITEMS_AND_EXTENSIONS
    → 시스템 설정 열기

# 5. 사용자가 "시스템 설정 열기" 클릭 시 GURL Apple Event 전송
sysextd: (LaunchServices) LAUNCH: Asking CSUI to launch 1 items
System Settings: (AE) RECEIVED:(GURL,GURL) ...
```

### 각 단계 설명

| 단계 | 상태 | 설명 |
|------|------|------|
| 1 | `realizing` | `sysextd`가 앱 번들 내의 `.systemextension` 위치를 확인 |
| 2 | `staging` | **바이너리를 `/Library/SystemExtensions/`에 복사**. 사용자 승인 전에 이미 복사됨 |
| 3 | `validating` | 코드 서명, Team ID, 엔타이틀먼트 검증 |
| 4 | `validating_by_category` | Network Extension, Endpoint Security 등 카테고리별 추가 검증 |
| 5 | `activated_waiting_for_user` | 검증 완료. 시스템 팝업 표시. 사용자가 시스템 설정에서 토글을 켜야 활성화됨 |
| 6 | `activated_enabled` | 사용자가 토글을 켜서 확장 프로그램이 최종 활성화됨 |

### staging에서 이미 복사됨

사용자가 시스템 설정에서 승인하지 않아도 `staging` 단계에서 확장 프로그램 바이너리는 이미 `/Library/SystemExtensions/`에 복사된다.

```
/Library/SystemExtensions/
└── {UUID}/
    └── com.pribit.application.packetgo.switch.sase.ContentFilterData-macOS.systemextension/
```

이 때문에 `activated_waiting_for_user` 상태에서도 System Settings가 `extensionIdentifier`로 해당 확장 프로그램을 `/Library/SystemExtensions/`에서 찾아 토글 화면을 보여줄 수 있다.

바이너리는 디스크에 존재하지만 네트워크 필터링 등 실제 기능은 동작하지 않는다. 사용자가 시스템 설정에서 토글을 켜야 `activated_enabled`로 전이되며 기능이 활성화된다.

### OSSystemExtensionRequestDelegate 콜백 매핑

| 상태 전이 | Delegate 콜백 |
|----------|--------------|
| `realizing` → `staging` | (내부 처리, 콜백 없음) |
| `staging` → `validating` | (내부 처리, 콜백 없음) |
| `validating_by_category` → `activated_waiting_for_user` | `requestNeedsUserApproval(_:)` |
| 기존 확장 프로그램 존재 시 | `request(_:actionForReplacingExtension:withExtension:)` |
| `activated_enabled` 도달 | `request(_:didFinishWithResult:)` → `.completed` |
| 오류 발생 시 | `request(_:didFailWithError:)` |

---

## 참고

- 딥링크 URL scheme은 Apple이 공식 문서화하지 않은 비공식 API이다.
- `sysextd` 바이너리 내부에서 사용하는 것으로 확인되었으며, OS 업데이트 시 변경될 가능성이 있다.
- Extension Point Identifier는 확장 프로그램 종류에 따라 다르게 지정해야 한다.
- 상태 전이 로그는 `log stream --predicate 'process == "sysextd"' --info --debug`로 확인 가능하다.
