"""
load_prices.py
관심종목 20개의 1년치 KRX 정규장 일봉을 pykrx로 받아 Supabase에 적재한다.
Supabase REST API를 requests로 직접 호출하므로 새 형식(sb_secret_) 키와 호환.

[실행 흐름]
  1) stocks 테이블에 (ticker, name, market) UPSERT
  2) 종목별로 일봉을 받아 daily_prices에 UPSERT (PK: ticker, date)
"""
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv
from pykrx import stock

# ── 환경변수 로드 ───────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit(
        "환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어있습니다.\n"
        ".env.local 을 확인하세요."
    )

# Supabase REST API 엔드포인트와 헤더
REST_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    # PK 충돌 시 덮어쓰기 + 응답 본문 최소화
    "Prefer": "resolution=merge-duplicates,return=minimal",
}


def upsert(table: str, rows: list[dict]) -> None:
    """REST API를 통한 UPSERT. 큰 배치는 1000개씩 분할 전송."""
    if not rows:
        return
    CHUNK = 1000
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = requests.post(
            f"{REST_URL}/{table}", headers=HEADERS, json=chunk, timeout=60
        )
        if not r.ok:
            raise RuntimeError(
                f"Supabase {table} upsert 실패 ({r.status_code}): {r.text[:300]}"
            )


# ── 관심종목 20개 (KOSPI 12 + KOSDAQ 8) ─────────────────────────
TICKERS = [
    # KOSPI
    ("005930", "삼성전자",         "KOSPI"),
    ("000660", "SK하이닉스",       "KOSPI"),
    ("035420", "NAVER",            "KOSPI"),
    ("035720", "카카오",            "KOSPI"),
    ("005380", "현대차",            "KOSPI"),
    ("051910", "LG화학",            "KOSPI"),
    ("006400", "삼성SDI",           "KOSPI"),
    ("207940", "삼성바이오로직스",   "KOSPI"),
    ("068270", "셀트리온",          "KOSPI"),
    ("105560", "KB금융",            "KOSPI"),
    ("055550", "신한지주",          "KOSPI"),
    ("028260", "삼성물산",          "KOSPI"),
    # KOSDAQ
    ("247540", "에코프로비엠",      "KOSDAQ"),
    ("086520", "에코프로",          "KOSDAQ"),
    ("196170", "알테오젠",          "KOSDAQ"),
    ("042700", "한미반도체",        "KOSDAQ"),
    ("263750", "펄어비스",          "KOSDAQ"),
    ("293490", "카카오게임즈",      "KOSDAQ"),
    ("067310", "하나마이크론",      "KOSDAQ"),
    ("357780", "솔브레인",          "KOSDAQ"),
]


def upsert_stocks() -> None:
    """stocks 테이블에 20개 종목의 마스터 정보 UPSERT."""
    print("[1/2] stocks 테이블 적재…")
    rows = [{"ticker": t, "name": n, "market": m} for t, n, m in TICKERS]
    upsert("stocks", rows)
    print(f"      ✓ {len(rows)}개 종목 완료\n")


def _to_int(v):
    """None/NaN 안전 변환."""
    if v is None or pd.isna(v):
        return None
    return int(v)


def fetch_one_ticker(ticker: str, start: str, end: str) -> list[dict]:
    """pykrx에서 일봉을 받아 daily_prices 형식의 dict 리스트로 변환.
    pykrx가 공개 모드일 땐 '거래대금' 컬럼이 없을 수 있어 row.get()으로 안전 접근."""
    df = stock.get_market_ohlcv_by_date(start, end, ticker)
    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for date, row in df.iterrows():
        close = row.get("종가")
        # close 없거나 0/NaN이면 건너뜀 (NOT NULL 제약 회피)
        if close is None or pd.isna(close) or close == 0:
            continue
        rows.append({
            "ticker":      ticker,
            "date":        date.strftime("%Y-%m-%d"),
            "open":        _to_int(row.get("시가")),
            "high":        _to_int(row.get("고가")),
            "low":         _to_int(row.get("저가")),
            "close":       int(close),
            "volume":      _to_int(row.get("거래량")),
            "trade_value": _to_int(row.get("거래대금")),  # 공개 모드면 None
        })
    return rows


def upsert_prices_for_ticker(ticker: str, start: str, end: str) -> int:
    """한 종목 일봉을 daily_prices에 UPSERT. 반환: 적재 행 수."""
    rows = fetch_one_ticker(ticker, start, end)
    if not rows:
        return 0
    upsert("daily_prices", rows)
    return len(rows)


def main() -> None:
    today = datetime.today()
    start = today - timedelta(days=400)   # 1년 + 휴장일 여유
    start_str = start.strftime("%Y%m%d")
    end_str   = today.strftime("%Y%m%d")
    print(f"기간: {start_str} ~ {end_str}\n")

    upsert_stocks()

    print("[2/2] daily_prices 테이블 적재…")
    total = 0
    for ticker, name, market in TICKERS:
        try:
            n = upsert_prices_for_ticker(ticker, start_str, end_str)
            print(f"      [{ticker}] {name:<12s} {n:>4}건")
            total += n
            time.sleep(0.3)               # KRX rate limit 회피
        except Exception as e:
            print(f"      [{ticker}] ⚠️ 에러: {e}")
            time.sleep(1.0)

    print(f"\n✅ 완료. 총 {total}건 적재.")


if __name__ == "__main__":
    main()