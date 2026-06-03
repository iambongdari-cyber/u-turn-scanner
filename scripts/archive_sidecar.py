"""
v0.3-6: archive_sidecar.py
사이드카 latest 두 파일을 logs/sidecar/daily/ 에 날짜별 스냅샷으로 복사한다.

- 분석/필터/JSON 구조 변경 0건 (단순 복사 shutil.copy2)
- 한 파일이 실패해도 다른 하나는 계속 시도
- 전체 실패해도 종료 코드 0 (run_daily.bat / run_sidecar.bat 전체 중단 방지)
- 날짜 우선순위:
    1) JSON 내부 base_date
    2) latest 파일의 mtime을 KST로 변환한 날짜
    3) 오늘 KST 날짜
- 같은 날짜 파일이 이미 있으면 덮어쓰기 (하루 N회 실행 시 latest와 일치 보장)

USAGE:
    python scripts/archive_sidecar.py
        → logs/sidecar/daily/scan_dump_YYYY-MM-DD.json
        → logs/sidecar/daily/sector_dump_YYYY-MM-DD.json
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))

ROOT = Path(__file__).resolve().parent.parent
SIDECAR_DIR = ROOT / "logs" / "sidecar"
DAILY_DIR = SIDECAR_DIR / "daily"

SCAN_LATEST = SIDECAR_DIR / "scan_dump_latest.json"
SECTOR_LATEST = SIDECAR_DIR / "sector_dump_latest.json"


def today_kst_str() -> str:
    return datetime.now(tz=KST).strftime("%Y-%m-%d")


def mtime_kst_str(p: Path) -> str | None:
    try:
        return datetime.fromtimestamp(p.stat().st_mtime, tz=KST).strftime("%Y-%m-%d")
    except Exception:
        return None


def extract_base_date(p: Path) -> str | None:
    """JSON 내부 base_date 키를 안전하게 추출. 없으면 None."""
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            bd = d.get("base_date")
            if isinstance(bd, str) and len(bd) >= 10:
                # 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:MM:SS...' 등 모두 앞 10자만 사용
                return bd[:10]
    except Exception:
        pass
    return None


def resolve_date(p: Path, prefer_base_date: bool = True) -> str:
    """
    우선순위:
      1) JSON 내부 base_date (prefer_base_date=True 일 때만)
      2) mtime KST
      3) 오늘 KST
    """
    if prefer_base_date:
        bd = extract_base_date(p)
        if bd:
            return bd
    m = mtime_kst_str(p)
    if m:
        return m
    return today_kst_str()


def archive_one(
    latest_path: Path,
    prefix: str,
    kind_label: str,
    prefer_base_date: bool = True,
) -> bool:
    """
    latest_path → logs/sidecar/daily/<prefix>_<date>.json 으로 복사.
    예외를 절대 raise 하지 않는다. 실패 시 WARN 출력 후 False 반환.
    """
    if not latest_path.exists():
        print(f"[archive_sidecar][WARN] {latest_path.name} missing, skipped")
        return False
    try:
        date_str = resolve_date(latest_path, prefer_base_date=prefer_base_date)
        DAILY_DIR.mkdir(parents=True, exist_ok=True)
        target = DAILY_DIR / f"{prefix}_{date_str}.json"
        # 동일 날짜 파일이 이미 있으면 덮어쓴다 (하루 N회 실행 정책)
        shutil.copy2(latest_path, target)
        try:
            rel = target.relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(target)
        print(f"[archive_sidecar] {kind_label} snapshot saved: {rel}")
        return True
    except Exception as e:
        # 어떤 예외가 나도 전체 batch를 멈추면 안 됨
        print(f"[archive_sidecar][WARN] {kind_label} archive failed: {e}")
        return False


def main() -> int:
    # 두 파일을 독립적으로 시도 — 하나 실패해도 다른 하나는 시도
    archive_one(SCAN_LATEST, "scan_dump", "scan", prefer_base_date=True)
    # sector_dump_latest.json에는 base_date가 없을 수 있으므로 prefer_base_date=True여도
    # 내부에서 fallback으로 mtime KST → 오늘 KST 순으로 안전하게 처리됨.
    archive_one(SECTOR_LATEST, "sector_dump", "sector", prefer_base_date=True)
    print("[archive_sidecar] done")
    # WARN-only 정책: 어떤 경우에도 종료 코드 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
