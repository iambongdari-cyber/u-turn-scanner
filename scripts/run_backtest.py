"""
run_backtest.py
과거 리포트(scan_results)의 각 종목을 60거래일 시뮬레이션해 backtest_results에 저장.

[시나리오]
  (A) 전략 시뮬: 매일 고가/저가 체크해서 손절/목표/타임아웃 청산
  (B) 단순 60일 보유: 그냥 60일째 종가 청산

[진입]
  리포트 base_date 다음 거래일 시가에 매수

[전략 청산]
  - 첫날 시가가 손절가 이하 → 즉시 시가에 STOP
  - 첫날 시가가 목표가 이상 → 즉시 시가에 TARGET
  - 이후 일일: 저가 ≤ stop_loss → STOP at stop_loss
              고가 ≥ target    → TARGET at target
  - 60일 도달 → TIMEOUT (60일째 종가)
  - 60일 미만 → OPEN (현재까지 평가, 다음 실행 때 갱신)

매일 갱신 가능. OPEN 포지션 + 신규 리포트 모두 처리.
"""
import argparse
import os
import statistics
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

# ── 환경변수 ─────────────────────────────────────────────────────
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

DEFAULT_HOLDING = 60
FEE_PCT = 0.5  # 통계 출력용 (DB는 gross 저장)


# ── DB 헬퍼 ─────────────────────────────────────────────────────
def fetch_reports() -> list[dict]:
    """모든 reports 조회."""
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/reports",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "id,report_type,base_date,is_final",
                "order": "base_date.asc",
            },
            timeout=30,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def fetch_all_scan_results() -> list[dict]:
    """모든 scan_results 일괄 조회. report별로 그룹핑해 사용."""
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/scan_results",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "report_id,ticker,rank,score,close,stop_loss,upside_pct,final_grade",
                "order": "report_id.asc",
            },
            timeout=120,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def fetch_all_prices() -> dict[str, pd.DataFrame]:
    """daily_prices 일괄 로드 → ticker별 DataFrame dict."""
    print("일봉 데이터 일괄 로드…")
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/daily_prices",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "ticker,date,open,high,low,close",
                "order": "ticker.asc,date.asc",
            },
            timeout=120,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
        if offset % 50000 == 0:
            print(f"  …{offset}행")
    print(f"  ✓ {len(rows)}행")

    if not rows:
        return {}

    big = pd.DataFrame(rows)
    big["date"] = pd.to_datetime(big["date"])
    for c in ["open", "high", "low", "close"]:
        big[c] = pd.to_numeric(big[c], errors="coerce")

    result: dict[str, pd.DataFrame] = {}
    for ticker, g in big.groupby("ticker"):
        result[ticker] = g.sort_values("date").reset_index(drop=True)
    return result


def upsert_backtest_results(rows: list[dict]) -> None:
    if not rows:
        return
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = requests.post(
            f"{REST_URL}/backtest_results",
            headers={**HEADERS,
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=chunk,
            timeout=120,
        )
        if not r.ok:
            raise RuntimeError(
                f"backtest_results upsert 실패 ({r.status_code}): {r.text[:300]}"
            )


# ── 시뮬레이션 ──────────────────────────────────────────────────
def simulate(
    prices: pd.DataFrame,
    base_date: date,
    base_close: float,
    stop_loss: float,
    target_price: float,
    holding_days: int,
) -> dict | None:
    """
    한 (report, ticker) 백테스트 결과 반환. None이면 진입 불가(데이터 부족).
    """
    # base_date 이후 거래일들
    df = prices[prices["date"] > pd.Timestamp(base_date)].reset_index(drop=True)
    if df.empty:
        return None  # 진입 불가 (오늘 또는 미래 리포트)

    entry_date = df["date"].iat[0].date()
    entry_price = float(df["open"].iat[0])
    if not (entry_price > 0):
        return None

    window = df.head(holding_days)
    actual_days = len(window)
    is_open = actual_days < holding_days

    # ── 전략 시뮬 (A) ──
    strategy_exit_date = None
    strategy_exit_price = None
    strategy_exit_reason = None
    strategy_holding_days = None

    for i in range(actual_days):
        d = window["date"].iat[i].date()
        o = float(window["open"].iat[i])
        h = float(window["high"].iat[i])
        l = float(window["low"].iat[i])

        if i == 0:
            # 진입일 갭 처리: 시가가 손절/목표 통과면 시가에 즉시 청산
            if o <= stop_loss:
                strategy_exit_date = d
                strategy_exit_price = o
                strategy_exit_reason = "STOP"
                strategy_holding_days = 1
                break
            if o >= target_price:
                strategy_exit_date = d
                strategy_exit_price = o
                strategy_exit_reason = "TARGET"
                strategy_holding_days = 1
                break

        # 일반 처리: 저가 손절 우선 → 고가 목표
        # (보수적: 같은 날 둘 다 닿으면 손절을 먼저로 본다)
        if l <= stop_loss:
            strategy_exit_date = d
            strategy_exit_price = stop_loss
            strategy_exit_reason = "STOP"
            strategy_holding_days = i + 1
            break
        if h >= target_price:
            strategy_exit_date = d
            strategy_exit_price = target_price
            strategy_exit_reason = "TARGET"
            strategy_holding_days = i + 1
            break

    # 만료
    if strategy_exit_date is None:
        last_date = window["date"].iat[-1].date()
        last_close = float(window["close"].iat[-1])
        strategy_exit_date = last_date
        strategy_exit_price = last_close
        strategy_exit_reason = "OPEN" if is_open else "TIMEOUT"
        strategy_holding_days = actual_days

    strategy_return_pct = (strategy_exit_price - entry_price) / entry_price * 100

    # ── 단순 60일 보유 (B) ──
    buyhold_exit_date = window["date"].iat[-1].date()
    buyhold_exit_price = float(window["close"].iat[-1])
    buyhold_holding_days = actual_days
    buyhold_return_pct = (buyhold_exit_price - entry_price) / entry_price * 100

    # ── 보유 기간 극값 ──
    max_high = float(window["high"].max())
    min_low = float(window["low"].min())
    max_gain_pct = (max_high - entry_price) / entry_price * 100
    max_drawdown_pct = (min_low - entry_price) / entry_price * 100

    return {
        "entry_date": entry_date.isoformat(),
        "entry_price": round(entry_price, 2),
        "strategy_exit_date": strategy_exit_date.isoformat(),
        "strategy_exit_price": round(strategy_exit_price, 2),
        "strategy_exit_reason": strategy_exit_reason,
        "strategy_holding_days": strategy_holding_days,
        "strategy_return_pct": round(strategy_return_pct, 2),
        "buyhold_exit_date": buyhold_exit_date.isoformat(),
        "buyhold_exit_price": round(buyhold_exit_price, 2),
        "buyhold_holding_days": buyhold_holding_days,
        "buyhold_return_pct": round(buyhold_return_pct, 2),
        "max_gain_pct": round(max_gain_pct, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "is_open": is_open,
    }


# ── 메인 ────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='리포트 백테스트 (60일 시뮬)')
    parser.add_argument('--holding-days', type=int, default=DEFAULT_HOLDING)
    parser.add_argument('--report-type', choices=['daily', 'weekly', 'all'],
                        default='all')
    args = parser.parse_args()

    holding_days = args.holding_days
    overall_start = time.time()

    print(f"[1] 리포트 목록 조회…")
    reports = fetch_reports()
    if args.report_type != 'all':
        reports = [r for r in reports if r["report_type"] == args.report_type]
    n_daily = sum(1 for r in reports if r["report_type"] == "daily")
    n_weekly = sum(1 for r in reports if r["report_type"] == "weekly")
    print(f"    {len(reports)}개 (daily {n_daily}, weekly {n_weekly})\n")

    if not reports:
        print("리포트가 없습니다.")
        return

    print(f"[2] scan_results 일괄 로드…")
    all_scans = fetch_all_scan_results()
    print(f"    {len(all_scans)}건\n")

    # report_id로 그룹핑
    scans_by_report: dict[str, list[dict]] = {}
    for s in all_scans:
        scans_by_report.setdefault(s["report_id"], []).append(s)

    print(f"[3] 일봉 일괄 로드…")
    prices_map = fetch_all_prices()
    print(f"    {len(prices_map)}개 종목\n")

    print(f"[4] 시뮬레이션 (holding={holding_days}일)…")
    rows_to_upsert: list[dict] = []
    n_open = 0
    n_no_data = 0
    n_cannot_enter = 0

    for i, rep in enumerate(reports, 1):
        rep_id = rep["id"]
        base_date_str = rep["base_date"]
        base_date_obj = date.fromisoformat(base_date_str)

        scans = scans_by_report.get(rep_id, [])
        if not scans:
            continue

        for s in scans:
            ticker = s["ticker"]
            base_close = s.get("close")
            stop_loss = s.get("stop_loss")
            upside_pct = s.get("upside_pct")
            if base_close is None or stop_loss is None or upside_pct is None:
                continue
            base_close = float(base_close)
            stop_loss = float(stop_loss)
            upside_pct = float(upside_pct)

            target_price = base_close * (1 + upside_pct / 100)

            prices = prices_map.get(ticker)
            if prices is None or prices.empty:
                n_no_data += 1
                continue

            sim = simulate(prices, base_date_obj, base_close,
                           stop_loss, target_price, holding_days)
            if sim is None:
                n_cannot_enter += 1
                continue
            if sim["is_open"]:
                n_open += 1

            rows_to_upsert.append({
                "report_id": rep_id,
                "ticker": ticker,
                "base_date": base_date_str,
                **sim,
                "stop_loss": round(stop_loss, 2),
                "target_price": round(target_price, 2),
            })

        if i % 20 == 0 or i == len(reports):
            print(f"    [{i}/{len(reports)}] 누적 {len(rows_to_upsert)}건 "
                  f"(OPEN {n_open} / 일봉없음 {n_no_data} / 진입불가 {n_cannot_enter})")

    # ── DB 저장 ──
    print(f"\n[5] backtest_results 저장…")
    upsert_backtest_results(rows_to_upsert)
    print(f"    ✓ {len(rows_to_upsert)}건 저장")

    elapsed = time.time() - overall_start
    print(f"    ✓ 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초\n")

    # ── 통계 ──
    closed = [r for r in rows_to_upsert if not r["is_open"]]
    if closed:
        # 전략 시뮬
        rets_a = [r["strategy_return_pct"] for r in closed]
        wins_a = [r for r in closed if r["strategy_return_pct"] > 0]
        mean_a = statistics.mean(rets_a)
        med_a = statistics.median(rets_a)
        winrate_a = len(wins_a) / len(closed) * 100

        reasons: dict[str, int] = {}
        for r in closed:
            reasons[r["strategy_exit_reason"]] = reasons.get(r["strategy_exit_reason"], 0) + 1

        print(f"[전략 시뮬 통계 — 청산 {len(closed)}건]")
        print(f"  평균 수익률: {mean_a:+.2f}%")
        print(f"  중앙값:      {med_a:+.2f}%")
        print(f"  승률:        {winrate_a:.1f}% ({len(wins_a)}/{len(closed)})")
        print(f"  청산 사유:   " + "  ".join(f"{k} {v}" for k, v in sorted(reasons.items())))

        # 단순 보유
        rets_b = [r["buyhold_return_pct"] for r in closed]
        wins_b = [r for r in closed if r["buyhold_return_pct"] > 0]
        mean_b = statistics.mean(rets_b)
        med_b = statistics.median(rets_b)
        winrate_b = len(wins_b) / len(closed) * 100

        print(f"\n[단순 60일 보유 — 같은 {len(closed)}건]")
        print(f"  평균 수익률: {mean_b:+.2f}%")
        print(f"  중앙값:      {med_b:+.2f}%")
        print(f"  승률:        {winrate_b:.1f}% ({len(wins_b)}/{len(closed)})")

        # 수수료 차감
        print(f"\n[수수료 {FEE_PCT}% 차감 net 평균]")
        print(f"  전략 net:    {mean_a - FEE_PCT:+.2f}%")
        print(f"  보유 net:    {mean_b - FEE_PCT:+.2f}%")

    if n_open:
        rets_open = [r["strategy_return_pct"] for r in rows_to_upsert if r["is_open"]]
        if rets_open:
            mean_open = statistics.mean(rets_open)
            print(f"\n[보유 중 {n_open}건 — 현재 평가손익]")
            print(f"  평균:        {mean_open:+.2f}%")


if __name__ == "__main__":
    main()
