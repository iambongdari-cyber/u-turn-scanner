"""
replay_history.py
과거 N거래일에 대해 가상 리포트(reports + scan_results)를 생성.
backtest의 표본 확보용. 일회성 실행 권장.

[흐름]
  1) 종목·시장지수·일봉 일괄 로드 (1회)
  2) daily_prices에서 distinct date 추출 → 최근 N거래일
  3) 각 거래일 D에 대해:
     - 일봉을 date <= D로 잘라 분석
     - 시장지수도 D 기준 (ma60·20일수익률)
     - 업종 평균도 D 기준
     - run_scan.analyze() 호출 → candidates 필터링 → TOP 10
     - reports + scan_results UPSERT
     - 매 5거래일마다 weekly 리포트도 같이 생성

[참고]
  - news_risks 필터는 비활성 (과거 시점 데이터 없음)
  - 동일 (report_type, base_date) 리포트가 이미 있으면 UPSERT로 덮어씀

[예시]
  python scripts/replay_history.py             # 최근 60거래일
  python scripts/replay_history.py --days 90   # 최근 90거래일
"""
import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

# run_scan 핵심 재사용
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_scan import (  # type: ignore
    analyze,
    fetch_stocks,
    fetch_all_prices,
    upsert_report,
    upsert_scan_results,
    TOP_N,
)

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
}


# ── 시장지수 전체 로드 ───────────────────────────────────────────
def fetch_market_indices_all() -> dict[str, pd.DataFrame]:
    """KOSPI/KOSDAQ 일봉 전체 (date asc)."""
    result: dict[str, pd.DataFrame] = {}
    for name in ("KOSPI", "KOSDAQ"):
        r = requests.get(
            f"{REST_URL}/market_indices",
            headers=HEADERS,
            params={
                "select": "date,close",
                "index_name": f"eq.{name}",
                "order": "date.asc",
            },
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        if rows:
            df = pd.DataFrame(rows)
            df["date"] = pd.to_datetime(df["date"])
            df["close"] = pd.to_numeric(df["close"])
            result[name] = df.sort_values("date").reset_index(drop=True)
    return result


def market_status_as_of(
    idx_dfs: dict[str, pd.DataFrame], as_of_ts: pd.Timestamp
) -> tuple[dict[str, bool], dict[str, float]]:
    """as_of 기준 KOSPI/KOSDAQ의 (ma60 위 여부, 20일 수익률%)."""
    ma60_status: dict[str, bool] = {}
    returns_20d: dict[str, float] = {}
    for name, df in idx_dfs.items():
        sub = df[df["date"] <= as_of_ts]
        if len(sub) < 60:
            ma60_status[name] = False
            continue
        last60 = sub.tail(60)
        last_close = float(last60["close"].iat[-1])
        ma60 = float(last60["close"].mean())
        ma60_status[name] = last_close > ma60
        if len(sub) >= 21:
            prev = float(sub["close"].iat[-21])
            if prev > 0:
                returns_20d[name] = (last_close - prev) / prev * 100
    return ma60_status, returns_20d


# ── 메인 ────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='과거 거래일 가상 리포트 생성')
    parser.add_argument('--days', type=int, default=60,
                        help='최근 N거래일 (기본 60)')
    parser.add_argument('--weekly-stride', type=int, default=5,
                        help='주간 리포트 주기, 거래일 단위 (기본 5)')
    args = parser.parse_args()
    overall_start = time.time()

    print("[1] 종목 마스터…")
    stocks = fetch_stocks()
    print(f"    {len(stocks)}개 종목\n")

    print("[2] 시장지수 일봉…")
    idx_dfs = fetch_market_indices_all()
    print(f"    KOSPI {len(idx_dfs.get('KOSPI', []))}행 / "
          f"KOSDAQ {len(idx_dfs.get('KOSDAQ', []))}행\n")

    print("[3] 종목 일봉 일괄 로드…")
    prices_map = fetch_all_prices()
    print(f"    {len(prices_map)}개 종목\n")

    # 모든 거래일 추출 (모든 종목 union)
    all_dates: set[pd.Timestamp] = set()
    for df in prices_map.values():
        all_dates.update(df["date"].tolist())
    sorted_dates = sorted(all_dates)
    if not sorted_dates:
        sys.exit("거래일 데이터가 없습니다.")

    if len(sorted_dates) < args.days:
        print(f"    ⚠️ 거래일 부족: {len(sorted_dates)}일 < {args.days}일 요청. 가능한 만큼만.")
        target_dates = sorted_dates
    else:
        target_dates = sorted_dates[-args.days:]

    print(f"[4] 가상 리포트 생성 — 최근 {len(target_dates)}거래일 "
          f"({target_dates[0].date()} ~ {target_dates[-1].date()})\n")

    n_daily_saved = 0
    n_weekly_saved = 0
    n_daily_top = 0
    n_weekly_top = 0

    for i, as_of_ts in enumerate(target_dates, 1):
        as_of_date = as_of_ts.date()
        # weekly 리포트는 stride마다 + 마지막에
        is_weekly_day = (i % args.weekly_stride == 0) or (i == len(target_dates))

        # ── as_of 기준 시장 상태 ──
        market_status, market_returns = market_status_as_of(idx_dfs, as_of_ts)

        # ── 일봉 truncation ──
        prices_truncated: dict[str, pd.DataFrame] = {}
        for tkr, df in prices_map.items():
            sub = df[df["date"] <= as_of_ts]
            if len(sub) > 0:
                prices_truncated[tkr] = sub

        # ── 업종 평균 20일 수익률 (as_of 기준) ──
        sector_groups: dict[str, list[float]] = {}
        for _, srow in stocks.iterrows():
            sector = srow.get("sector")
            if not sector or pd.isna(sector):
                continue
            df = prices_truncated.get(srow["ticker"])
            if df is None or len(df) < 21:
                continue
            close = df["close"]
            ti = len(df) - 1
            prev = close.iat[ti - 20]
            if pd.notna(prev) and prev > 0 and pd.notna(close.iat[ti]):
                sector_groups.setdefault(sector, []).append(
                    (close.iat[ti] - prev) / prev * 100
                )
        sector_returns_20d: dict[str, float] = {
            sec: sum(rets) / len(rets)
            for sec, rets in sector_groups.items()
            if len(rets) >= 3
        }

        # ── daily / weekly 둘 다 처리 ──
        report_specs = [("daily", 5)]
        if is_weekly_day:
            report_specs.append(("weekly", 10))

        for report_type, golden_window in report_specs:
            analyzed = []
            for _, srow in stocks.iterrows():
                ticker = srow["ticker"]
                name = srow["name"]
                market_cap = srow["market_cap"]
                stock_market = srow.get("market", "KOSPI")
                market_above_ma60 = market_status.get(stock_market, False)
                market_20d = market_returns.get(stock_market)
                stock_sector = srow.get("sector")
                sector_20d = (sector_returns_20d.get(stock_sector)
                              if stock_sector and not pd.isna(stock_sector) else None)
                df = prices_truncated.get(ticker)
                if df is None or df.empty:
                    continue
                r = analyze(df, market_cap,
                            market_above_ma60=market_above_ma60,
                            golden_window=golden_window,
                            market_20d_return=market_20d,
                            sector_20d_return=sector_20d)
                if r is None:
                    continue
                r["ticker"], r["name"] = ticker, name
                analyzed.append(r)

            # candidates 필터 (news CRITICAL 미적용 — 과거 시점 데이터 없음)
            candidates = [
                r for r in analyzed
                if r["cond_golden"] and r["cond_above_ma60"] and r["cond_ma60_rising"]
                and r["cond_lagging_ok"] and r["cond_cloud_red"]
                and r["cond_value_ok"] and r["cond_cap_ok"] and r["cond_uturn_ok"]
                and r["final_grade"] != "EXCLUDE"
            ]
            candidates.sort(key=lambda x: x["score"], reverse=True)
            top = candidates[:TOP_N]

            # UPSERT report
            try:
                report_id = upsert_report(report_type, as_of_date, is_final=True)
            except Exception as e:
                print(f"  ⚠️ {as_of_date} {report_type} upsert 실패: {e}")
                continue

            if top:
                scan_rows = []
                for rank, r in enumerate(top, 1):
                    scan_rows.append({
                        "report_id": report_id,
                        "ticker": r["ticker"],
                        "rank": rank,
                        "score": r["score"],
                        "cond_golden": r["cond_golden"],
                        "cond_above_ma60": r["cond_above_ma60"],
                        "cond_ma60_rising": r["cond_ma60_rising"],
                        "cond_lagging_ok": r["cond_lagging_ok"],
                        "cond_cloud_red": r["cond_cloud_red"],
                        "close": r["close"], "ma10": r["ma10"],
                        "ma20": r["ma20"], "ma60": r["ma60"],
                        "disparity_pct": r["disparity_pct"],
                        "golden_date": r["golden_date"],
                        "golden_days_ago": r["golden_days_ago"],
                        "trade_value": r["trade_value"],
                        "avg_value_20": r["avg_value_20"],
                        "stop_loss": r["stop_loss"],
                        "upside_pct": r["upside_pct"],
                        "rr_ratio": r["rr_ratio"],
                        "buy1_price": r["buy1_price"],
                        "buy2_price": r["buy2_price"],
                        "final_grade": r["final_grade"],
                        "one_line": r["one_line"],
                    })
                upsert_scan_results(scan_rows)

            if report_type == "daily":
                n_daily_saved += 1
                n_daily_top += len(top)
            else:
                n_weekly_saved += 1
                n_weekly_top += len(top)

        # 진행 표시
        if i % 5 == 0 or i == len(target_dates):
            elapsed = time.time() - overall_start
            eta = elapsed / i * (len(target_dates) - i) if i < len(target_dates) else 0
            print(f"  [{i:>3}/{len(target_dates)}] {as_of_date}  "
                  f"daily {n_daily_saved} (+{n_daily_top}건) / "
                  f"weekly {n_weekly_saved} (+{n_weekly_top}건)  "
                  f"— {int(elapsed//60)}분 {int(elapsed%60)}초 "
                  f"(eta {int(eta//60)}분 {int(eta%60)}초)")

    elapsed = time.time() - overall_start
    print(f"\n  ✓ 완료")
    print(f"    daily  {n_daily_saved}개 리포트 / 후보 {n_daily_top}건")
    print(f"    weekly {n_weekly_saved}개 리포트 / 후보 {n_weekly_top}건")
    print(f"  ✓ 소요 {int(elapsed//60)}분 {int(elapsed%60)}초")


if __name__ == "__main__":
    main()
