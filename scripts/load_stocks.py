"""
load_stocks.py
FinanceDataReader 기반 — 코스피/코스닥 종목 + 일봉 일괄 적재.

KRX 직접 접속(pykrx의 ticker_list)이 불안정해서, 네이버 금융을 백엔드로 쓰는
FinanceDataReader 로 종목 목록과 일봉을 모두 가져온다. KRX 점검과 무관하게 동작.

[옵션]
  --market KOSPI|KOSDAQ|ALL   대상 시장 (기본 ALL)
  --stocks-only               stocks 테이블만 적재
  --prices-only               daily_prices만 적재 (이미 stocks 있을 때)
  --limit N                   처음 N개만 (테스트용)
  --start-from TICKER         특정 ticker부터 재개 (중간에 끊겼을 때)
  --sleep S                   종목 사이 sleep 초 (기본 0.2)

[예시]
  python scripts/load_stocks.py --market KOSPI --limit 30   # 코스피 30개 테스트
  python scripts/load_stocks.py --market KOSPI              # 코스피 전체
  python scripts/load_stocks.py --market ALL                # 코스피+코스닥 전체
  python scripts/load_stocks.py --start-from 005930 --prices-only
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


def get_tickers_with_prices() -> set[str]:
    """daily_prices 테이블에 이미 일봉이 들어있는 ticker 집합을 반환.
    --skip-existing 옵션에서 '이미 적재된 종목 건너뛰기'에 사용."""
    print("[확인] 이미 적재된 종목 조회 중…")
    seen: set[str] = set()
    offset = 0
    PAGE = 1000
    while True:
        r = requests.get(
            f"{REST_URL}/daily_prices",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker", "order": "ticker.asc"},
            timeout=120,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        for row in page:
            seen.add(row["ticker"])
        if len(page) < PAGE:
            break
        offset += PAGE
    print(f"       이미 일봉이 있는 종목: {len(seen)}개\n")
    return seen


# ── 필터: 우선주 / 리츠·스팩·ETN / ETF ───────────────────────────
def is_preferred_by_name(name: str) -> bool:
    """이름 끝이 '우', '우B', '1우' 등인 경우 우선주로 판단."""
    suffixes = ('우', '우B', '우C', '1우', '2우', '3우', '1우B', '2우B', '(전환)')
    return name.endswith(suffixes)


def is_unusual_class(name: str) -> bool:
    """리츠/스팩/ETN 등 비주류."""
    keywords = ['리츠', '스팩', 'SPAC', 'ETN']
    return any(kw in name for kw in keywords)


_ETF_PREFIXES = (
    'KODEX', 'TIGER', 'KBSTAR', 'HANARO', 'KOSEF', 'ARIRANG', 'ACE', 'SOL',
    'KIWOOM', 'PLUS', 'KINDEX', 'TIGERS', 'PIONEER', 'BNK', 'TIMEFOLIO',
    'KCGI', 'WOORI', 'TRUSTON', 'MASTER', 'SMART', 'FOCUS', 'HK', 'WON',
    'UNICORN', 'DAISHIN', 'KOACT', 'RISE', '1Q', 'BNKETF', 'ITF',
)


def is_etf_by_name(name: str) -> bool:
    """이름 prefix가 ETF 운용사 브랜드면 ETF로 판단."""
    name_upper = name.upper()
    return any(name_upper.startswith(p) for p in _ETF_PREFIXES)


def _pick_col(cols: list[str], candidates: list[str]) -> str | None:
    """후보 컬럼명 중 실제 존재하는 첫 번째를 반환."""
    for c in candidates:
        if c in cols:
            return c
    return None


# ── 종목 목록 준비 ───────────────────────────────────────────────
def fetch_universe(market: str) -> list[dict]:
    """FinanceDataReader 로 한 시장의 보통주 목록을 가져온다."""
    print(f"[목록] {market} 종목 가져오는 중 (FinanceDataReader)…")
    df = fdr.StockListing(market)
    print(f"       {market} 전체: {len(df)}개")

    cols = df.columns.tolist()
    code_col = _pick_col(cols, ['Code', 'Symbol', 'ticker'])
    name_col = _pick_col(cols, ['Name', 'name'])
    cap_col = _pick_col(cols, ['Marcap', 'MarketCap', 'Market Cap', 'marcap'])

    if not code_col or not name_col:
        sys.exit(f"StockListing 컬럼 인식 실패. 실제 컬럼: {cols}")

    result: list[dict] = []
    n_pref = n_unusual = n_etf = n_bad = 0
    for _, row in df.iterrows():
        raw_code = row.get(code_col)
        if raw_code is None or pd.isna(raw_code):
            n_bad += 1
            continue
        ticker = str(raw_code).strip().zfill(6)
        if len(ticker) != 6 or not ticker.isdigit():
            n_bad += 1
            continue

        raw_name = row.get(name_col)
        name = str(raw_name).strip() if pd.notna(raw_name) else ''
        if not name:
            n_bad += 1
            continue

        if is_preferred_by_name(name):
            n_pref += 1
            continue
        if is_unusual_class(name):
            n_unusual += 1
            continue
        if is_etf_by_name(name):
            n_etf += 1
            continue

        market_cap = None
        if cap_col is not None:
            mc = row.get(cap_col)
            if mc is not None and pd.notna(mc):
                try:
                    market_cap = int(mc)
                except (ValueError, TypeError):
                    market_cap = None

        result.append({
            'ticker': ticker,
            'name': name,
            'market': market,
            'market_cap': market_cap,
        })

    print(f"       우선주 {n_pref}, 리츠/스팩/ETN {n_unusual}, "
          f"ETF {n_etf}, 불량 {n_bad} 제외")
    print(f"       최종 보통주: {len(result)}개\n")
    return result


# ── stocks 일괄 적재 ─────────────────────────────────────────────
def load_stocks(universe: list[dict]) -> None:
    print(f"[stocks] 테이블 일괄 적재…")
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
    print(f"         ✓ {len(rows)}개 종목 적재 완료\n")


# ── 일봉 적재 ────────────────────────────────────────────────────
def _to_int(v):
    if v is None or pd.isna(v):
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def fetch_one_ticker(ticker: str, start: str, end: str) -> list[dict]:
    """FinanceDataReader 로 일봉을 받아 daily_prices 형식의 dict 리스트로 변환.
    fdr.DataReader 컬럼: Open High Low Close Volume Change (거래대금 없음).
    trade_value 는 NULL로 두고, run_scan.py 에서 close*volume 으로 근사한다."""
    df = fdr.DataReader(ticker, start, end)
    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for date, row in df.iterrows():
        close = row.get('Close')
        if close is None or pd.isna(close) or close == 0:
            continue
        rows.append({
            "ticker":      ticker,
            "date":        pd.Timestamp(date).strftime("%Y-%m-%d"),
            "open":        _to_int(row.get('Open')),
            "high":        _to_int(row.get('High')),
            "low":         _to_int(row.get('Low')),
            "close":       int(close),
            "volume":      _to_int(row.get('Volume')),
            "trade_value": None,
        })
    return rows


def load_prices(universe: list[dict], start: str, end: str, sleep_sec: float,
                skip_set: set[str] | None = None) -> None:
    print(f"[일봉] daily_prices 일괄 적재 (종목간 sleep {sleep_sec}초)…")
    n_total = len(universe)
    n_ok = n_fail = n_empty = n_skip = 0
    total_rows = 0
    started = time.time()

    for i, u in enumerate(universe, start=1):
        ticker, name = u['ticker'], u['name']
        # 이미 적재된 종목은 건너뜀
        if skip_set is not None and ticker in skip_set:
            n_skip += 1
            continue
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
            print(f"       [{i}/{n_total}] {ticker} {name} ⚠️ {str(e)[:80]}")
            time.sleep(1.0)
            continue

        if i % 20 == 0 or i == n_total:
            elapsed = time.time() - started
            eta = elapsed / i * (n_total - i) if i < n_total else 0
            print(f"       [{i}/{n_total}] {ticker} {name[:12]:<12s} "
                  f"누적 {total_rows:>7}행, eta {int(eta // 60):>2}분 {int(eta % 60):>2}초")

    elapsed = time.time() - started
    print(f"\n       ✓ 적재 {n_ok} / 데이터없음 {n_empty} / 실패 {n_fail} / 건너뜀 {n_skip}")
    print(f"       ✓ 총 {total_rows}건, 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초")


# ── 메인 ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='코스피/코스닥 종목 일괄 적재 (FinanceDataReader)')
    parser.add_argument('--market', choices=['KOSPI', 'KOSDAQ', 'ALL'],
                        default='ALL', help='대상 시장 (기본 ALL)')
    parser.add_argument('--stocks-only', action='store_true', help='stocks만 적재')
    parser.add_argument('--prices-only', action='store_true', help='daily_prices만 적재')
    parser.add_argument('--limit', type=int, default=0, help='처음 N개만')
    parser.add_argument('--start-from', type=str, default=None, help='특정 ticker부터')
    parser.add_argument('--sleep', type=float, default=0.2, help='종목간 sleep 초')
    parser.add_argument('--skip-existing', action='store_true',
                        help='daily_prices에 이미 일봉이 있는 종목은 건너뜀')
    args = parser.parse_args()

    today = datetime.today()
    # 주말 보정 (네이버 데이터도 평일 기준)
    while today.weekday() >= 5:
        today -= timedelta(days=1)
    end_str = today.strftime('%Y-%m-%d')
    start_str = (today - timedelta(days=400)).strftime('%Y-%m-%d')

    print(f"기간: {start_str} ~ {end_str}\n")
    overall_start = time.time()

    # 종목 목록 수집
    markets = ['KOSPI', 'KOSDAQ'] if args.market == 'ALL' else [args.market]
    universe: list[dict] = []
    for m in markets:
        universe.extend(fetch_universe(m))
    print(f"[합계] 전체 보통주 {len(universe)}개\n")

    # 옵션 적용
    if args.start_from:
        idx = next((i for i, u in enumerate(universe)
                    if u['ticker'] == args.start_from), -1)
        if idx >= 0:
            universe = universe[idx:]
            print(f"--start-from {args.start_from}: {idx}개 건너뜀, {len(universe)}개 남음\n")
        else:
            print(f"--start-from {args.start_from} 못 찾음. 전체 진행.\n")
    if args.limit:
        universe = universe[:args.limit]
        print(f"--limit {args.limit}: 처음 {len(universe)}개만\n")

    if not args.prices_only:
        load_stocks(universe)
    if not args.stocks_only:
        skip_set = get_tickers_with_prices() if args.skip_existing else None
        load_prices(universe, start_str, end_str, sleep_sec=args.sleep,
                    skip_set=skip_set)

    overall = time.time() - overall_start
    print(f"\n전체 소요시간: {int(overall // 60)}분 {int(overall % 60)}초")


if __name__ == '__main__':
    main()
