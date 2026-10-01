# codeflowlens (Python)

바이브코딩으로 만든 시스템의 실행 흐름·메서드·엔티티를 시각화하는 모니터링 패키지 — Python 추적기 + 정적 분석기 + CLI.

```bash
pip install codeflowlens
cfl init                      # 프로젝트에 이식 (주석 룰 + 첫 스캔)
cfl run uvicorn main:app      # 코드 수정 0으로 실행 추적
npx @codeflowlens/ui          # 모니터링 화면 (localhost:7411)
```

`cfl`은 `codeflowlens`의 축약 명령입니다 — 어느 쪽을 쳐도 똑같이 동작합니다.

자세한 내용: https://github.com/exceedlimit/codeflowlens
