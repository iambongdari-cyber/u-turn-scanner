"""
scan_dump.py — 사이드카 분석(바닥 U턴 후보 + 추격 위험 강화 + 단계 라벨) → JSON
=================================================================
- scripts/run_scan.py 의 함수/상수를 **import만** 해서 사용한다(수정 없음).
- DB write 없음(스캔 결과 저장 안 함). JSON 파일만 출력.
- 출력 경로: logs/sidecar/scan_dump_latest.json  (덮어쓰기)
- 표현 원칙: 허용 라벨(바닥 관찰 / U턴 시도 / U턴 확인 / 추세전환 후보 / 기회 후보 /
            추격 위험 / 조건 부족 / 보유자 대응)만 사용. 권유성·예측성 표현은
            docs/V0.2_DESIGN.md 의 금지어 목록 참조(이 파일 본문에는 사용하지 않음).

[실행]
  .venv\\Scripts\\python.exe scripts\\scan_dump.py
  .venv\\Scripts\\python.exe scripts\\scan_dump.py --report-type weekly
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# 같은 폴더의 run_scan.py 를 import 가능하도록 경로 추가
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import pandas as pd

from run_scan import (  # 수정 없이 import만
    analyze,
    fetch_all_prices,
    fetch_market_index_data,
    fetch_news_risks,
    fetch_stocks,
    GOLDEN_WINDOW,
)

ROOT = HERE.parent
OUTPUT_DIR = ROOT / "logs" / "sidecar"
OUTPUT_FILE = OUTPUT_DIR / "scan_dump_latest.json"


def _f(v):
    """JSON 직렬화용 안전한 float 변환 (NaN/None → None)."""
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


def _i(v):
    """JSON 직렬화용 안전한 int 변환."""
    f = _f(v)
    if f is None:
        return None
    return int(f)


def compute_sector_20d_returns(stocks_df: pd.DataFrame,
                               prices_map: dict[str, pd.DataFrame]) -> dict[str, float]:
    """업종별 평균 20거래일 수익률(%). run_scan과 동일 산식, 표본 3개 이상인 섹터만."""
    by_sector: dict[str, list[float]] = {}
    for _, srow in stocks_df.iterrows():
        ticker = srow["ticker"]
        sector = srow.get("sector")
        if not sector:
            continue
        df = prices_map.get(ticker)
        if df is None or len(df) < 21:
            continue
        c0 = df["close"].iat[-21]
        c1 = df["close"].iat[-1]
        if c0 is None or pd.isna(c0) or c0 == 0:
            continue
        by_sector.setdefault(sector, []).append((c1 - c0) / c0 * 100)
    return {s: sum(v) / len(v) for s, v in by_sector.items() if len(v) >= 3}


def stage_label(golden_days_ago, cond_uturn_ok: bool, cond_above_ma60: bool):
    """단계 라벨링.
    - 골든크로스 미발생 + U턴 검증 충족 + 종가 60일선 위 → '바닥 관찰'
    - 골든크로스 0~1일 전 → 'U턴 시도'
    - 골든크로스 2~5일 전 → 'U턴 확인'
    - 골든크로스 6일+ 전 → '추세전환 후보'
    - 그 외 → None
    """
    if golden_days_ago is None:
        if cond_uturn_ok and cond_above_ma60:
            return "바닥 관찰"
        return None
    try:
        gda = int(golden_days_ago)
    except (TypeError, ValueError):
        return None
    if gda <= 1:
        return "U턴 시도"
    if gda <= 5:
        return "U턴 확인"
    return "추세전환 후보"


def bottom_evidence(r: dict) -> list[str]:
    """바닥 U턴 후보의 근거 라벨 목록(단순 낙폭 X — 다중 조건 합산)."""
    ev: list[str] = []
    if r.get("cond_uturn_ok"):
        ev.append(f"U턴 검증 충족(60일 중 아래 {r.get('days_below_ma60', '-')}일)")
    vr = r.get("value_ratio")
    if vr is not None and vr >= 1.5:
        ev.append(f"거래대금 회복 ({vr:.1f}배)")
    if r.get("cond_value_ok"):
        ev.append("20일 평균 거래대금 충족")
    if r.get("cond_ma60_rising"):
        ev.append("60일선 상승 중")
    if r.get("cond_lagging_ok"):
        ev.append("후행스팬 정상")
    if r.get("cond_cloud_red"):
        ev.append("일목 양운")
    if r.get("cond_above_ma60"):
        ev.append("종가 60일선 위")
    return ev


def chase_risk_reasons(r: dict) -> list[str]:
    """추격 위험 강화 라벨의 사유 (가산 신호)."""
    reasons: list[str] = []
    disp = r.get("disparity_pct")
    if disp is not None:
        if disp >= 25:
            reasons.append(f"이격 +{disp:.1f}% (큰 폭)")
        elif disp >= 20:
            reasons.append(f"이격 +{disp:.1f}%")
    up = r.get("upside_pct")
    if up is not None and up < 5:
        reasons.append("60일 고가 근접(상승여력 작음)")
    rr = r.get("rr_ratio")
    if rr is not None and rr < 0.5:
        reasons.append(f"손익비 작음({rr:.2f})")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser(description="사이드카: 바닥 U턴 / 추격 위험 / 단계 라벨 → JSON")
    parser.add_argument("--report-type", choices=["daily", "weekly"], default="daily",
                        help="기본 daily (윈도우 5). weekly 는 윈도우 10.")
    args = parser.parse_args()
    report_type = args.report_type
    golden_window = 10 if report_type == "weekly" else GOLDEN_WINDOW

    print(f"[scan_dump] 시작 (report_type={report_type}, golden_window={golden_window})")

    print("종목 마스터 로드…")
    stocks = fetch_stocks()
    print(f"  ✓ {len(stocks)}개")

    print("시장 지수 상태 조회…")
    market_status, market_returns = fetch_market_index_data()
    market_flow = (
        "강세 흐름" if (market_status.get("KOSPI", False) and market_status.get("KOSDAQ", False))
        else "약세 흐름" if (not market_status.get("KOSPI", False) and not market_status.get("KOSDAQ", False))
        else "중립 흐름"
    )
    print(f"  KOSPI 60일선 {'위' if market_status.get('KOSPI', False) else '아래'}"
          f" / 20일 수익률 {market_returns.get('KOSPI', float('nan')):+.2f}%")
    print(f"  KOSDAQ 60일선 {'위' if market_status.get('KOSDAQ', False) else '아래'}"
          f" / 20일 수익률 {market_returns.get('KOSDAQ', float('nan')):+.2f}%")
    print(f"  전체 흐름: {market_flow}")

    print("뉴스 리스크 조회…")
    try:
        news_risks = fetch_news_risks()
    except Exception as e:
        print(f"  ⚠️ news_risks 조회 실패({str(e)[:80]}) — 빈 dict로 진행")
        news_risks = {}
    critical_set = {t for t, v in news_risks.items() if isinstance(v, dict) and v.get("level") == "CRITICAL"}
    print(f"  CRITICAL {len(critical_set)}개")

    print("일봉 데이터 로드 (캐시 우선)…")
    prices_map = fetch_all_prices(use_cache=True)

    print("섹터 20일 수익률 산출 (run_scan과 동일 산식)…")
    sector_returns_map = compute_sector_20d_returns(stocks, prices_map)
    print(f"  ✓ {len(sector_returns_map)}개 섹터 (표본 3+)")

    print("종목별 analyze() 호출…")
    all_results: list[dict] = []
    base_date = None
    for _, srow in stocks.iterrows():
        ticker = srow["ticker"]
        name = srow["name"]
        market_cap = srow["market_cap"]
        stock_market = srow.get("market", "KOSPI")
        sector = srow.get("sector")
        market_above_ma60 = market_status.get(stock_market, False)
        market_20d = market_returns.get(stock_market)
        sector_20d = sector_returns_map.get(sector) if sector else None

        df = prices_map.get(ticker)
        if df is None or df.empty:
            continue

        r = analyze(
            df, market_cap,
            market_above_ma60=market_above_ma60,
            golden_window=golden_window,
            market_20d_return=market_20d,
            sector_20d_return=sector_20d,
        )
        if r is None:
            continue
        r["ticker"] = ticker
        r["name"] = name
        r["market"] = stock_market
        r["sector"] = sector
        if base_date is None:
            base_date = r.get("_base_date")
        all_results.append(r)

    print(f"  ✓ {len(all_results)}개 종목 분석 완료 (base_date={base_date})")

    # ── 단계 라벨 / 바닥 U턴 / 추격 위험 강화 ──
    print("단계 라벨링·분류…")
    candidates_bottom: list[dict] = []
    chase_risk_strong: list[dict] = []
    all_stage_labels: list[dict] = []

    for r in all_results:
        gda = r.get("golden_days_ago")
        cond_uturn = bool(r.get("cond_uturn_ok"))
        cond_above = bool(r.get("cond_above_ma60"))
        stage = stage_label(gda, cond_uturn, cond_above)
        is_critical = r["ticker"] in critical_set

        all_stage_labels.append({
            "ticker": r["ticker"],
            "name": r["name"],
            "market": r["market"],
            "sector": r.get("sector"),
            "stage": stage,
            "final_grade_from_run_scan": r.get("final_grade"),
            "score_from_run_scan": _f(r.get("score")),
            "news_critical": is_critical,
        })

        # 바닥 U턴 후보: 단순 낙폭 종목 배제 — 강화 체크
        if stage in ("바닥 관찰", "U턴 시도", "U턴 확인") and cond_uturn:
            vr = r.get("value_ratio")
            value_recovering = (vr is not None) and (vr >= 1.2)
            ma60_rising = bool(r.get("cond_ma60_rising"))
            # 거래대금 회복 또는 60일선 상승 시작 중 하나는 있어야 후보로 노출
            if value_recovering or ma60_rising or cond_above:
                candidates_bottom.append({
                    "ticker": r["ticker"],
                    "name": r["name"],
                    "market": r["market"],
                    "sector": r.get("sector"),
                    "stage": stage,
                    "close": _f(r.get("close")),
                    "ma60": _f(r.get("ma60")),
                    "disparity_pct": _f(r.get("disparity_pct")),
                    "golden_days_ago": _i(r.get("golden_days_ago")),
                    "days_below_ma60_60d": _i(r.get("days_below_ma60")),
                    "value_ratio": _f(r.get("value_ratio")),
                    "avg_value_20_eok": (
                        round(_f(r.get("avg_value_20")) / 1e8, 1)
                        if _f(r.get("avg_value_20")) is not None else None
                    ),
                    "checks": {
                        "uturn_ok": cond_uturn,
                        "value_recovering": value_recovering,
                        "ma60_rising": ma60_rising,
                        "lagging_ok": bool(r.get("cond_lagging_ok")),
                        "cloud_red": bool(r.get("cond_cloud_red")),
                        "above_ma60": cond_above,
                        "value_ok": bool(r.get("cond_value_ok")),
                    },
                    "evidence": bottom_evidence(r),
                    "final_grade_from_run_scan": r.get("final_grade"),
                    "news_critical": is_critical,
                })

        # 추격 위험 강화 (run_scan의 CHASE_RISK 등급 + 추가 사유)
        if r.get("final_grade") == "CHASE_RISK":
            reasons = chase_risk_reasons(r)
            if reasons:
                chase_risk_strong.append({
                    "ticker": r["ticker"],
                    "name": r["name"],
                    "market": r["market"],
                    "sector": r.get("sector"),
                    "close": _f(r.get("close")),
                    "disparity_pct": _f(r.get("disparity_pct")),
                    "upside_pct": _f(r.get("upside_pct")),
                    "rr_ratio": _f(r.get("rr_ratio")),
                    "reasons": reasons,
                    "news_critical": is_critical,
                })

    # 정렬
    candidates_bottom.sort(
        key=lambda x: (x.get("days_below_ma60_60d") or 0, x.get("value_ratio") or 0),
        reverse=True,
    )
    chase_risk_strong.sort(key=lambda x: (x.get("disparity_pct") or 0), reverse=True)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "report_type": report_type,
        "base_date": str(base_date) if base_date else None,
        "market": {
            "kospi_above_ma60": bool(market_status.get("KOSPI", False)),
            "kosdaq_above_ma60": bool(market_status.get("KOSDAQ", False)),
            "kospi_20d_return": _f(market_returns.get("KOSPI")),
            "kosdaq_20d_return": _f(market_returns.get("KOSDAQ")),
            "flow": market_flow,
        },
        "candidates_bottom": candidates_bottom,
        "chase_risk_strong": chase_risk_strong,
        "all_stage_labels": all_stage_labels,
        "summary": {
            "n_analyzed": len(all_results),
            "n_candidates_bottom": len(candidates_bottom),
            "n_chase_risk_strong": len(chase_risk_strong),
            "n_critical_in_bottom": sum(1 for c in candidates_bottom if c["news_critical"]),
            "stage_counts": {
                "바닥 관찰": sum(1 for s in all_stage_labels if s["stage"] == "바닥 관찰"),
                "U턴 시도": sum(1 for s in all_stage_labels if s["stage"] == "U턴 시도"),
                "U턴 확인": sum(1 for s in all_stage_labels if s["stage"] == "U턴 확인"),
                "추세전환 후보": sum(1 for s in all_stage_labels if s["stage"] == "추세전환 후보"),
            },
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)

    print(f"\n✓ JSON 저장: {OUTPUT_FILE}")
    print(f"  바닥 U턴 후보 {len(candidates_bottom)}개 / "
          f"추격 위험 강화 {len(chase_risk_strong)}개 / "
          f"단계 라벨 전체 {len(all_stage_labels)}개")


if __name__ == "__main__":
    main()
