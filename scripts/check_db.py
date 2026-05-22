"""
check_db.py  —  DB 점검 (읽기 전용 / READ-ONLY)

Supabase에 실제로 테이블이 만들어져 있고 데이터가 들어 있는지 한눈에 확인한다.
- 절대 데이터를 쓰거나 바꾸지 않는다. 오직 조회(GET)만 한다.
- run_scan.py 와 똑같은 방식으로 .env.local 을 읽고 service role 키로 접속한다.

[실행]
  Windows :  .venv\\Scripts\\python.exe scripts\\check_db.py
  기타 OS :  python scripts/check_db.py

[읽는 법]
  ✅ = 테이블 있고 데이터 있음   ⚠️ = 테이블은 있는데 비어 있음   ❌ = 테이블 없음/오류
"""
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── 환경변수 로드 (run_scan.py 와 동일) ─────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어있습니다. .env.local 을 확인하세요.")

REST_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

# 점검할 테이블과, 신선도(최신 데이터) 표시에 쓸 날짜 컬럼
#   (table, 최신날짜컬럼 or None)
TABLES = [
    ("stocks",            None),
    ("daily_prices",      "date"),
    ("market_indices",    "date"),
    ("news_risks",        "latest_date"),
    ("financials",        "fiscal_year"),
    ("reports",           "base_date"),
    ("scan_results",      None),
    ("backtest_results",  "base_date"),
    ("stock_notes",       None),
    ("alerts",            "created_at"),
]


def get_count(table: str):
    """테이블의 정확한 행 수를 반환. (count, error_message) 형태."""
    try:
        r = requests.get(
            f"{REST_URL}/{table}",
            headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"},
            params={"select": "*"},
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        return None, f"연결 실패: {e}"

    if r.status_code in (404, 400):
        # 테이블이 없을 때 PostgREST 는 보통 404/400 + 메시지를 준다
        msg = ""
        try:
            msg = r.json().get("message", "")
        except Exception:
            msg = r.text[:120]
        return None, f"테이블 없음/오류 (HTTP {r.status_code}) {msg}"
    if r.status_code not in (200, 206):
        return None, f"HTTP {r.status_code}: {r.text[:120]}"

    # Content-Range: 0-0/1234  → 마지막 슬래시 뒤가 총 행 수
    cr = r.headers.get("content-range", "")
    if "/" in cr:
        total = cr.split("/")[-1]
        if total in ("*", ""):
            return 0, None
        try:
            return int(total), None
        except ValueError:
            return None, f"행 수 파싱 실패: {cr}"
    return None, "행 수를 알 수 없음(content-range 없음)"


def get_latest(table: str, col: str):
    """해당 컬럼 기준 가장 최근 1행의 값을 반환(신선도 표시용)."""
    try:
        r = requests.get(
            f"{REST_URL}/{table}",
            headers=HEADERS,
            params={"select": col, "order": f"{col}.desc", "limit": "1"},
            timeout=30,
        )
        if r.status_code in (200, 206):
            data = r.json()
            if data:
                return str(data[0].get(col))
    except requests.exceptions.RequestException:
        pass
    return None


def get_unread_alerts():
    cnt, err = None, None
    try:
        r = requests.get(
            f"{REST_URL}/alerts",
            headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"},
            params={"select": "id", "is_read": "eq.false"},
            timeout=30,
        )
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            cnt = int(cr.split("/")[-1])
    except Exception:
        pass
    return cnt


def main():
    host = SUPABASE_URL.replace("https://", "").replace("http://", "")
    print("=" * 60)
    print(" U-Turn Scanner · DB 점검 (읽기 전용)")
    print(f" 연결 대상: {host}")
    print("=" * 60)

    # 연결 자체 확인 (stocks 로)
    first_count, first_err = get_count("stocks")
    if first_err and "연결 실패" in first_err:
        print(f"\n❌ Supabase 에 연결하지 못했습니다.\n   {first_err}")
        print("   → .env.local 의 SUPABASE_URL / 키, 인터넷 연결을 확인하세요.")
        sys.exit(1)

    print(f"\n{'테이블':<20}{'상태':<6}{'행 수':>14}   최신 데이터")
    print("-" * 60)

    summary = {"ok": 0, "empty": 0, "missing": 0}
    for table, date_col in TABLES:
        count, err = get_count(table)
        if err:
            print(f"{table:<20}{'❌':<5}{'-':>14}   {err}")
            summary["missing"] += 1
            continue

        if count == 0:
            print(f"{table:<20}{'⚠️':<5}{'0':>14}   (비어 있음)")
            summary["empty"] += 1
            continue

        # 신선도 정보
        extra = ""
        if date_col:
            latest = get_latest(table, date_col)
            if latest:
                extra = f"최신 {date_col}={latest}"
        if table == "alerts":
            unread = get_unread_alerts()
            if unread is not None:
                extra += f"  / 안 읽음 {unread}건"

        print(f"{table:<20}{'✅':<5}{count:>14,}   {extra}")
        summary["ok"] += 1

    print("-" * 60)
    print(f"요약: 정상 {summary['ok']}개 / 비어있음 {summary['empty']}개 / 없음·오류 {summary['missing']}개")

    # ── 결론 ──
    print()
    if summary["missing"] > 0:
        print("결론: ❌ 일부 테이블이 없습니다.")
        print("      docs/DB_SCHEMA.md 를 보고 Supabase SQL 에디터에서 누락 테이블을 만든 뒤")
        print("      README 3장 '최초 데이터 적재' 순서대로 채우세요.")
    elif summary["ok"] == 0:
        print("결론: ⚠️ 테이블은 있으나 데이터가 전혀 없습니다.")
        print("      README 3장 '최초 데이터 적재'를 한 번 실행하세요.")
    elif summary["empty"] > 0:
        print("결론: 🟡 대부분 정상이나 일부 테이블이 비어 있습니다.")
        print("      비어 있는 테이블에 해당하는 적재 스크립트를 실행하세요.")
        print("      (예: reports/scan_results 비었으면 run_scan.py, financials 비었으면 load_financials.py)")
    else:
        print("결론: ✅ 모든 테이블에 데이터가 있습니다. 웹앱(npm run dev)에서 정상 표시될 상태입니다.")


if __name__ == "__main__":
    main()
