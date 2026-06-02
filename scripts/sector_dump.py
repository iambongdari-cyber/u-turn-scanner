"""
sector_dump.py — 사이드카 분석(섹터 강도 + 진짜 주도주/후발주) → JSON
=================================================================
- scripts/run_scan.py 의 함수/상수를 **import만** 해서 사용한다(수정 없음).
- DB write 없음. JSON 파일만 출력.
- 출력 경로: logs/sidecar/sector_dump_latest.json  (덮어쓰기)
- 표현 원칙: 허용 라벨(진짜 주도주 후보 / 후발주 관찰 / 기회 후보 / 추격 위험 /
            조건 부족 / 보유자 대응)만 사용. 권유성·예측성 표현은
            docs/V0.2_DESIGN.md 의 금지어 목록 참조(이 파일 본문에는 사용하지 않음).

[실행]
  .venv\\Scripts\\python.exe scripts\\sector_dump.py
  .venv\\Scripts\\python.exe scripts\\sector_dump.py --top-sectors 10 --min-stocks 8
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import pandas as pd

from run_scan import (  # 수정 없이 import만
    fetch_all_prices,
    fetch_market_index_data,
    fetch_stocks,
    MIN_AVG_VALUE_20,
)

ROOT = HERE.parent
OUTPUT_DIR = ROOT / "logs" / "sidecar"
OUTPUT_FILE = OUTPUT_DIR / "sector_dump_latest.json"


def _f(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _r(v, n=2):
    f = _f(v)
    return None if f is None else round(f, n)


def compute_metrics(df: pd.DataFrame) -> dict:
    """종목별 지표: 20일 수익률, 20일 평균거래대금, 전고점 위치, 60일선 위/이격."""
    out = {
        "return_20d": None, "value_20d": None,
        "near_high_pct": None, "above_ma60": None, "disparity_pct": None,
    }
    if df is None or df.empty:
        return out
    n = len(df)
    # 20일 수익률
    if n >= 21:
        c0 = df["close"].iat[-21]
        c1 = df["close"].iat[-1]
        if c0 is not None and not pd.isna(c0) and c0 != 0:
            out["return_20d"] = float((c1 - c0) / c0 * 100)
    # 20일 평균 거래대금 (NULL이면 close*volume 근사 — run_scan 규칙과 동일)
    if n >= 20:
        tv = df["trade_value"]
        approx = df["close"] * df["volume"]
        tv_use = tv.where(tv.notna(), approx)
        out["value_20d"] = float(tv_use.tail(20).dropna().mean()) if tv_use.tail(20).notna().any() else None
    # 60일 고가 위치 / 60일선 / 이격도
    if n >= 60:
        high_60 = df["high"].iloc[-60:].max()
        ma60 = df["close"].rolling(60).mean().iat[-1]
        close = df["close"].iat[-1]
        if high_60 is not None and not pd.isna(high_60) and high_60 != 0 and close is not None:
            out["near_high_pct"] = float(close / high_60 * 100)
        if ma60 is not None and not pd.isna(ma60) and close is not None:
            out["above_ma60"] = bool(close > ma60)
            if ma60 != 0:
                out["disparity_pct"] = float((close - ma60) / ma60 * 100)
    return out


def classify(near_high_pct, value_20, above_ma60, disparity_pct) -> str:
    """주도주/후발주/추격 위험/조건 부족/보유자 대응 라벨링."""
    if above_ma60 is None or near_high_pct is None or value_20 is None or disparity_pct is None:
        return "조건 부족"
    # 추격 위험 우선
    if disparity_pct >= 20:
        return "추격 위험"
    # 진짜 주도주 후보
    if (above_ma60 and near_high_pct >= 90
            and value_20 >= MIN_AVG_VALUE_20
            and disparity_pct < 20):
        return "진짜 주도주 후보"
    # 후발주 관찰: 같은 섹터 강세에서 위쪽 따라가는 종목
    if above_ma60 and 70 <= near_high_pct < 90 and value_20 >= MIN_AVG_VALUE_20 * 0.5:
        return "후발주 관찰"
    # 기회 후보
    if above_ma60 and value_20 >= MIN_AVG_VALUE_20:
        return "기회 후보"
    # 보유자 대응 (60일선 위지만 기준 일부 미달)
    if above_ma60:
        return "보유자 대응"
    return "조건 부족"


def main() -> None:
    parser = argparse.ArgumentParser(description="사이드카: 섹터 강도 + 주도주/후발주 → JSON")
    parser.add_argument("--top-sectors", type=int, default=8,
                        help="강한 섹터 상위 N개 (기본 8)")
    parser.add_argument("--min-stocks", type=int, default=5,
                        help="섹터별 최소 종목 수 (기본 5)")
    args = parser.parse_args()

    print(f"[sector_dump] 시작 (top_sectors={args.top_sectors}, min_stocks={args.min_stocks})")

    print("종목 마스터 로드…")
    stocks = fetch_stocks()
    print(f"  ✓ {len(stocks)}개")

    print("시장 지수 상태 조회…")
    market_status, market_returns = fetch_market_index_data()
    kospi_20d = market_returns.get("KOSPI")
    kosdaq_20d = market_returns.get("KOSDAQ")
    market_flow = (
        "강세 흐름" if (market_status.get("KOSPI", False) and market_status.get("KOSDAQ", False))
        else "약세 흐름" if (not market_status.get("KOSPI", False) and not market_status.get("KOSDAQ", False))
        else "중립 흐름"
    )
    if kospi_20d is not None and kosdaq_20d is not None:
        market_avg = (kospi_20d + kosdaq_20d) / 2
    elif kospi_20d is not None:
        market_avg = kospi_20d
    elif kosdaq_20d is not None:
        market_avg = kosdaq_20d
    else:
        market_avg = 0.0
    print(f"  KOSPI 20일 수익률 {kospi_20d}, KOSDAQ 20일 수익률 {kosdaq_20d}, 시장 평균 {market_avg:.2f}%")

    print("일봉 데이터 로드 (캐시 우선)…")
    prices_map = fetch_all_prices(use_cache=True)

    print("종목별 지표 계산…")
    by_ticker: dict[str, dict] = {}
    for _, srow in stocks.iterrows():
        ticker = srow["ticker"]
        sector = srow.get("sector")
        if not sector:
            continue
        df = prices_map.get(ticker)
        m = compute_metrics(df)
        if m["return_20d"] is None:
            continue
        by_ticker[ticker] = {
            "ticker": ticker,
            "name": srow["name"],
            "market": srow.get("market", "KOSPI"),
            "sector": sector,
            "market_cap": int(srow["market_cap"]) if srow["market_cap"] is not None and not pd.isna(srow["market_cap"]) else None,
            **m,
        }
    print(f"  ✓ {len(by_ticker)}개 종목 지표 산출")

    # 섹터 집계
    print("섹터별 평균 수익률·상대강도 집계…")
    sector_groups: dict[str, list[dict]] = {}
    for d in by_ticker.values():
        sector_groups.setdefault(d["sector"], []).append(d)

    sector_aggs = []
    for sector, members in sector_groups.items():
        if len(members) < args.min_stocks:
            continue
        rets = [m["return_20d"] for m in members if m["return_20d"] is not None]
        if not rets:
            continue
        avg_ret = sum(rets) / len(rets)
        sector_aggs.append({
            "sector": sector,
            "n_stocks": len(members),
            "sector_20d_return": float(avg_ret),
            "market_relative_strength": float(avg_ret - market_avg),
            "members": members,
        })
    sector_aggs.sort(key=lambda s: s["sector_20d_return"], reverse=True)

    strong = sector_aggs[: args.top_sectors]
    weak = sector_aggs[-args.top_sectors:][::-1] if len(sector_aggs) > args.top_sectors else []

    def classify_members(members):
        buckets = {"진짜 주도주 후보": [], "후발주 관찰": [], "기회 후보": [],
                   "추격 위험": [], "보유자 대응": [], "조건 부족": []}
        for m in members:
            label = classify(
                near_high_pct=m["near_high_pct"],
                value_20=m["value_20d"],
                above_ma60=m["above_ma60"],
                disparity_pct=m["disparity_pct"],
            )
            entry = {
                "ticker": m["ticker"],
                "name": m["name"],
                "label": label,
                "return_20d": _r(m["return_20d"], 2),
                "value_20d_eok": _r((m["value_20d"] or 0) / 1e8, 1) if m["value_20d"] is not None else None,
                "near_high_pct": _r(m["near_high_pct"], 1),
                "disparity_pct": _r(m["disparity_pct"], 1),
                "above_ma60": m["above_ma60"],
            }
            buckets[label].append(entry)
        # 정렬: 주도주는 전고점 위치+거래대금, 후발주·기회는 수익률, 추격은 이격도
        buckets["진짜 주도주 후보"].sort(
            key=lambda x: (x.get("near_high_pct") or 0, x.get("value_20d_eok") or 0), reverse=True)
        buckets["후발주 관찰"].sort(key=lambda x: (x.get("return_20d") or 0), reverse=True)
        buckets["기회 후보"].sort(key=lambda x: (x.get("return_20d") or 0), reverse=True)
        buckets["추격 위험"].sort(key=lambda x: (x.get("disparity_pct") or 0), reverse=True)
        return buckets

    def shape_sector(s, limit=10):
        b = classify_members(s["members"])
        return {
            "sector": s["sector"],
            "n_stocks": s["n_stocks"],
            "sector_20d_return": round(s["sector_20d_return"], 2),
            "market_relative_strength": round(s["market_relative_strength"], 2),
            "leaders": b["진짜 주도주 후보"][:limit],
            "followers": b["후발주 관찰"][:limit],
            "opportunities": b["기회 후보"][:limit],
            "chase_risk": b["추격 위험"][:limit],
            "holders_response_count": len(b["보유자 대응"]),
            "insufficient_count": len(b["조건 부족"]),
        }

    sectors_strong = [shape_sector(s) for s in strong]
    sectors_weak = [shape_sector(s) for s in weak]

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "market_flow": market_flow,
        "kospi_20d_return": _f(kospi_20d),
        "kosdaq_20d_return": _f(kosdaq_20d),
        "market_avg_20d_return": round(float(market_avg), 2),
        "params": {
            "top_sectors": args.top_sectors,
            "min_stocks": args.min_stocks,
            "leader_near_high_pct": 90,
            "follower_near_high_pct_range": [70, 90],
            "chase_risk_disparity_pct": 20,
            "value_threshold_eok": MIN_AVG_VALUE_20 // 10**8,
        },
        "sectors_strong": sectors_strong,
        "sectors_weak": sectors_weak,
        "summary": {
            "n_sectors_considered": len(sector_aggs),
            "n_sectors_strong": len(sectors_strong),
            "n_sectors_weak": len(sectors_weak),
            "n_stocks_with_metrics": len(by_ticker),
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)

    print(f"\n✓ JSON 저장: {OUTPUT_FILE}")
    print(f"  강한 섹터 {len(sectors_strong)}개 / 약한 섹터 {len(sectors_weak)}개 / "
          f"전체 산출 종목 {len(by_ticker)}개")


if __name__ == "__main__":
    main()
