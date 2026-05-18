"""
load_news_risks.py
DART 공시 목록(list.json)에서 최근 N일치 공시를 가져와
각 종목의 위험 등급(CRITICAL/WARN)을 판정해 news_risks 테이블에 저장.

위험 등급:
  CRITICAL — 횡령·배임, 상장폐지, 감사의견 문제, 관리종목 지정 등
  WARN    — 유상증자, 전환사채, 불성실공시, 감자 등 주가 영향 큰 공시
  OK      — 특이사항 없음 (테이블에 저장 안 함)

매일 갱신용. 기본 30일 윈도우.
"""
import argparse
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── 환경변수 ─────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
DART_API_KEY = os.environ.get("DART_API_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어있습니다.")
if not DART_API_KEY:
    sys.exit("환경변수 DART_API_KEY 가 비어있습니다.")

REST_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}
DART_BASE = "https://opendart.fss.or.kr/api"


# ── 위험 키워드 (DART 보고서명 매칭) ────────────────────────────
CRITICAL_KEYWORDS = [
    "횡령", "배임",
    "상장폐지", "상장적격성",
    "회생절차", "법정관리", "파산",
    "감사의견 거절", "감사의견의견거절", "의견거절",
    "감사범위제한", "감사의견 한정", "한정의견",
    "관리종목지정", "관리종목 지정",
]

WARN_KEYWORDS = [
    "유상증자",
    "전환사채", "신주인수권부사채", "교환사채",
    "불성실공시",
    "조회공시",
    "현저한 시황변동",
    "매출액 또는 손익구조 30",     # 매출/손익 30% 이상 변동
    "감자결정",
    "주식교환", "주식이전",
]


def classify(report_nm: str) -> str:
    """공시명에 키워드 매칭. 우선순위: CRITICAL > WARN > OK."""
    if not report_nm:
        return "OK"
    for kw in CRITICAL_KEYWORDS:
        if kw in report_nm:
            return "CRITICAL"
    for kw in WARN_KEYWORDS:
        if kw in report_nm:
            return "WARN"
    return "OK"


# ── DART list.json ───────────────────────────────────────────────
def fetch_disclosures(days: int) -> list[dict]:
    """최근 N일치 전체 공시. 페이지네이션."""
    today = datetime.today()
    end_de = today.strftime("%Y%m%d")
    bgn_de = (today - timedelta(days=days)).strftime("%Y%m%d")
    print(f"공시 조회 기간: {bgn_de} ~ {end_de}")

    all_items: list[dict] = []
    page_no = 1
    while True:
        r = requests.get(
            f"{DART_BASE}/list.json",
            params={
                "crtfc_key": DART_API_KEY,
                "bgn_de": bgn_de,
                "end_de": end_de,
                "page_no": page_no,
                "page_count": 100,
            },
            timeout=30,
        )
        if not r.ok:
            print(f"  ⚠️ page {page_no} HTTP 실패: {r.status_code}")
            break
        data = r.json()
        status = data.get("status")
        if status != "000":
            if status == "013":
                break  # 데이터 없음
            if status == "020":
                print(f"  ⚠️ DART 요청 제한(020). 잠시 후 재시도.")
                break
            print(f"  ⚠️ DART 응답: {status} {data.get('message','')}")
            break
        items = data.get("list", []) or []
        all_items.extend(items)
        total_page = int(data.get("total_page") or 1)
        if page_no >= total_page:
            break
        page_no += 1
        time.sleep(0.1)
        if page_no % 10 == 0:
            print(f"  …page {page_no}/{total_page}")

    print(f"  ✓ 총 {len(all_items)}건 수집\n")
    return all_items


# ── Supabase ─────────────────────────────────────────────────────
def upsert(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        r = requests.post(
            f"{REST_URL}/{table}", headers=HEADERS, json=chunk, timeout=120
        )
        if not r.ok:
            raise RuntimeError(f"{table} upsert 실패 ({r.status_code}): {r.text[:300]}")


def fetch_existing_tickers() -> set[str]:
    """stocks 테이블의 전체 ticker 집합. 외래키 위반 방지용."""
    tickers: set[str] = set()
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker", "order": "ticker.asc"},
            timeout=30,
        )
        r.raise_for_status()
        page = r.json()
        if not page:
            break
        tickers.update(row["ticker"] for row in page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return tickers


def delete_all_news_risks() -> None:
    """news_risks 전체 삭제. 매일 새로 분류하므로 30일 윈도우 밖 데이터는 제거."""
    r = requests.delete(
        f"{REST_URL}/news_risks",
        headers=HEADERS,
        params={"ticker": "neq.__none__"},  # neq에 절대 없는 값 → 전체 삭제
        timeout=60,
    )
    if not r.ok:
        # 404나 데이터 없음이면 무시
        if r.status_code not in (404,):
            print(f"  ⚠️ delete 응답: {r.status_code} {r.text[:200]}")


# ── 메인 ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='DART 공시 기반 뉴스 리스크 적재')
    parser.add_argument('--days', type=int, default=30, help='기간 일수 (기본 30)')
    args = parser.parse_args()

    overall_start = time.time()

    items = fetch_disclosures(args.days)

    # 종목별 가장 심각한 위험 등급 + 가장 최근 위험 공시
    severity = {"CRITICAL": 2, "WARN": 1, "OK": 0}
    per_ticker: dict[str, dict] = {}
    for item in items:
        stock_code = (item.get("stock_code") or "").strip()
        if not stock_code or len(stock_code) != 6 or not stock_code.isdigit():
            continue
        report_nm = item.get("report_nm", "")
        level = classify(report_nm)
        if level == "OK":
            continue
        date_str = item.get("rcept_dt", "")
        date_iso = None
        if len(date_str) == 8:
            date_iso = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

        prev = per_ticker.get(stock_code)
        # 더 심각한 등급이면 교체. 같은 등급이면 더 최근 것 유지.
        should_update = (
            prev is None
            or severity[level] > severity[prev["level"]]
            or (severity[level] == severity[prev["level"]] and date_iso and date_iso > (prev.get("latest_date") or ""))
        )
        if should_update:
            per_ticker[stock_code] = {
                "level": level,
                "latest_date": date_iso,
                "latest_title": report_nm[:300],
            }

    n_crit_raw = sum(1 for v in per_ticker.values() if v["level"] == "CRITICAL")
    n_warn_raw = sum(1 for v in per_ticker.values() if v["level"] == "WARN")
    print(f"위험 분류(전체): CRITICAL {n_crit_raw}개 / WARN {n_warn_raw}개")

    # stocks 테이블에 있는 종목만 필터 (DART는 KOSPI/KOSDAQ 외 종목도 반환)
    print("stocks 테이블 ticker 조회…")
    existing = fetch_existing_tickers()
    skipped = [t for t in per_ticker if t not in existing]
    per_ticker = {t: v for t, v in per_ticker.items() if t in existing}
    if skipped:
        print(f"  ⚠️ stocks에 없는 {len(skipped)}개 종목 제외 (예: {skipped[:5]})")

    n_crit = sum(1 for v in per_ticker.values() if v["level"] == "CRITICAL")
    n_warn = sum(1 for v in per_ticker.values() if v["level"] == "WARN")
    print(f"위험 분류(적재대상): CRITICAL {n_crit}개 / WARN {n_warn}개\n")

    # 기존 데이터 삭제 후 새로 적재 (30일 윈도우 밖 종목은 자연스럽게 사라짐)
    print("기존 news_risks 초기화…")
    delete_all_news_risks()

    rows = [
        {
            "ticker": ticker,
            "level": info["level"],
            "latest_date": info["latest_date"],
            "latest_title": info["latest_title"],
        }
        for ticker, info in per_ticker.items()
    ]
    upsert("news_risks", rows)
    elapsed = time.time() - overall_start
    print(f"  ✓ {len(rows)}개 종목 적재")
    print(f"  ✓ 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초")

    # CRITICAL 종목 일부 출력 (사용자 확인용)
    if n_crit > 0:
        print("\n[CRITICAL 종목 예시 (최대 10개)]")
        crits = [(t, v) for t, v in per_ticker.items() if v["level"] == "CRITICAL"][:10]
        for ticker, info in crits:
            title = info["latest_title"][:60]
            print(f"  {ticker}  {info['latest_date']}  {title}")


if __name__ == "__main__":
    main()
