"""
analyze_backtest.py
백테스트 결과를 점수 구성 요소별로 bucket 분석.
어떤 지표가 수익률과 실제로 상관있는지 → 점수 가중치 조정 근거.

분석 대상 (closed only):
  1. 점수 (score) — 점수가 변별력이 있는지
  2. 골든크로스 일수 (golden_days_ago)
  3. 60일선 이격도 (disparity_pct)
  4. 손익비 (rr_ratio)
  5. 20일 평균 거래대금 (avg_value_20)
  6. 판정 (final_grade)
  7. 청산 사유 (strategy_exit_reason)
"""
import os
import statistics
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

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


def fetch_backtest_with_scan() -> list[dict]:
    """closed인 backtest_results + scan_results 조인."""
    # 1) backtest_results (closed only)
    bt_rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/backtest_results",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "report_id,ticker,strategy_return_pct,buyhold_return_pct,"
                          "strategy_exit_reason,max_gain_pct,max_drawdown_pct",
                "is_open": "eq.false",
                "order": "base_date.asc",
            },
            timeout=60,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        bt_rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE

    # 2) scan_results 매핑
    report_ids = list({r["report_id"] for r in bt_rows})
    scan_map: dict[tuple[str, str], dict] = {}
    CHUNK = 50
    for i in range(0, len(report_ids), CHUNK):
        ids = report_ids[i:i + CHUNK]
        in_list = ",".join(ids)
        r = requests.get(
            f"{REST_URL}/scan_results",
            headers={**HEADERS, "Range": "0-9999"},
            params={
                "select": "report_id,ticker,score,final_grade,golden_days_ago,"
                          "disparity_pct,rr_ratio,avg_value_20,upside_pct",
                "report_id": f"in.({in_list})",
            },
            timeout=60,
        )
        r.raise_for_status()
        for s in r.json():
            scan_map[(s["report_id"], s["ticker"])] = s

    # 3) 조인
    joined: list[dict] = []
    for bt in bt_rows:
        s = scan_map.get((bt["report_id"], bt["ticker"]))
        if s:
            joined.append({**bt, **s})
    return joined


def to_f(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def bucket_analyze(rows, key_fn, buckets, label: str):
    print(f"\n[{label}]")
    print(f"  {'구간':<16}{'표본':>6}  {'전략평균':>11}  {'중앙':>9}  {'보유평균':>11}  {'중앙':>9}  {'승률':>6}")
    print("  " + "─" * 78)
    total = 0
    for b in buckets:
        subset = []
        for r in rows:
            v = key_fn(r)
            if v is None:
                continue
            if b["test"](v):
                subset.append(r)
        if not subset:
            print(f"  {b['label']:<16}{'-':>6}  {'-':>11}  {'-':>9}  {'-':>11}  {'-':>9}  {'-':>6}")
            continue
        s = [r["strategy_return_pct"] for r in subset if r.get("strategy_return_pct") is not None]
        bh = [r["buyhold_return_pct"] for r in subset if r.get("buyhold_return_pct") is not None]
        if not s or not bh:
            continue
        wins = sum(1 for x in s if x > 0)
        winrate = wins / len(s) * 100
        print(f"  {b['label']:<16}{len(subset):>6}  "
              f"{statistics.mean(s):>+9.2f}%   {statistics.median(s):>+7.2f}%  "
              f"{statistics.mean(bh):>+9.2f}%   {statistics.median(bh):>+7.2f}%  "
              f"{winrate:>5.1f}%")
        total += len(subset)
    print(f"  {'합계':<16}{total:>6}")


def category_analyze(rows, key, label: str, categories: list[str] | None = None):
    print(f"\n[{label}]")
    print(f"  {'구간':<16}{'표본':>6}  {'전략평균':>11}  {'보유평균':>11}  {'승률':>6}")
    print("  " + "─" * 60)
    cats = categories or sorted({r.get(key) for r in rows if r.get(key)})
    for cat in cats:
        subset = [r for r in rows if r.get(key) == cat]
        if not subset:
            continue
        s = [r["strategy_return_pct"] for r in subset if r.get("strategy_return_pct") is not None]
        bh = [r["buyhold_return_pct"] for r in subset if r.get("buyhold_return_pct") is not None]
        if not s:
            continue
        wins = sum(1 for x in s if x > 0)
        winrate = wins / len(s) * 100
        print(f"  {cat:<16}{len(subset):>6}  "
              f"{statistics.mean(s):>+9.2f}%   "
              f"{statistics.mean(bh):>+9.2f}%   "
              f"{winrate:>5.1f}%")


def main():
    print("[1] 데이터 로드…")
    rows = fetch_backtest_with_scan()
    print(f"    closed 청산 {len(rows)}건\n")

    if not rows:
        print("백테스트 데이터가 없습니다.")
        return

    # 1) 점수별 (재확인)
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("score")),
        [
            {"label": "90 이상",  "test": lambda v: v >= 90},
            {"label": "85-89",    "test": lambda v: 85 <= v < 90},
            {"label": "80-84",    "test": lambda v: 80 <= v < 85},
            {"label": "75-79",    "test": lambda v: 75 <= v < 80},
            {"label": "70-74",    "test": lambda v: 70 <= v < 75},
            {"label": "65-69",    "test": lambda v: 65 <= v < 70},
            {"label": "60-64",    "test": lambda v: 60 <= v < 65},
            {"label": "60 미만",  "test": lambda v: v < 60},
        ],
        "점수별 평균 수익률 (변별력 확인)",
    )

    # 2) 골든크로스 일수
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("golden_days_ago")),
        [
            {"label": "0일전(당일)", "test": lambda v: v == 0},
            {"label": "1일전",       "test": lambda v: v == 1},
            {"label": "2일전",       "test": lambda v: v == 2},
            {"label": "3일전",       "test": lambda v: v == 3},
            {"label": "4일전",       "test": lambda v: v == 4},
            {"label": "5-10일전",    "test": lambda v: 5 <= v <= 10},
        ],
        "골든크로스 일수별 (최근일수록 점수↑)",
    )

    # 3) 이격도
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("disparity_pct")),
        [
            {"label": "<0% (음)",  "test": lambda v: v < 0},
            {"label": "0-3%",      "test": lambda v: 0 <= v < 3},
            {"label": "3-5%",      "test": lambda v: 3 <= v < 5},
            {"label": "5-7%",      "test": lambda v: 5 <= v < 7},
            {"label": "7-10%",     "test": lambda v: 7 <= v < 10},
            {"label": "10-15%",    "test": lambda v: 10 <= v < 15},
            {"label": "15-20%",    "test": lambda v: 15 <= v < 20},
            {"label": "20%+",      "test": lambda v: v >= 20},
        ],
        "60일선 이격도별 (작을수록 점수↑)",
    )

    # 4) 손익비
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("rr_ratio")),
        [
            {"label": "<1.0",       "test": lambda v: 0 < v < 1.0},
            {"label": "1.0-1.5",    "test": lambda v: 1.0 <= v < 1.5},
            {"label": "1.5-2.0",    "test": lambda v: 1.5 <= v < 2.0},
            {"label": "2.0-3.0",    "test": lambda v: 2.0 <= v < 3.0},
            {"label": "3.0+",       "test": lambda v: v >= 3.0},
        ],
        "손익비(rr_ratio)별 (높을수록 점수↑)",
    )

    # 5) 평균 거래대금 (억 원)
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("avg_value_20")),
        [
            {"label": "10-30억",     "test": lambda v: 1e9 <= v < 3e9},
            {"label": "30-50억",     "test": lambda v: 3e9 <= v < 5e9},
            {"label": "50-100억",    "test": lambda v: 5e9 <= v < 10e9},
            {"label": "100-300억",   "test": lambda v: 1e10 <= v < 3e10},
            {"label": "300-500억",   "test": lambda v: 3e10 <= v < 5e10},
            {"label": "500-1000억",  "test": lambda v: 5e10 <= v < 1e11},
            {"label": "1000억+",     "test": lambda v: v >= 1e11},
        ],
        "20일 평균 거래대금별",
    )

    # 6) 상승여력 (upside_pct)
    bucket_analyze(
        rows,
        lambda r: to_f(r.get("upside_pct")),
        [
            {"label": "<10%",       "test": lambda v: v < 10},
            {"label": "10-20%",     "test": lambda v: 10 <= v < 20},
            {"label": "20-30%",     "test": lambda v: 20 <= v < 30},
            {"label": "30-50%",     "test": lambda v: 30 <= v < 50},
            {"label": "50%+",       "test": lambda v: v >= 50},
        ],
        "상승여력(60일고가 대비)별",
    )

    # 7) 판정별
    category_analyze(
        rows, "final_grade", "판정별",
        categories=["A", "B", "WATCH", "CHASE_RISK"],
    )

    # 8) 청산 사유별
    category_analyze(
        rows, "strategy_exit_reason", "청산 사유별",
        categories=["TARGET", "STOP", "TIMEOUT"],
    )

    # 9) 상관계수 (Pearson) — 직관적 변별력 측정
    print("\n[수익률과의 상관계수 (Pearson, 단순보유 기준)]")
    print("  +양수 = 값이 클수록 수익↑ / -음수 = 값이 클수록 수익↓ / 0에 가까우면 무관")
    print(f"  {'지표':<22} {'상관계수':>10}  {'표본':>6}")
    print("  " + "─" * 50)

    def corr(xs, ys):
        if len(xs) < 3:
            return None
        try:
            return statistics.correlation(xs, ys)
        except statistics.StatisticsError:
            return None

    indicators = [
        ("score",            "점수"),
        ("golden_days_ago",  "골든크로스 일수 (작을수록↑)"),
        ("disparity_pct",    "이격도 (%)"),
        ("rr_ratio",         "손익비"),
        ("avg_value_20",     "20일 평균 거래대금"),
        ("upside_pct",       "상승여력 (%)"),
    ]
    for key, label in indicators:
        pairs = [
            (to_f(r.get(key)), to_f(r.get("buyhold_return_pct")))
            for r in rows
        ]
        pairs = [(x, y) for x, y in pairs if x is not None and y is not None]
        if not pairs:
            continue
        xs = [x for x, _ in pairs]
        ys = [y for _, y in pairs]
        c = corr(xs, ys)
        print(f"  {label:<22} {c if c is None else f'{c:+.3f}':>10}  {len(pairs):>6}")


if __name__ == "__main__":
    main()
