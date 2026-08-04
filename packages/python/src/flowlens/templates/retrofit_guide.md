# FlowLens 주석 소급 작업지시서

이 프로젝트에 FlowLens가 설치되었습니다. 기존 코드에는 아직 비즈니스 주석이 없을 수 있습니다.
이 문서는 **코딩 에이전트(Claude Code, Cursor 등)에게 소급 작업을 시키는 방법**입니다.

## 에이전트에게 시키는 법

Claude Code라면:

```
flowlens-retrofit 스킬로 주석 소급 작업을 해줘
```

스킬이 없는 에이전트라면 아래를 복사해 붙이세요:

```
flowlens check --json을 실행해서 나온 violations 목록의 각 대상에 대해,
코드를 읽고 의미를 이해한 뒤 AGENTS.md의 "FlowLens 주석 룰" 형식(개요/로직/참고/파라미터)으로
docstring/JSDoc을 채워줘. 코드 로직은 바꾸지 말고, 비즈니스 관점으로 써줘.
다 되면 flowlens check가 통과하는지 확인하고 flowlens scan을 실행해줘.
```

## 사람이 직접 확인할 것

- 작업 후 `flowlens check` 통과 여부
- 주석이 실제 비즈니스 의미와 맞는지 샘플 확인 (에이전트가 추측으로 쓴 것이 없는지)
- `flowlens scan` 후 UI(관계도/트레이스 상세)에서 설명이 보이는지
