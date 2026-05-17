"""
load_indices.py
KOSPI/KOSDAQ 지수 일봉을 FinanceDataReader로 가져와 market_indices 테이블에 적재.

매일 갱신용으로 가볍게 동작 (지수당 1년 약 247행, 두 개 합쳐 500행 이하).
종목 일봉 적재와는 별개로, 시장 상태 판정(강세/중립/약세) 및 점수 보정에 사용된다.

[옵션]
  --days N    가져올 기간 (기본 400일, 약 1년 + 휴장 여유)

[예시]
  python scripts/load_indices.py
"""
import argparse
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv
import FinanceDataReader as fdr

# ── 환경변수 로드 ───────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어있습니다.")

REST_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

# ── 지수 매핑 ────────────────────────────────────────────────────
# (DB에 저장될 이름, FinanceDataReader 심볼)
# fdr 심볼: KS11=KOSPI 종합, KQ11=KOSDAQ 종합
INDEX_MAP = [
    ("KOSPI",  "KS11"),
    ("KOSDAQ", "KQ11"),
]


def upsert(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = requests.post(
            f"{REST_URL}/{table}", headers=HEADERS, json=chunk, timeout=60
        )
        if not r.ok:
            raise RuntimeError(
                f"{table} upsert 실패 ({r.status_code}): {r.text[:300]}"
            )


def _to_float(v):
    if v is None or pd.isna(v):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _to_int(v):
    if v is None or pd.isna(v):
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def fetch_index(symbol: str, start: str, end: str) -> pd.DataFrame:
    """FinanceDataReader 로 지수 일봉 가져오기.
    반환: DataFrame (index=Date, columns=Open/High/Low/Close/Volume/Change)
    Change는 등락률(소수, 0.01 = 1%)."""
    df = fdr.DataReader(symbol, start, end)
    return df


def main():
    parser = argparse.ArgumentParser(description='KOSPI/KOSDAQ 지수 일봉 적재')
    parser.add_argument('--days', type=int, default=400,
                        help='가져올 기간 일수 (기본 400)')
    args = parser.parse_args()

    today = datetime.today()
    # 주말 보정
    while today.weekday() >= 5:
        today -= timedelta(days=1)
    end_str = today.strftime('%Y-%m-%d')
    start_str = (today - timedelta(days=args.days)).strftime('%Y-%m-%d')
    print(f"기간: {start_str} ~ {end_str}\n")

    total_rows = 0
    started = time.time()
    for index_name, symbol in INDEX_MAP:
        print(f"[{index_name}] 가져오는 중 ({symbol})…")
        try:
            df = fetch_index(symbol, start_str, end_str)
        except Exception as e:
            print(f"  ⚠️ {index_name} 조회 실패: {str(e)[:120]}")
            continue
        if df is None or df.empty:
            print(f"  ⚠️ {index_name} 데이터 없음")
            continue

        rows = []
        for date, row in df.iterrows():
            close = row.get('Close')
            if close is None or pd.isna(close) or close == 0:
                continue
            # 등락률(Change)이 소수면 백분율로 변환
            change = _to_float(row.get('Change'))
            if change is not None and abs(change) < 1:
                change = change * 100
            rows.append({
                'date':        pd.Timestamp(date).strftime('%Y-%m-%d'),
                'index_name':  index_name,
                'open':        _to_float(row.get('Open')),
                'high':        _to_float(row.get('High')),
                'low':         _to_float(row.get('Low')),
                'close':       float(close),
                'change_pct':  change,
                'volume':      _to_int(row.get('Volume')),
            })
        upsert('market_indices', rows)
        total_rows += len(rows)
        print(f"  ✓ {len(rows)}일 적재")

    elapsed = time.time() - started
    print(f"\n✓ 완료. 총 {total_rows}행, 소요 {int(elapsed)}초")


if __name__ == "__main__":
    main()
