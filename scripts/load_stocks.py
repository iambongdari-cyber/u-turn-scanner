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
  --skip-existing             daily_prices에 이미 일봉이 있는 종목은 건너뜀 (초기 적재 재개용)
  --days N                    최근 N일치(달력일)만 받기. 0이면 기본 400일치
  --min-cap N                 일봉 수집 단계에서 시가총액 N억 미만 종목 제외
                              (NULL·관심종목은 제외하지 않음. 0이면 필터 끄기 = 전체 수집)
  --gap-fill                  종목별 DB 마지막 저장일 다음부터 오늘까지만 자동 수집
                              (이미 데이터 있는 종목=증분, 데이터 없는 신규=초기 400일)
  --workers N                 동시 수집 스레드 수 (기본 1 = 순차/기존 동작). 2 이상이면 병렬 수집
  --log-file PATH             수집 통계(기존/제외/실제/관심종목 예외)를 로그 파일에 기록

[예시]
  python scripts/load_stocks.py --market KOSPI --limit 30          # 코스피 30개 테스트
  python scripts/load_stocks.py --market ALL                       # 코스피+코스닥 전체
  python scripts/load_stocks.py --prices-only --gap-fill --min-cap 800 --workers 8   # 매일 갱신(최적화)
  python scripts/load_stocks.py --start-from 005930 --prices-only
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    --skip-existing(건너뛰기) 및 --gap-fill(증분/초기 구분)에서 사용."""
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


# ── 수집 대상 축소 / 빈틈 방지 헬퍼 ──────────────────────────────
def fetch_market_caps() -> dict[str, int | None]:
    """stocks 테이블에서 {ticker: market_cap} 조회.
    스캔(run_scan.py)과 '동일한 출처'를 써서 필터 기준을 일치시킨다."""
    caps: dict[str, int | None] = {}
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker,market_cap", "order": "ticker.asc"},
            timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        for row in page:
            caps[row["ticker"]] = row.get("market_cap")
        if len(page) < PAGE:
            break
        offset += PAGE
    return caps


def fetch_watchlist_tickers() -> set[str]:
    """stock_notes(사용자 메모)에 등록된 관심종목 ticker 집합.
    시가총액과 무관하게 무조건 일봉 수집을 보장하기 위함."""
    seen: set[str] = set()
    offset, PAGE = 0, 1000
    while True:
        try:
            r = requests.get(
                f"{REST_URL}/stock_notes",
                headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
                params={"select": "ticker"},
                timeout=60,
            )
        except requests.exceptions.RequestException:
            break
        if r.status_code not in (200, 206):
            break
        page = r.json()
        if not page:
            break
        for row in page:
            t = row.get("ticker")
            if t:
                seen.add(t)
        if len(page) < PAGE:
            break
        offset += PAGE
    return seen


def get_global_last_price_date() -> str | None:
    """daily_prices에서 가장 최근 거래일(YYYY-MM-DD) 1건. 데이터 없으면 None."""
    try:
        r = requests.get(
            f"{REST_URL}/daily_prices",
            headers=HEADERS,
            params={"select": "date", "order": "date.desc", "limit": "1"},
            timeout=30,
        )
        if r.status_code in (200, 206):
            data = r.json()
            if data:
                return data[0]["date"]
    except requests.exceptions.RequestException:
        pass
    return None


def compute_incremental_start(today: datetime, fallback_start: str) -> str:
    """이미 데이터가 있는 종목의 증분 수집 시작일.
    DB의 마지막 거래일 기준으로 (간격 + 안전마진 5일), 최소 15일치를 받는다.
    데이터가 전무하면 fallback(기본 폭) 사용."""
    last = get_global_last_price_date()
    if not last:
        return fallback_start
    try:
        last_d = datetime.strptime(last, "%Y-%m-%d")
    except ValueError:
        return fallback_start
    gap_days = (today - last_d).days
    inc_days = max(gap_days + 5, 15)
    return (today - timedelta(days=inc_days)).strftime("%Y-%m-%d")


def _append_log(path: str, text: str) -> None:
    """로그 파일에 한 블록 append (실패해도 본 작업에 영향 없음)."""
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass


def apply_market_cap_filter(universe: list[dict], min_cap_eok: int,
                            log_file: str | None = None) -> list[dict]:
    """일봉 수집 대상에서 시가총액 미달 종목 제외.
    - 시총 출처: stocks 테이블 (스캔과 동일)
    - NULL(시총 정보 없음/불확실) → 제외하지 않고 수집 (안전)
    - 관심종목(stock_notes) → 시총과 무관하게 수집
    - DB의 stocks/일봉 데이터는 전혀 건드리지 않음 (수집 '대상'만 줄임)
    """
    threshold = min_cap_eok * 10**8
    caps = fetch_market_caps()
    watch = fetch_watchlist_tickers()

    n_before = len(universe)
    kept: list[dict] = []
    n_excluded = 0
    n_watch_exempt = 0

    for u in universe:
        t = u["ticker"]
        cap = caps.get(t)
        below = (cap is not None) and (cap < threshold)
        if t in watch:
            kept.append(u)
            if below:
                n_watch_exempt += 1
            continue
        if below:
            n_excluded += 1
            continue
        kept.append(u)  # NULL(정보없음) 또는 시총 임계 이상 → 수집

    print(f"[시총필터] 기준 {min_cap_eok}억 · 기존 {n_before} → 수집대상 {len(kept)} "
          f"(시총미달 제외 {n_excluded}, 관심종목 예외 {n_watch_exempt}, NULL·임계이상 유지)")

    if log_file:
        _append_log(
            log_file,
            "[일봉 수집 대상]\n"
            f"    - 기존 수집 대상: {n_before}\n"
            f"    - 시총({min_cap_eok}억) 미달 제외: {n_excluded}\n"
            f"    - 실제 수집 대상: {len(kept)}\n"
            f"    - 관심종목 예외 수집: {n_watch_exempt}",
        )
    return kept


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


def _fetch_and_store(u: dict, start: str, end: str, sleep_sec: float) -> tuple:
    """단일 종목: 수집 → 적재. (status, n_rows, ticker, name, err) 반환.
    병렬/순차 양쪽에서 동일하게 사용. 데이터 형식은 fetch_one_ticker 그대로(불변)."""
    ticker, name = u['ticker'], u['name']
    try:
        rows = fetch_one_ticker(ticker, start, end)
        if not rows:
            return ('empty', 0, ticker, name, None)
        upsert('daily_prices', rows)
        if sleep_sec:
            time.sleep(sleep_sec)
        return ('ok', len(rows), ticker, name, None)
    except Exception as e:
        time.sleep(1.0)
        return ('fail', 0, ticker, name, str(e)[:80])


def load_prices(universe: list[dict], start: str, end: str, sleep_sec: float,
                skip_set: set[str] | None = None,
                gap_fill: bool = False, existing_set: set[str] | None = None,
                incremental_start: str | None = None,
                initial_start: str | None = None,
                workers: int = 1) -> None:
    """일봉 적재.
    - 기본(gap_fill=False): 모든 종목을 start~end 로 수집 (기존 동작 그대로).
    - gap_fill=True: 종목별로 시작일을 다르게 → 이미 데이터 있으면 incremental_start,
      신규(데이터 없음)면 initial_start 부터. 중복은 UPSERT(merge-duplicates)로 자동 제거.
    - workers>=2: ThreadPoolExecutor로 동시 수집(데이터/결과는 순차와 동일, 속도만 향상).
    """
    mode = "gap-fill" if gap_fill else "full"
    work = [u for u in universe
            if not (skip_set is not None and u['ticker'] in skip_set)]
    n_skip = len(universe) - len(work)
    n_total = len(work)
    print(f"[일봉] daily_prices 적재 (모드 {mode}, 동시 {workers}개, sleep {sleep_sec}초)…")

    def start_for(ticker: str) -> str:
        if gap_fill:
            if existing_set is not None and ticker in existing_set:
                return incremental_start or start
            return initial_start or start
        return start

    n_ok = n_fail = n_empty = 0
    total_rows = 0
    started = time.time()
    done = 0

    def _report(status, nrows, ticker, name, err):
        nonlocal n_ok, n_fail, n_empty, total_rows, done
        done += 1
        if status == 'ok':
            n_ok += 1
            total_rows += nrows
        elif status == 'empty':
            n_empty += 1
        else:
            n_fail += 1
            print(f"       {ticker} {name} ⚠️ {err}")
        if done % 50 == 0 or done == n_total:
            elapsed = time.time() - started
            eta = elapsed / done * (n_total - done) if done < n_total else 0
            print(f"       [{done}/{n_total}] 누적 {total_rows:>7}행, "
                  f"eta {int(eta // 60):>2}분 {int(eta % 60):>2}초")

    if workers and workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [
                ex.submit(_fetch_and_store, u, start_for(u['ticker']), end, sleep_sec)
                for u in work
            ]
            for fut in as_completed(futures):
                _report(*fut.result())
    else:
        for u in work:
            _report(*_fetch_and_store(u, start_for(u['ticker']), end, sleep_sec))

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
    parser.add_argument('--days', type=int, default=0,
                        help='최근 N일치(달력일)만 받기. 0이면 기본 400일치')
    parser.add_argument('--min-cap', type=int, default=0,
                        help='일봉 수집 단계에서 시가총액 N억 미만 제외(NULL·관심종목 제외 안 함). 0이면 끄기')
    parser.add_argument('--gap-fill', action='store_true',
                        help='종목별 마지막 저장일 다음부터 오늘까지 자동 증분 수집')
    parser.add_argument('--workers', type=int, default=1,
                        help='동시 수집 스레드 수 (기본 1=순차). 2 이상이면 병렬 수집')
    parser.add_argument('--log-file', type=str, default=None,
                        help='수집 통계를 기록할 로그 파일 경로')
    args = parser.parse_args()

    today = datetime.today()
    # 주말 보정 (네이버 데이터도 평일 기준)
    while today.weekday() >= 5:
        today -= timedelta(days=1)
    end_str = today.strftime('%Y-%m-%d')
    lookback_days = args.days if args.days and args.days > 0 else 400
    start_str = (today - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
    initial_start = (today - timedelta(days=400)).strftime('%Y-%m-%d')

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
        # 시총 필터(수집 대상 축소) — 옵션 켜졌을 때만. DB/데이터는 손대지 않음.
        if args.min_cap and args.min_cap > 0:
            universe = apply_market_cap_filter(universe, args.min_cap, args.log_file)

        if args.gap_fill:
            # 빈틈 방지: 있는 종목은 증분, 없는 신규는 초기 수집
            existing_set = get_tickers_with_prices()
            incremental_start = compute_incremental_start(today, start_str)
            print(f"[빈틈방지] 증분 시작일 {incremental_start} (신규 종목은 {initial_start}부터)\n")
            load_prices(universe, start_str, end_str, sleep_sec=args.sleep,
                        skip_set=None, gap_fill=True, existing_set=existing_set,
                        incremental_start=incremental_start, initial_start=initial_start,
                        workers=args.workers)
        else:
            # 기존 동작 그대로
            skip_set = get_tickers_with_prices() if args.skip_existing else None
            load_prices(universe, start_str, end_str, sleep_sec=args.sleep,
                        skip_set=skip_set, workers=args.workers)

    overall = time.time() - overall_start
    print(f"\n전체 소요시간: {int(overall // 60)}분 {int(overall % 60)}초")


if __name__ == '__main__':
    main()
