"""
run_logger.py  —  run_daily.bat 실행 로그 기록 헬퍼

배치(run_daily.bat)가 단계 사이에 호출해서, 실행 시작/완료/실패와 총 실행시간을
하나의 로그 파일에 사람이 읽기 좋은 형태로 남긴다.
기존 분석/수집 로직과 완전히 독립적이며, DB나 데이터에 전혀 접근하지 않는다.

[사용법]
  python scripts/run_logger.py start <logfile>
  python scripts/run_logger.py done  <logfile>
  python scripts/run_logger.py fail  <logfile> "<단계명>" "<오류내용>"

start 시 <logfile>.start 에 시작 시각(epoch)을 저장하고, done/fail 시 이를 읽어
총 실행시간을 계산한다.
"""
import os
import sys
import time
from datetime import datetime

LINE = "=" * 48
SUBLINE = "-" * 48


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _marker(logfile: str) -> str:
    return logfile + ".start"


def _ensure_dir(logfile: str) -> None:
    d = os.path.dirname(logfile)
    if d:
        os.makedirs(d, exist_ok=True)


def _append(logfile: str, text: str) -> None:
    _ensure_dir(logfile)
    with open(logfile, "a", encoding="utf-8") as f:
        f.write(text)


def _elapsed(logfile: str):
    try:
        with open(_marker(logfile), encoding="utf-8") as f:
            return time.time() - float(f.read().strip())
    except Exception:
        return None


def _fmt_elapsed(sec: float) -> str:
    return f"{int(sec // 60)}분 {int(sec % 60)}초"


def _guidance(step: str) -> str:
    table = {
        "종목 마스터 갱신": "인터넷 연결을 확인하세요. (이 단계 실패는 치명적이지 않으며 기존 마스터로 계속 진행됩니다)",
        "일봉 갱신": "인터넷 연결 또는 데이터 제공처(네이버/FinanceDataReader) 응답 상태를 확인하세요.",
        "시장 지수": "인터넷 연결 또는 데이터 제공처 응답 상태를 확인하세요.",
        "뉴스 리스크": ".env.local 의 DART_API_KEY 와 인터넷 연결을 확인하세요.",
        "일일 스캔": "Supabase 연결과 .env.local 키를 확인하세요.",
        "주간 스캔": "Supabase 연결과 .env.local 키를 확인하세요.",
    }
    return table.get(step, "로그 위쪽과 콘솔에 표시된 오류 메시지를 확인하세요.")


def main() -> None:
    if len(sys.argv) < 3:
        return
    cmd = sys.argv[1]
    logfile = sys.argv[2]

    if cmd == "start":
        try:
            _ensure_dir(logfile)
            with open(_marker(logfile), "w", encoding="utf-8") as f:
                f.write(str(time.time()))
        except Exception:
            pass
        _append(logfile, f"\n{LINE}\n{_now()}  실행 시작\n{SUBLINE}\n")

    elif cmd == "done":
        sec = _elapsed(logfile)
        block = f"{SUBLINE}\n{_now()}  실행 완료\n"
        if sec is not None:
            block += f"총 실행시간: {_fmt_elapsed(sec)}\n"
        block += f"{LINE}\n"
        _append(logfile, block)

    elif cmd == "fail":
        step = sys.argv[3] if len(sys.argv) > 3 else "?"
        err = sys.argv[4] if len(sys.argv) > 4 else ""
        sec = _elapsed(logfile)
        block = f"{SUBLINE}\n{_now()}  실행 실패\n"
        block += f"실패 단계: {step}\n"
        if err:
            block += f"오류 내용: {err}\n"
        block += f"확인 안내: {_guidance(step)}\n"
        if sec is not None:
            block += f"(경과 시간: {_fmt_elapsed(sec)})\n"
        block += f"{LINE}\n"
        _append(logfile, block)


if __name__ == "__main__":
    main()
