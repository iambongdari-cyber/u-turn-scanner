"""
run_scan.py
필수 5조건 + 추가 4조건 + 100점 점수화를 적용해 TOP 10을 scan_results에 저장.

[흐름]
  1) stocks 전체 + 종목별 daily_prices 로드
  2) 종목마다 analyze() 로 5조건/추가조건/점수/계산값 계산
  3) 통과 종목을 점수 내림차순 정렬, TOP 10
  4) reports UPSERT (report_type=daily, base_date=오늘 거래일)
  5) scan_results UPSERT (report_id, ticker)

KRX 정규장 종가 기준. 시장지수/업종은 MVP에선 미적용(17~18단계).
"""
import argparse
import os
import sys
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

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
}

# ── 파라미터 ────────────────────────────────────────────────────
GOLDEN_WINDOW            = 5             # 일일 리포트: 5거래일
MIN_AVG_VALUE_20         = 10  * 10**8   # 10억 원
MIN_MARKET_CAP           = 1000 * 10**8  # 1000억 원
MAX_DISPARITY_PCT        = 20.0
MIN_DAYS_BELOW_MA60_60D  = 10            # U턴 검증용
TOP_N                    = 10


# ── DB 헬퍼 ─────────────────────────────────────────────────────
def fetch_stocks() -> pd.DataFrame:
    """stocks 전체 조회. Supabase는 한 번에 최대 1000행이라 페이지네이션 필수."""
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker,name,market,market_cap,sector",
                    "order": "ticker.asc"},
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
    return pd.DataFrame(rows)


def fetch_market_index_data() -> tuple[dict[str, bool], dict[str, float]]:
    """market_indices 에서 KOSPI/KOSDAQ의 (ma60 위 여부, 20거래일 수익률%) 반환.

    반환:
      ma60_status: {'KOSPI': True/False, 'KOSDAQ': True/False}
      returns_20d: {'KOSPI': 5.3, 'KOSDAQ': -2.1}  (% 단위)
    """
    ma60_status: dict[str, bool] = {}
    returns_20d: dict[str, float] = {}
    for index_name in ("KOSPI", "KOSDAQ"):
        r = requests.get(
            f"{REST_URL}/market_indices",
            headers=HEADERS,
            params={
                "select": "date,close",
                "index_name": f"eq.{index_name}",
                "order": "date.desc",
                "limit": "60",
            },
            timeout=30,
        )
        if not r.ok:
            ma60_status[index_name] = False
            continue
        rows = r.json()
        if len(rows) < 60:
            ma60_status[index_name] = False
            continue
        # rows[0]이 최신, rows[59]가 60일 전
        closes = [float(row["close"]) for row in rows]
        today_close = closes[0]
        ma60 = sum(closes) / 60
        ma60_status[index_name] = today_close > ma60
        # 20일 수익률: (오늘 - 20거래일 전) / 20거래일 전 * 100
        if len(closes) >= 21 and closes[20] > 0:
            returns_20d[index_name] = (closes[0] - closes[20]) / closes[20] * 100
    return ma60_status, returns_20d


def fetch_all_prices() -> dict[str, pd.DataFrame]:
    """daily_prices 전체를 한 번에 가져와 ticker별 DataFrame dict로 반환.
    종목별로 따로 HTTP 호출하는 것보다 훨씬 빠르다 (수천 번 → 수백 번)."""
    print("일봉 데이터 일괄 로드…")
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/daily_prices",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "ticker,date,open,high,low,close,volume,trade_value",
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
    print(f"  ✓ {len(rows)}행 로드 완료")

    if not rows:
        return {}

    big = pd.DataFrame(rows)
    big["date"] = pd.to_datetime(big["date"])
    for c in ["open", "high", "low", "close", "volume", "trade_value"]:
        big[c] = pd.to_numeric(big[c], errors="coerce")

    result: dict[str, pd.DataFrame] = {}
    for ticker, g in big.groupby("ticker"):
        result[ticker] = g.sort_values("date").reset_index(drop=True)
    return result


def upsert_report(report_type: str, base_date: date, is_final: bool = True) -> str:
    """reports UPSERT 후 id 반환."""
    payload = [{
        "report_type": report_type,
        "base_date": base_date.isoformat(),
        "is_final": is_final,
    }]
    r = requests.post(
        f"{REST_URL}/reports",
        headers={**HEADERS,
                 "Prefer": "resolution=merge-duplicates,return=representation"},
        params={"on_conflict": "report_type,base_date"},
        json=payload,
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"reports UPSERT 실패 ({r.status_code}): {r.text}")
    data = r.json()
    if isinstance(data, list) and data:
        return data[0]["id"]
    # 폴백: SELECT
    r2 = requests.get(
        f"{REST_URL}/reports",
        headers=HEADERS,
        params={
            "select": "id",
            "report_type": f"eq.{report_type}",
            "base_date": f"eq.{base_date.isoformat()}",
        },
        timeout=30,
    )
    r2.raise_for_status()
    return r2.json()[0]["id"]


def upsert_scan_results(rows: list[dict]) -> None:
    if not rows:
        return
    r = requests.post(
        f"{REST_URL}/scan_results",
        headers={**HEADERS,
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"scan_results UPSERT 실패 ({r.status_code}): {r.text[:300]}")


# ── 일목균형표 ───────────────────────────────────────────────────
def ichimoku(df: pd.DataFrame) -> dict:
    high, low = df["high"], df["low"]
    tenkan = (high.rolling(9).max()  + low.rolling(9).min())  / 2
    kijun  = (high.rolling(26).max() + low.rolling(26).min()) / 2
    span_a = (tenkan + kijun) / 2
    span_b = (high.rolling(52).max() + low.rolling(52).min()) / 2
    return {"tenkan": tenkan, "kijun": kijun, "span_a": span_a, "span_b": span_b}


# ── 종목 분석 ────────────────────────────────────────────────────
def analyze(df: pd.DataFrame, market_cap, market_above_ma60: bool = True,
            golden_window: int = GOLDEN_WINDOW,
            market_20d_return: float | None = None,
            sector_20d_return: float | None = None) -> dict | None:
    n = len(df)
    if n < 60:
        return None

    close, high, low, volume, tv_raw = df["close"], df["high"], df["low"], df["volume"], df["trade_value"]
    ma10 = close.rolling(10).mean()
    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()
    ich  = ichimoku(df)

    t = n - 1
    today_close = close.iat[t]
    today_ma60  = ma60.iat[t]

    # 거래대금 NULL → close*volume으로 근사
    tv = tv_raw.where(tv_raw.notna(), close * volume)

    # ── 필수 5조건 ──
    cond_golden = False
    golden_date = None
    golden_days_ago = None
    for i in range(max(1, t - golden_window + 1), t + 1):
        if (pd.notna(ma10.iat[i-1]) and pd.notna(ma60.iat[i-1])
            and ma10.iat[i-1] <= ma60.iat[i-1]
            and pd.notna(ma10.iat[i]) and pd.notna(ma60.iat[i])
            and ma10.iat[i] > ma60.iat[i]):
            cond_golden = True
            golden_date = df["date"].iat[i].date()
            golden_days_ago = t - i
            break

    cond_above_ma60  = pd.notna(today_ma60) and today_close > today_ma60
    cond_ma60_rising = (
        t >= 5 and pd.notna(ma60.iat[t]) and pd.notna(ma60.iat[t-5])
        and ma60.iat[t] > ma60.iat[t-5]
    )
    cond_lagging_ok = (
        t >= 26 and pd.notna(ma60.iat[t-26]) and today_close > ma60.iat[t-26]
    )
    cond_cloud_red = (
        pd.notna(ich["span_a"].iat[t]) and pd.notna(ich["span_b"].iat[t])
        and ich["span_a"].iat[t] > ich["span_b"].iat[t]
    )

    # ── 계산값 ──
    disparity_pct = (today_close - today_ma60) / today_ma60 * 100 if pd.notna(today_ma60) else None
    avg_value_20  = tv.tail(20).dropna().mean() if t >= 19 else None

    # 60일선 상승 강도(20거래일)
    rising_strength = None
    if t >= 20 and pd.notna(ma60.iat[t]) and pd.notna(ma60.iat[t-20]) and ma60.iat[t-20] > 0:
        rising_strength = (ma60.iat[t] - ma60.iat[t-20]) / ma60.iat[t-20]

    # 거래대금 증가 비율
    today_tv = tv.iat[t]
    value_ratio = (today_tv / avg_value_20) if (avg_value_20 and pd.notna(today_tv) and avg_value_20 > 0) else None

    # 최근 60일 중 종가 < ma60 였던 일수 (U턴 검증)
    last60_close = close.iloc[max(0, t-59):t+1]
    last60_ma60  = ma60.iloc[max(0, t-59):t+1]
    days_below_ma60 = int(((last60_close < last60_ma60) & last60_ma60.notna()).sum())

    # 매수 후보가 / 손절 / 상승여력 / 손익비
    buy1_price = ma10.iat[t]
    buy2_price = ma20.iat[t]
    recent_low_20 = low.iloc[max(0, t-19):t+1].min()
    recent_high_60 = high.iloc[max(0, t-59):t+1].max()
    stop_loss = None
    if pd.notna(recent_low_20) and pd.notna(today_ma60):
        stop_loss = float(max(recent_low_20, today_ma60))
    upside_pct = None
    if pd.notna(recent_high_60) and today_close > 0:
        upside_pct = (recent_high_60 - today_close) / today_close * 100
    rr_ratio = None
    if stop_loss and stop_loss > 0 and today_close > 0 and upside_pct is not None:
        stop_loss_pct = (today_close - stop_loss) / today_close * 100
        if stop_loss_pct > 0:
            rr_ratio = upside_pct / stop_loss_pct

    # ── 추가 조건 ──
    cond_disp_ok    = disparity_pct is not None and disparity_pct <= MAX_DISPARITY_PCT
    cond_value_ok   = avg_value_20 is not None and avg_value_20 >= MIN_AVG_VALUE_20
    cond_cap_ok     = (market_cap is None) or (market_cap >= MIN_MARKET_CAP)
    cond_uturn_ok   = days_below_ma60 >= MIN_DAYS_BELOW_MA60_60D

    # ── 점수화 (100점 만점) ──
    score = 0.0
    # 골든크로스 최근일수록 (15)
    if cond_golden and golden_days_ago is not None:
        score += 15 * (1 - golden_days_ago / golden_window)
    # 60일선 상승 강도 (15)
    if rising_strength is not None and rising_strength > 0:
        score += min(15.0, rising_strength * 300)   # 5% 상승이면 만점
    # 후행스팬 (10)
    if cond_lagging_ok: score += 10
    # 앞 구름 (10)
    if cond_cloud_red:  score += 10
    # 이격도 양호 (10)
    if disparity_pct is not None:
        if   disparity_pct <= 5:  score += 10
        elif disparity_pct <= 10: score += 8
        elif disparity_pct <= 15: score += 5
        elif disparity_pct <= 20: score += 2
    # 거래대금 충족 (10)
    if cond_value_ok:   score += 10
    # 거래량/거래대금 증가 (10)
    if value_ratio is not None:
        if   value_ratio >= 2.0: score += 10
        elif value_ratio >= 1.5: score += 8
        elif value_ratio >= 1.0: score += 5
    # 시장지수 60일선 위 (5)
    if market_above_ma60: score += 5
    # 종목 20일 수익률 (시장/업종 상대강도 비교용)
    stock_20d_return = None
    if t >= 20 and pd.notna(close.iat[t-20]) and close.iat[t-20] > 0:
        stock_20d_return = (close.iat[t] - close.iat[t-20]) / close.iat[t-20] * 100
    # 시장 대비 상대강도 (5)
    if (stock_20d_return is not None and market_20d_return is not None
            and stock_20d_return > market_20d_return):
        score += 5
    # 업종 상대강도 (5)
    if (stock_20d_return is not None and sector_20d_return is not None
            and stock_20d_return > sector_20d_return):
        score += 5
    # 손익비 (5)
    if rr_ratio is not None:
        if   rr_ratio >= 2.0: score += 5
        elif rr_ratio >= 1.5: score += 3
        elif rr_ratio >= 1.0: score += 1

    score = round(score, 2)

    # ── MVP 점수 보정 ──
    # 시장 대비 상대강도(5점)는 17단계에서, 업종 상대강도(5점)는 18단계에서 연결.
    # 두 지표 모두 데이터가 있어야만 점수 부여되므로, 데이터 없으면 자연스럽게 미부여.
    # 따라서 별도 보정 없이 기획서 그대로 100점 만점 운용.

    # ── 필수 통과 + 최종 판정 ──
    must_pass = cond_golden and cond_above_ma60 and cond_ma60_rising
    if not must_pass:
        final_grade = "EXCLUDE"
    elif disparity_pct is not None and disparity_pct > 20:
        final_grade = "CHASE_RISK"
    elif score >= 90: final_grade = "A"
    elif score >= 80: final_grade = "B"
    elif score >= 70: final_grade = "WATCH"
    else:             final_grade = "EXCLUDE"

    # ── 한 줄 설명 ──
    gc_part = (f"{golden_days_ago}거래일 전 골든크로스"
               if cond_golden and golden_days_ago is not None
               else "최근 골든크로스 없음")
    disp_part = f"60일선 대비 {disparity_pct:+.1f}%" if disparity_pct is not None else "이격도 정보 없음"
    val_part  = (f"거래대금 20일평균 대비 {value_ratio:.1f}배"
                 if value_ratio is not None else "거래대금 정보 부족")
    one_line = f"{gc_part}, {disp_part}, {val_part}."

    return {
        "score": score,
        "cond_golden": bool(cond_golden), "cond_above_ma60": bool(cond_above_ma60),
        "cond_ma60_rising": bool(cond_ma60_rising), "cond_lagging_ok": bool(cond_lagging_ok),
        "cond_cloud_red": bool(cond_cloud_red),
        "cond_disp_ok": bool(cond_disp_ok), "cond_value_ok": bool(cond_value_ok),
        "cond_cap_ok": bool(cond_cap_ok), "cond_uturn_ok": bool(cond_uturn_ok),
        "close": float(today_close) if pd.notna(today_close) else None,
        "ma10": float(buy1_price) if pd.notna(buy1_price) else None,
        "ma20": float(buy2_price) if pd.notna(buy2_price) else None,
        "ma60": float(today_ma60) if pd.notna(today_ma60) else None,
        "disparity_pct": float(disparity_pct) if disparity_pct is not None else None,
        "golden_date": golden_date.isoformat() if golden_date else None,
        "golden_days_ago": golden_days_ago,
        "trade_value": int(today_tv) if pd.notna(today_tv) else None,
        "avg_value_20": int(avg_value_20) if avg_value_20 is not None and pd.notna(avg_value_20) else None,
        "stop_loss": stop_loss,
        "upside_pct": float(upside_pct) if upside_pct is not None else None,
        "rr_ratio": float(rr_ratio) if rr_ratio is not None else None,
        "buy1_price": float(buy1_price) if pd.notna(buy1_price) else None,
        "buy2_price": float(buy2_price) if pd.notna(buy2_price) else None,
        "final_grade": final_grade,
        "one_line": one_line,
        "_must_pass": must_pass,
        "_extra_pass": cond_disp_ok and cond_value_ok and cond_cap_ok and cond_uturn_ok,
        "_base_date": df["date"].iat[t].date(),
        "days_below_ma60": days_below_ma60,
        "value_ratio": float(value_ratio) if value_ratio is not None else None,
    }

# ── 메인 ─────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description='U턴 스캔 (일일/주간)')
    parser.add_argument('--report-type', choices=['daily', 'weekly'],
                        default='daily', help='리포트 유형 (기본 daily)')
    args = parser.parse_args()
    report_type = args.report_type
    golden_window = 10 if report_type == 'weekly' else 5
    print(f"리포트 유형: {report_type} "
          f"(골든크로스 윈도우 {golden_window}거래일)\n")

    print("종목 마스터 로드…")
    stocks = fetch_stocks()
    print(f"  ✓ {len(stocks)}개 종목\n")

    print("시장지수 상태 조회…")
    market_status, market_returns = fetch_market_index_data()
    print(f"  KOSPI  60일선 {'위' if market_status.get('KOSPI', False) else '아래'} "
          f"/ 20일 수익률 {market_returns.get('KOSPI', float('nan')):+.2f}%")
    print(f"  KOSDAQ 60일선 {'위' if market_status.get('KOSDAQ', False) else '아래'} "
          f"/ 20일 수익률 {market_returns.get('KOSDAQ', float('nan')):+.2f}%\n")

    prices_map = fetch_all_prices()
    print()

    # 업종별 평균 20일 수익률 계산 (sector가 채워진 종목들만)
    print("업종별 평균 20일 수익률 계산…")
    sector_returns_20d: dict[str, float] = {}
    sector_groups: dict[str, list[float]] = {}
    for _, srow in stocks.iterrows():
        sector = srow.get("sector")
        if not sector or pd.isna(sector):
            continue
        df = prices_map.get(srow["ticker"])
        if df is None or len(df) < 21:
            continue
        close = df["close"]
        t = len(df) - 1
        prev = close.iat[t - 20]
        if pd.notna(prev) and prev > 0 and pd.notna(close.iat[t]):
            ret = (close.iat[t] - prev) / prev * 100
            sector_groups.setdefault(sector, []).append(ret)
    for sector, rets in sector_groups.items():
        if len(rets) >= 3:   # 표본 3개 이상인 업종만
            sector_returns_20d[sector] = sum(rets) / len(rets)
    print(f"  ✓ {len(sector_returns_20d)}개 업종 (표본 3+ )\n")

    print("종목별 분석…")
    analyzed = []
    base_date = None
    for _, srow in stocks.iterrows():
        ticker = srow["ticker"]
        name = srow["name"]
        market_cap = srow["market_cap"]
        stock_market = srow.get("market", "KOSPI")
        market_above_ma60 = market_status.get(stock_market, False)
        market_20d = market_returns.get(stock_market)
        # 업종 상대강도: 종목의 sector → 업종 평균 20일 수익률
        stock_sector = srow.get("sector")
        sector_20d = sector_returns_20d.get(stock_sector) if stock_sector and not pd.isna(stock_sector) else None
        df = prices_map.get(ticker)
        if df is None or df.empty:
            continue
        r = analyze(df, market_cap, market_above_ma60=market_above_ma60,
                    golden_window=golden_window,
                    market_20d_return=market_20d,
                    sector_20d_return=sector_20d)
        if r is None:
            continue
        r["ticker"], r["name"] = ticker, name
        analyzed.append(r)
        if base_date is None:
            base_date = r["_base_date"]
    print(f"  ✓ {len(analyzed)}개 종목 분석 완료\n")

    if not analyzed:
        print("분석 가능한 종목이 없습니다.")
        return

    # ── 통과 후보 ──
    # 필수 5조건 + (거래대금·시가총액·U턴) 통과 + EXCLUDE 아님.
    # 이격도 20% 초과(CHASE_RISK)는 제외하지 않고 "추격 주의"로 표시하며 포함한다.
    # (기획서 12장: 이격도 초과는 제외가 아니라 추격 주의 경고)
    candidates = [
        r for r in analyzed
        if r["cond_golden"] and r["cond_above_ma60"] and r["cond_ma60_rising"]
        and r["cond_lagging_ok"] and r["cond_cloud_red"]
        and r["cond_value_ok"] and r["cond_cap_ok"] and r["cond_uturn_ok"]
        and r["final_grade"] != "EXCLUDE"
    ]
    candidates.sort(key=lambda x: x["score"], reverse=True)
    top = candidates[:TOP_N]

    # ── TOP 출력 ──
    header = (f"{'순':>2}  {'코드':<7} {'종목명':<14} {'점수':>5}  {'판정':<10}  "
              f"{'GC경과':>6}  {'이격도':>6}  {'평균거래대금':>12}  {'손익비':>5}")
    print(header)
    print("-" * len(header))
    if not top:
        print("(조건 통과 종목 없음)")
    else:
        for rank, r in enumerate(top, 1):
            gc   = f"{r['golden_days_ago']}일전" if r['golden_days_ago'] is not None else "-"
            disp = f"{r['disparity_pct']:+.1f}%" if r['disparity_pct'] is not None else "-"
            val  = f"{r['avg_value_20']/1e8:.1f}억" if r['avg_value_20'] is not None else "-"
            rr   = f"{r['rr_ratio']:.2f}" if r['rr_ratio'] is not None else "-"
            print(f"{rank:>2}  {r['ticker']:<7} {r['name']:<14} {r['score']:>5.1f}  "
                  f"{r['final_grade']:<10}  {gc:>6}  {disp:>6}  {val:>12}  {rr:>5}")
        print()
        print("자동 한 줄 설명:")
        for r in top:
            print(f"  ★ {r['ticker']} {r['name']:<10}: {r['one_line']}")

# ── 5조건은 통과했는데 후보가 안 된 이유 진단 ──
    five_pass_only = [
        r for r in analyzed
        if r["cond_golden"] and r["cond_above_ma60"] and r["cond_ma60_rising"]
        and r["cond_lagging_ok"] and r["cond_cloud_red"]
    ]
    if five_pass_only:
        print()
        print("[5조건 통과 종목 진단] (추가조건 + 점수)")
        print(f"  {'코드':<7} {'종목명':<14} {'점수':>5}  {'판정':<10}  "
              f"{'이격':^4}{'대금':^4}{'시총':^4}{'U턴':^4}")
        print("  " + "-" * 65)
        for r in sorted(five_pass_only, key=lambda x: x['score'], reverse=True):
            m = lambda b: "○" if b else "·"
            print(f"  {r['ticker']:<7} {r['name']:<14} {r['score']:>5.1f}  "
                  f"{r['final_grade']:<10}  "
                  f"{m(r['cond_disp_ok']):^4}{m(r['cond_value_ok']):^4}"
                  f"{m(r['cond_cap_ok']):^4}{m(r['cond_uturn_ok']):^4}")

    # ── 분석 종목 전부의 분포 (디버깅 도움) ──
    print()
    print(f"전체 {len(analyzed)}개 분석 / 후보 {len(candidates)}개 / TOP {len(top)}개")
    print(f"  cond_disp_ok       : {sum(r['cond_disp_ok']  for r in analyzed):>2}/{len(analyzed)}")
    print(f"  cond_value_ok      : {sum(r['cond_value_ok'] for r in analyzed):>2}/{len(analyzed)}")
    print(f"  cond_cap_ok        : {sum(r['cond_cap_ok']   for r in analyzed):>2}/{len(analyzed)}")
    print(f"  cond_uturn_ok      : {sum(r['cond_uturn_ok'] for r in analyzed):>2}/{len(analyzed)}")

    # ── DB 저장 ──
    if not base_date:
        return
    print(f"\nreports + scan_results 저장 ({report_type}, base_date={base_date})…")
    report_id = upsert_report(report_type, base_date, is_final=True)
    if not top:
        # 통과 0개여도 reports는 만들고 scan_results는 비워둠
        print(f"  ✓ reports 생성됨 (id={report_id}). 후보 없음으로 scan_results는 비어있음.")
        return

    scan_rows = []
    for rank, r in enumerate(top, 1):
        scan_rows.append({
            "report_id": report_id,
            "ticker": r["ticker"],
            "rank": rank,
            "score": r["score"],
            "cond_golden": r["cond_golden"], "cond_above_ma60": r["cond_above_ma60"],
            "cond_ma60_rising": r["cond_ma60_rising"], "cond_lagging_ok": r["cond_lagging_ok"],
            "cond_cloud_red": r["cond_cloud_red"],
            "close": r["close"], "ma10": r["ma10"], "ma20": r["ma20"], "ma60": r["ma60"],
            "disparity_pct": r["disparity_pct"],
            "golden_date": r["golden_date"], "golden_days_ago": r["golden_days_ago"],
            "trade_value": r["trade_value"], "avg_value_20": r["avg_value_20"],
            "stop_loss": r["stop_loss"], "upside_pct": r["upside_pct"], "rr_ratio": r["rr_ratio"],
            "buy1_price": r["buy1_price"], "buy2_price": r["buy2_price"],
            "final_grade": r["final_grade"], "one_line": r["one_line"],
        })
    upsert_scan_results(scan_rows)
    print(f"  ✓ {len(scan_rows)}개 종목 저장 완료 (report_id={report_id})")


if __name__ == "__main__":
    main()