"""
generate_alerts.py
매일 배치 끝에 실행. 3가지 변동을 감지해 alerts 테이블 INSERT + alerts.log 추가.

[이벤트]
  NEW_CRITICAL       — 위험 공시 새로 등장 (30일 dedup)
  NEW_TOP            — 오늘 TOP 10 신규 진입 (14일 dedup)
  INTEREST_CRITICAL  — 관심종목(HIGH or CONSIDER)에 위험/주의 신호 (7일 dedup)

[출력]
  alerts 테이블 INSERT
  워크스페이스의 alerts.log 텍스트 파일 추가

매일 run_daily.bat 끝에 호출.
"""
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

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
}

# 워크스페이스 폴더의 alerts.log
LOG_PATH = Path(
    r"C:\Users\iambo\OneDrive\문서\Claude\Projects\60일 이동평균선 매매법\alerts.log"
)

# 동일 ticker+type 중복 방지 기간
DEDUP_DAYS = {
    "NEW_CRITICAL": 30,
    "NEW_TOP": 14,
    "INTEREST_CRITICAL": 7,
}


# ── 데이터 조회 ──────────────────────────────────────────────────
def fetch_news_risks() -> dict[str, dict]:
    risks: dict[str, dict] = {}
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/news_risks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker,level,latest_date,latest_title"},
            timeout=30,
        )
        if not r.ok:
            return {}
        page = r.json()
        if not page:
            break
        for row in page:
            risks[row["ticker"]] = row
        if len(page) < PAGE:
            break
        offset += PAGE
    return risks


def fetch_recent_alerts(days: int) -> list[dict]:
    since = (datetime.now() - timedelta(days=days)).isoformat()
    r = requests.get(
        f"{REST_URL}/alerts",
        headers={**HEADERS, "Range": "0-9999"},
        params={
            "select": "alert_type,ticker,created_at",
            "created_at": f"gte.{since}",
        },
        timeout=30,
    )
    if not r.ok:
        return []
    return r.json()


def fetch_latest_two_daily_reports() -> list[dict]:
    r = requests.get(
        f"{REST_URL}/reports",
        headers=HEADERS,
        params={
            "select": "id,base_date",
            "report_type": "eq.daily",
            "order": "base_date.desc",
            "limit": "2",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_report_rows(report_id: str) -> list[dict]:
    r = requests.get(
        f"{REST_URL}/scan_results",
        headers={**HEADERS, "Range": "0-99"},
        params={
            "select": "ticker,rank,score",
            "report_id": f"eq.{report_id}",
            "order": "rank.asc",
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_interest_stocks() -> list[dict]:
    """interest_level=HIGH 또는 my_decision=CONSIDER 인 종목 (ticker 중복 제거)."""
    r = requests.get(
        f"{REST_URL}/stock_notes",
        headers={**HEADERS, "Range": "0-9999"},
        params={
            "select": "ticker,interest_level,my_decision",
            "or": "(interest_level.eq.HIGH,my_decision.eq.CONSIDER)",
        },
        timeout=30,
    )
    if not r.ok:
        return []
    seen: set[str] = set()
    out: list[dict] = []
    for row in r.json():
        t = row["ticker"]
        if t in seen:
            continue
        seen.add(t)
        out.append(row)
    return out


def fetch_stock_names(tickers: list[str]) -> dict[str, str]:
    if not tickers:
        return {}
    names: dict[str, str] = {}
    # 안전을 위해 청크 처리
    CHUNK = 100
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i:i + CHUNK]
        in_list = ",".join(chunk)
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": "0-9999"},
            params={
                "select": "ticker,name",
                "ticker": f"in.({in_list})",
            },
            timeout=30,
        )
        if not r.ok:
            continue
        for row in r.json():
            names[row["ticker"]] = row["name"]
    return names


def insert_alerts(rows: list[dict]) -> None:
    if not rows:
        return
    r = requests.post(
        f"{REST_URL}/alerts",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json=rows,
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"alerts INSERT 실패 ({r.status_code}): {r.text[:300]}")


def append_log(text: str) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(text)
    except Exception as e:
        print(f"  ⚠️ alerts.log 쓰기 실패: {e}")


# ── 메인 ────────────────────────────────────────────────────────
def main():
    now = datetime.now()

    print("[1] news_risks 조회…")
    news = fetch_news_risks()
    n_crit = sum(1 for v in news.values() if v["level"] == "CRITICAL")
    n_warn = sum(1 for v in news.values() if v["level"] == "WARN")
    print(f"    CRITICAL {n_crit}개 / WARN {n_warn}개\n")

    print("[2] 최근 alerts 조회 (중복 방지)…")
    max_dedup = max(DEDUP_DAYS.values())
    recent = fetch_recent_alerts(max_dedup)
    recent_by_type: dict[str, set[str]] = {t: set() for t in DEDUP_DAYS}
    for a in recent:
        atype = a["alert_type"]
        if atype not in recent_by_type:
            continue
        # 타입별 dedup 기간 적용
        try:
            created = datetime.fromisoformat(a["created_at"].replace("Z", "+00:00"))
            created_naive = created.replace(tzinfo=None)
            days_old = (now - created_naive).days
        except Exception:
            days_old = 0
        if days_old <= DEDUP_DAYS[atype]:
            recent_by_type[atype].add(a["ticker"])
    print(f"    기존 NEW_CRITICAL {len(recent_by_type['NEW_CRITICAL'])}개 / "
          f"NEW_TOP {len(recent_by_type['NEW_TOP'])}개 / "
          f"INTEREST_CRITICAL {len(recent_by_type['INTEREST_CRITICAL'])}개\n")

    print("[3] 신규 이벤트 감지…")

    # ── A. NEW_CRITICAL ──
    new_critical: list[tuple[str, dict]] = []
    for ticker, info in news.items():
        if info["level"] != "CRITICAL":
            continue
        if ticker in recent_by_type["NEW_CRITICAL"]:
            continue
        new_critical.append((ticker, info))
    print(f"    NEW_CRITICAL:       {len(new_critical)}개")

    # ── B. NEW_TOP ──
    new_top_rows: list[dict] = []
    today_date = None
    reports = fetch_latest_two_daily_reports()
    if reports:
        today_id = reports[0]["id"]
        today_date = reports[0]["base_date"]
        today_rows = fetch_report_rows(today_id)
        today_tickers = {r["ticker"] for r in today_rows}
        yest_tickers: set[str] = set()
        if len(reports) >= 2:
            yest_rows = fetch_report_rows(reports[1]["id"])
            yest_tickers = {r["ticker"] for r in yest_rows}
        for r in today_rows:
            if r["ticker"] not in today_tickers - yest_tickers:
                continue
            if r["ticker"] in recent_by_type["NEW_TOP"]:
                continue
            new_top_rows.append(r)
    print(f"    NEW_TOP:            {len(new_top_rows)}개")

    # ── C. INTEREST_CRITICAL ──
    interest = fetch_interest_stocks()
    new_interest: list[tuple[str, dict, dict]] = []
    for s in interest:
        t = s["ticker"]
        risk = news.get(t)
        if risk is None:
            continue
        if t in recent_by_type["INTEREST_CRITICAL"]:
            continue
        new_interest.append((t, s, risk))
    print(f"    INTEREST_CRITICAL:  {len(new_interest)}개\n")

    # 종목명 일괄 조회
    all_tickers = list({
        *[t for t, _ in new_critical],
        *[r["ticker"] for r in new_top_rows],
        *[t for t, _, _ in new_interest],
    })
    names = fetch_stock_names(all_tickers)

    # alerts 행 구성
    new_alerts: list[dict] = []
    for ticker, info in new_critical:
        name = names.get(ticker, ticker)
        new_alerts.append({
            "alert_type": "NEW_CRITICAL",
            "ticker": ticker,
            "title": f"{name} ({ticker}) — 위험 공시",
            "detail": info.get("latest_title") or "",
            "severity": "CRITICAL",
            "base_date": info.get("latest_date"),
            "is_read": False,
        })
    for r in new_top_rows:
        ticker = r["ticker"]
        name = names.get(ticker, ticker)
        score = r.get("score")
        new_alerts.append({
            "alert_type": "NEW_TOP",
            "ticker": ticker,
            "title": f"{name} ({ticker}) — TOP 10 신규",
            "detail": f"순위 {r['rank']}" + (f", 점수 {float(score):.1f}" if score is not None else ""),
            "severity": "INFO",
            "base_date": today_date,
            "is_read": False,
        })
    for ticker, s, risk in new_interest:
        name = names.get(ticker, ticker)
        level = risk["level"]
        new_alerts.append({
            "alert_type": "INTEREST_CRITICAL",
            "ticker": ticker,
            "title": f"{name} ({ticker}) — 관심종목 위험 신호",
            "detail": f"{level} · {(risk.get('latest_title') or '')[:80]}",
            "severity": "CRITICAL" if level == "CRITICAL" else "WARN",
            "base_date": risk.get("latest_date"),
            "is_read": False,
        })

    print("[4] alerts 저장 + alerts.log 추가…")
    insert_alerts(new_alerts)
    print(f"    ✓ {len(new_alerts)}건 INSERT")

    if new_alerts:
        lines: list[str] = []
        lines.append("=" * 60 + "\n")
        lines.append(f"{now.strftime('%Y-%m-%d %H:%M')}  배치 실행 알림 요약\n")
        lines.append("=" * 60 + "\n\n")
        if new_critical:
            lines.append(f"[CRITICAL] 새 위험 공시 {len(new_critical)}건\n")
            for ticker, info in new_critical:
                name = names.get(ticker, ticker)
                title = (info.get("latest_title") or "")[:60]
                date_s = info.get("latest_date") or ""
                lines.append(f"  {ticker}  {name:<14}  {date_s}  {title}\n")
            lines.append("\n")
        if new_top_rows:
            lines.append(f"[INFO] 새 TOP 10 진입 {len(new_top_rows)}건\n")
            for r in new_top_rows:
                ticker = r["ticker"]
                name = names.get(ticker, ticker)
                score = r.get("score")
                sc_s = f"점수 {float(score):.1f}" if score is not None else ""
                lines.append(f"  {ticker}  {name:<14}  순위 {r['rank']}, {sc_s}\n")
            lines.append("\n")
        if new_interest:
            lines.append(f"[CRITICAL] 관심종목 위험 신호 {len(new_interest)}건\n")
            for ticker, s, risk in new_interest:
                name = names.get(ticker, ticker)
                title = (risk.get("latest_title") or "")[:60]
                lines.append(f"  {ticker}  {name:<14}  {risk['level']}  {title}\n")
            lines.append("\n")
        append_log("".join(lines))
        print(f"    ✓ alerts.log 갱신")
        print(f"      → {LOG_PATH}")
    else:
        print("    (오늘 신규 알림 없음)")


if __name__ == "__main__":
    main()
