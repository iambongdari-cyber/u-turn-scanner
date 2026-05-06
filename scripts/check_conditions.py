"""
check_conditions.py
적재된 일봉 데이터로 U턴 종목 필수 5조건을 계산해서 콘솔에 출력한다.

[필수 5조건]
1. 골든크로스      : 10일선이 60일선을 최근 5거래일 안에 상향 돌파했는지
2. 종가 60일선 위  : 오늘 종가가 60일선 위에 있는지
3. 60일선 상승 중  : 오늘 60일선이 5거래일 전보다 높은지 (= 60일선이 우상향)
4. 후행스팬 60일선 위 : 오늘 종가 > 26거래일 전의 60일선
                        (= 일목 후행스팬을 그렸을 때 60일선 위에 있는지를 단순화)
5. 앞 구름 붉음    : 일목균형표 선행스팬 A > 선행스팬 B
                    (= 미래에 그려질 구름이 양운(붉은색)인지)

모든 계산은 KRX 정규장 종가 기준. Supabase에서 SELECT만 하고 DB 쓰기는 안 한다.
"""
import os
import sys
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
}

# 일일 리포트 기준: 골든크로스 윈도우 5거래일
GOLDEN_WINDOW = 5


# ── Supabase에서 데이터 가져오기 ──────────────────────────────────
def fetch_stocks() -> pd.DataFrame:
    """stocks 테이블의 모든 종목을 ticker 순서로 조회."""
    r = requests.get(
        f"{REST_URL}/stocks",
        headers=HEADERS,
        params={"select": "ticker,name,market", "order": "ticker.asc"},
        timeout=30,
    )
    r.raise_for_status()
    return pd.DataFrame(r.json())


def fetch_prices(ticker: str) -> pd.DataFrame:
    """한 종목의 모든 일봉을 날짜 오름차순으로 조회.
    Supabase는 한 번에 최대 1000행이라 페이지네이션."""
    all_rows: list[dict] = []
    offset = 0
    PAGE = 1000
    while True:
        r = requests.get(
            f"{REST_URL}/daily_prices",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={
                "select": "date,open,high,low,close,volume",
                "ticker": f"eq.{ticker}",
                "order": "date.asc",
            },
            timeout=30,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        all_rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE

    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


# ── 일목균형표 (라이브러리 없이 직접 구현) ────────────────────────
def ichimoku_components(df: pd.DataFrame) -> dict:
    """일목균형표의 핵심 4개 라인을 pandas Series로 반환.

    - 전환선(9):    최근 9일의 (최고가 + 최저가) / 2
    - 기준선(26):   최근 26일의 (최고가 + 최저가) / 2
    - 선행스팬A:    (전환선 + 기준선) / 2
                   (실제 차트는 26일 앞으로 이동시켜 그리지만,
                    값 자체는 오늘 시점의 계산을 사용해 비교한다)
    - 선행스팬B:    최근 52일의 (최고가 + 최저가) / 2
    """
    high, low = df["high"], df["low"]
    tenkan = (high.rolling(9).max()  + low.rolling(9).min())  / 2     # 전환선
    kijun  = (high.rolling(26).max() + low.rolling(26).min()) / 2     # 기준선
    span_a = (tenkan + kijun) / 2                                     # 선행스팬 A
    span_b = (high.rolling(52).max() + low.rolling(52).min()) / 2     # 선행스팬 B
    return {"tenkan": tenkan, "kijun": kijun, "span_a": span_a, "span_b": span_b}


# ── 필수 5조건 계산 ──────────────────────────────────────────────
def check_five_conditions(df: pd.DataFrame, golden_window: int = GOLDEN_WINDOW) -> dict:
    """일봉 DataFrame(date 오름차순)에서 필수 5조건의 True/False를 계산.

    데이터가 60일 미만이면 60일선을 못 구하므로 모두 False.
    """
    n = len(df)
    if n < 60:
        return {
            "cond_golden":      False,
            "cond_above_ma60":  False,
            "cond_ma60_rising": False,
            "cond_lagging_ok":  False,
            "cond_cloud_red":   False,
            "_note": f"데이터 부족({n}일)",
        }

    close = df["close"]
    ma10  = close.rolling(10).mean()
    ma60  = close.rolling(60).mean()
    ichi  = ichimoku_components(df)

    t = n - 1   # 가장 최근일 인덱스

    # ── 1) 골든크로스: 최근 N거래일 안에 ma10이 ma60을 상향 돌파한 적이 있나
    cond_golden = False
    start_i = max(1, t - golden_window + 1)
    for i in range(start_i, t + 1):
        prev_below = (
            pd.notna(ma10.iat[i-1]) and pd.notna(ma60.iat[i-1])
            and ma10.iat[i-1] <= ma60.iat[i-1]
        )
        curr_above = (
            pd.notna(ma10.iat[i]) and pd.notna(ma60.iat[i])
            and ma10.iat[i] > ma60.iat[i]
        )
        if prev_below and curr_above:
            cond_golden = True
            break

    # ── 2) 종가 60일선 위
    cond_above_ma60 = (
        pd.notna(close.iat[t]) and pd.notna(ma60.iat[t])
        and close.iat[t] > ma60.iat[t]
    )

    # ── 3) 60일선 상승 중: 오늘 ma60 > 5거래일 전 ma60
    cond_ma60_rising = False
    if t >= 5 and pd.notna(ma60.iat[t]) and pd.notna(ma60.iat[t-5]):
        cond_ma60_rising = ma60.iat[t] > ma60.iat[t-5]

    # ── 4) 후행스팬 60일선 위: 오늘 종가 > 26거래일 전의 ma60
    cond_lagging_ok = False
    if t >= 26 and pd.notna(close.iat[t]) and pd.notna(ma60.iat[t-26]):
        cond_lagging_ok = close.iat[t] > ma60.iat[t-26]

    # ── 5) 앞 구름 붉음: 선행스팬 A > 선행스팬 B (오늘 시점 값)
    cond_cloud_red = False
    if pd.notna(ichi["span_a"].iat[t]) and pd.notna(ichi["span_b"].iat[t]):
        cond_cloud_red = ichi["span_a"].iat[t] > ichi["span_b"].iat[t]

    return {
        "cond_golden":      bool(cond_golden),
        "cond_above_ma60":  bool(cond_above_ma60),
        "cond_ma60_rising": bool(cond_ma60_rising),
        "cond_lagging_ok":  bool(cond_lagging_ok),
        "cond_cloud_red":   bool(cond_cloud_red),
    }


# ── 메인: 종목별 결과 출력 ──────────────────────────────────────
def main() -> None:
    print("종목 마스터 로드…")
    stocks = fetch_stocks()
    print(f"  ✓ {len(stocks)}개 종목\n")

    header = (
        f"{'#':>2}  {'코드':<7} {'종목명':<14}"
        f"  {'GC':^4}{'>60':^4}{'↑60':^4}{'후행':^4}{'구름':^4}"
        f"   기준일       종가     MA60       판정"
    )
    print(header)
    print("-" * len(header))

    passed = []
    rows_out = []

    for i, srow in stocks.iterrows():
        ticker = srow["ticker"]
        name   = srow["name"]
        df = fetch_prices(ticker)

        if df.empty:
            print(f"{i+1:>2}  {ticker:<7} {name:<14}  (데이터 없음)")
            continue

        c = check_five_conditions(df)
        all_pass = (
            c["cond_golden"] and c["cond_above_ma60"] and c["cond_ma60_rising"]
            and c["cond_lagging_ok"] and c["cond_cloud_red"]
        )

        last_date  = df["date"].iat[-1].date()
        last_close = df["close"].iat[-1]
        last_ma60  = df["close"].rolling(60).mean().iat[-1]

        mark = lambda b: "○" if b else "·"
        print(
            f"{i+1:>2}  {ticker:<7} {name:<14}"
            f"  {mark(c['cond_golden']):^4}{mark(c['cond_above_ma60']):^4}"
            f"{mark(c['cond_ma60_rising']):^4}{mark(c['cond_lagging_ok']):^4}"
            f"{mark(c['cond_cloud_red']):^4}"
            f"   {last_date}  {int(last_close):>7}"
            f"  {int(last_ma60) if pd.notna(last_ma60) else 0:>7}   "
            f"{'★ 5조건 통과' if all_pass else ''}"
        )
        rows_out.append({
            "ticker": ticker, "name": name,
            **c, "all_pass": all_pass,
            "close": last_close, "ma60": last_ma60,
        })
        if all_pass:
            passed.append((ticker, name))

    print()
    print("=" * len(header))
    if passed:
        print(f"5조건 모두 통과 종목: {len(passed)}개")
        for ticker, name in passed:
            print(f"  ★ {ticker} {name}")
    else:
        print("5조건 모두 통과 종목: 없음")
        print("  (관심종목 20개로는 한 시점에 5조건 모두 만족하기 어렵습니다.")
        print("   조건별 통과 개수를 보고 어디서 막혔는지 확인해 보세요.)")

    # 조건별 통과 통계 (디버깅에 도움)
    if rows_out:
        df_out = pd.DataFrame(rows_out)
        print()
        print("조건별 통과 종목 수:")
        for col in ["cond_golden","cond_above_ma60","cond_ma60_rising",
                    "cond_lagging_ok","cond_cloud_red"]:
            n_pass = int(df_out[col].sum())
            print(f"  {col:20s}: {n_pass:>2} / {len(df_out)}")


if __name__ == "__main__":
    main()