"""
load_kospi_all.py
코스피 전체 보통주(우선주/ETF/ETN/리츠/스팩 제외)에 대해
stocks + daily_prices 를 일괄 적재한다.

[옵션]
  --stocks-only      stocks만 적재 (테이블 마스터 갱신만)
  --prices-only      daily_prices만 적재 (이미 stocks 있을 때)
  --limit N          처음 N개만 (테스트용)
  --start-from TICKER  특정 ticker부터 재개 (중간에 끊겼을 때)
  --sleep S          종목 사이 sleep 초 (기본 0.3)

[예시]
  python scripts/load_kospi_all.py                   # 전체
  python scripts/load_kospi_all.py --limit 30        # 처음 30개만
  python scripts/load_kospi_all.py --stocks-only     # 종목 마스터만
  python scripts/load_kospi_all.py --start-from 005930  # 005930부터
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
from pykrx import stock

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


def upsert(table: str, rows: list[dict]) -> None:
    """REST API UPSERT. 큰 배치는 500개씩 분할."""
    if not rows:
        return
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = requests.post(
            f"{REST_URL}/{table}", headers=HEADERS, json=chunk, timeout=120
        )
        if not r.ok:
            raise RuntimeError(
                f"{table} upsert 실패 ({r.status_code}): {r.text[:300]}"
            )


# ── 필터: 우선주, 리츠/스팩 ──────────────────────────────────────
def is_preferred_by_name(name: str) -> bool:
    """이름 끝이 '우', '우B', '1우' 등인 경우 우선주로 판단."""
    suffixes = ('우', '우B', '우C', '1우', '2우', '3우', '1우B', '2우B')
    return name.endswith(suffixes)


def is_unusual_class(name: str) -> bool:
    """리츠/스팩 등 비주류."""
    keywords = ['리츠', '스팩', 'SPAC']
    return any(kw in name for kw in keywords)


# ── 종목 목록 준비 ───────────────────────────────────────────────
def fetch_kospi_universe(date_str: str) -> list[dict]:
    """코스피 보통주 목록 (ticker, name, market_cap)."""
    print(f"[1/3] 코스피 종목 목록 가져오는 중…")
    all_tickers = stock.get_market_ticker_list(date_str, market='KOSPI')
    print(f"      코스피 전체: {len(all_tickers)}개")

    etfs = set(stock.get_etf_ticker_list(date_str))
    etns = set(stock.get_etn_ticker_list(date_str))
    print(f"      ETF: {len(etfs)}개, ETN: {len(etns)}개 (제외)")

    # 시가총액 일괄 조회
    print("      시가총액 데이터 로드 중…")
    df_cap = stock.get_market_cap_by_ticker(date_str, market='KOSPI')

    result: list[dict] = []
    n_excl_etfetn = n_excl_pref = n_excl_unusual = n_excl_noname = 0
    for ticker in all_tickers:
        if ticker in etfs or ticker in etns:
            n_excl_etfetn += 1
            continue
        try:
            name = stock.get_market_ticker_name(ticker)
        except Exception:
            n_excl_noname += 1
            continue
        if not name:
            n_excl_noname += 1
            continue
        if is_preferred_by_name(name):
            n_excl_pref += 1
            continue
        if is_unusual_class(name):
            n_excl_unusual += 1
            continue

        market_cap = None
        if ticker in df_cap.index:
            mc = df_cap.loc[ticker, '시가총액']
            if pd.notna(mc):
                market_cap = int(mc)

        result.append({
            'ticker': ticker,
            'name': name,
            'market': 'KOSPI',
            'market_cap': market_cap,
        })

    print(f"      ETF/ETN 제외 {n_excl_etfetn}, 우선주 {n_excl_pref}, "
          f"리츠/스팩 {n_excl_unusual}, 이름누락 {n_excl_noname}")
    print(f"      최종 보통주: {len(result)}개\n")
    return result


# ── stocks 일괄 적재 ─────────────────────────────────────────────
def load_stocks(universe: list[dict]) -> None:
    print(f"[2/3] stocks 테이블 일괄 적재…")
    rows = [
        {
            'ticker': u['ticker'],
            'name': u['name'],
            'market': u['market'],
            'market_cap': u['market_cap'],
        }
        for u in universe
    ]
    upsert('stocks', rows)
    print(f"      ✓ {len(rows)}개 종목 적재 완료\n")


# ── 일봉 적재 ────────────────────────────────────────────────────
def _to_int(v):
    if v is None or pd.isna(v):
        return None
    return int(v)


def fetch_one_ticker(ticker: str, start: str, end: str) -> list[dict]:
    df = stock.get_market_ohlcv_by_date(start, end, ticker)
    if df is None or df.empty:
        return []
    rows: list[dict] = []
    for date, row in df.iterrows():
        close = row.get("종가")
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
            "trade_value": _to_int(row.get("거래대금")),
        })
    return rows


def load_prices(universe: list[dict], start: str, end: str, sleep_sec: float = 0.3) -> None:
    print(f"[3/3] daily_prices 일괄 적재 (종목간 sleep {sleep_sec}초)…")
    n_total = len(universe)
    n_ok = n_fail = n_empty = 0
    total_rows = 0
    started = time.time()

    for i, u in enumerate(universe, start=1):
        ticker, name = u['ticker'], u['name']
        try:
            rows = fetch_one_ticker(ticker, start, end)
            if not rows:
                n_empty += 1
            else:
                upsert('daily_prices', rows)
                total_rows += len(rows)
                n_ok += 1
                time.sleep(sleep_sec)
        except Exception as e:
            n_fail += 1
            print(f"      [{i}/{n_total}] {ticker} {name} ⚠️ {str(e)[:80]}")
            time.sleep(1.0)
            continue

        # 진행상황 (20개마다 또는 마지막)
        if i % 20 == 0 or i == n_total:
            elapsed = time.time() - started
            eta = elapsed / i * (n_total - i) if i < n_total else 0
            print(f"      [{i}/{n_total}] {ticker} {name[:12]:<12s} "
                  f"누적 {total_rows:>6}행, eta {int(eta // 60):>2}분 {int(eta % 60):>2}초")

    elapsed = time.time() - started
    print(f"\n      ✓ 적재 {n_ok} / 데이터없음 {n_empty} / 실패 {n_fail}")
    print(f"      ✓ 총 {total_rows}건, 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초")


# ── 메인 ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='코스피 전 종목 일괄 적재')
    parser.add_argument('--stocks-only', action='store_true', help='stocks만 적재')
    parser.add_argument('--prices-only', action='store_true', help='daily_prices만 적재')
    parser.add_argument('--limit', type=int, default=0, help='처음 N개만')
    parser.add_argument('--start-from', type=str, default=None, help='특정 ticker부터')
    parser.add_argument('--sleep', type=float, default=0.3, help='종목간 sleep 초')
    args = parser.parse_args()

    today = datetime.today()
    # 주말 보정: KRX 데이터는 평일만 있음 → 토/일이면 금요일로
    while today.weekday() >= 5:
        today -= timedelta(days=1)
    today_str = today.strftime('%Y%m%d')
    start_dt = today - timedelta(days=400)
    start_str = start_dt.strftime('%Y%m%d')

    print(f"기간: {start_str} ~ {today_str}\n")
    overall_start = time.time()

    universe = fetch_kospi_universe(today_str)

    # 옵션 적용
    if args.start_from:
        idx = next((i for i, u in enumerate(universe) if u['ticker'] == args.start_from), -1)
        if idx >= 0:
            universe = universe[idx:]
            print(f"--start-from {args.start_from}: {idx} 건너뜀, {len(universe)}개 남음\n")
        else:
            print(f"--start-from {args.start_from} 못 찾음. 전체 진행.\n")
    if args.limit:
        universe = universe[:args.limit]
        print(f"--limit {args.limit}: 처음 {len(universe)}개만\n")

    if not args.prices_only:
        load_stocks(universe)
    if not args.stocks_only:
        load_prices(universe, start_str, today_str, sleep_sec=args.sleep)

    overall = time.time() - overall_start
    print(f"\n전체 소요시간: {int(overall // 60)}분 {int(overall % 60)}초")


if __name__ == '__main__':
    main()