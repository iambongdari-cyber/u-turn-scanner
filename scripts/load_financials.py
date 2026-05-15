"""
load_financials.py
DART OpenAPI에서 종목별 재무 정보(영업이익/당기순이익/매출액)를 가져와
financials 테이블에 적재한다.

[흐름]
  1) DART corpCode.xml 다운로드 → 종목코드 ↔ DART 고유번호 매핑
  2) stocks 테이블의 종목들에 대해 최근 사업보고서 재무제표 조회
  3) 영업이익/당기순이익/매출액 추출 + 재무 상태 판정
  4) financials 테이블에 UPSERT

[재무 상태 판정 — 기획서 11장]
  영업이익 흑자 + 당기순이익 흑자 → OK (정상)
  영업이익 흑자 + 당기순이익 적자 → WARN (주의)
  영업이익 적자                  → HIGH_RISK (고위험)
  데이터 없음                    → NO_DATA

[옵션]
  --limit N       처음 N개만 (테스트용)
  --sleep S       종목 사이 sleep 초 (기본 0.2)
  --year YYYY     기준 사업연도 (기본: 작년). 없으면 그 직전 연도까지 시도

[예시]
  python scripts/load_financials.py --limit 20   # 20개 테스트
  python scripts/load_financials.py              # 전체
"""
import argparse
import io
import os
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── 환경변수 로드 ───────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
DART_API_KEY = os.environ.get("DART_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 비어있습니다.")
if not DART_API_KEY:
    sys.exit("환경변수 DART_API_KEY 가 비어있습니다. .env.local 에 추가하세요.\n"
             "  DART_API_KEY=발급받은_40자리_인증키")

REST_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}
DART_BASE = "https://opendart.fss.or.kr/api"


# ── Supabase 헬퍼 ───────────────────────────────────────────────
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


def fetch_stock_tickers() -> list[tuple[str, str]]:
    """stocks 테이블에서 (ticker, name) 전체 조회. 페이지네이션."""
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "ticker,name", "order": "ticker.asc"},
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
    return [(row["ticker"], row["name"]) for row in rows]


# ── DART 고유번호 매핑 ──────────────────────────────────────────
def get_corp_code_map() -> dict[str, str]:
    """DART corpCode.xml(zip) 다운로드 → {종목코드(6자리): DART고유번호}."""
    print("[1] DART 고유번호 매핑 다운로드…")
    url = f"{DART_BASE}/corpCode.xml"
    r = requests.get(url, params={"crtfc_key": DART_API_KEY}, timeout=60)
    r.raise_for_status()

    # 응답이 zip이 아니라 JSON 에러일 수 있음 (잘못된 키 등)
    if r.headers.get("content-type", "").startswith("application/json"):
        sys.exit(f"    DART 오류 응답: {r.text[:200]}")

    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
        xml_bytes = z.read(z.namelist()[0])
    except zipfile.BadZipFile:
        sys.exit(f"    corpCode.xml 다운로드 실패. 응답: {r.text[:200]}")

    root = ET.fromstring(xml_bytes)
    mapping: dict[str, str] = {}
    for item in root.iter("list"):
        stock_code = (item.findtext("stock_code") or "").strip()
        corp_code = (item.findtext("corp_code") or "").strip()
        # 상장사만 (stock_code가 6자리 숫자인 것)
        if stock_code and corp_code and len(stock_code) == 6 and stock_code.isdigit():
            mapping[stock_code] = corp_code
    print(f"    상장사 매핑: {len(mapping)}개\n")
    return mapping


# ── 재무제표 조회 ───────────────────────────────────────────────
def _parse_amount(s) -> int | None:
    """DART 금액 문자열을 int로. '32,725,961' → 32725961, '-' → None."""
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    if not s or s in ("-", "—"):
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def fetch_financials(corp_code: str, year: int) -> dict | None:
    """단일회사 주요계정(사업보고서) 조회.
    반환: {revenue, operating_income, net_income} 또는 None(데이터 없음/오류)."""
    r = requests.get(
        f"{DART_BASE}/fnlttSinglAcnt.json",
        params={
            "crtfc_key": DART_API_KEY,
            "corp_code": corp_code,
            "bsns_year": str(year),
            "reprt_code": "11011",   # 사업보고서(연간)
        },
        timeout=30,
    )
    if not r.ok:
        return None
    data = r.json()
    status = data.get("status")
    if status != "000":
        # 013 = 데이터 없음, 020 = 요청 제한 초과 등
        if status == "020":
            raise RuntimeError("DART 요청 제한 초과(020). --sleep 을 늘리거나 내일 재시도하세요.")
        return None

    result = {"revenue": None, "operating_income": None, "net_income": None}
    for item in data.get("list", []):
        acc = (item.get("account_nm") or "").strip()
        val = _parse_amount(item.get("thstrm_amount"))
        if val is None:
            continue
        # 연결재무제표(CFS) 우선. account_nm은 회사마다 표기가 조금씩 다름.
        if result["revenue"] is None and ("매출액" in acc or "수익(매출액)" in acc):
            result["revenue"] = val
        elif result["operating_income"] is None and "영업이익" in acc:
            result["operating_income"] = val
        elif result["net_income"] is None and "당기순이익" in acc:
            result["net_income"] = val

    # 셋 다 None이면 사실상 데이터 없음
    if all(v is None for v in result.values()):
        return None
    return result


def compute_fin_status(op: int | None, net: int | None) -> str:
    """기획서 11장 기준 재무 상태 판정."""
    if op is None and net is None:
        return "NO_DATA"
    if op is not None and op < 0:
        return "HIGH_RISK"
    if op is not None and op >= 0:
        if net is not None and net < 0:
            return "WARN"
        if net is not None and net >= 0:
            return "OK"
        # 영업이익 흑자인데 당기순이익 정보 없음 → 일단 OK 취급
        return "OK"
    return "NO_DATA"


# ── 메인 ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='DART 재무 정보 적재')
    parser.add_argument('--limit', type=int, default=0, help='처음 N개만')
    parser.add_argument('--sleep', type=float, default=0.2, help='종목간 sleep 초')
    parser.add_argument('--year', type=int, default=0,
                        help='기준 사업연도 (기본: 작년)')
    args = parser.parse_args()

    # 기준 연도: 지정 없으면 작년 (사업보고서는 보통 3월 말 공시되므로)
    base_year = args.year if args.year else datetime.today().year - 1

    overall_start = time.time()

    # 1) DART 고유번호 매핑
    corp_map = get_corp_code_map()

    # 2) stocks 로드
    print("[2] stocks 테이블 로드…")
    tickers = fetch_stock_tickers()
    if args.limit:
        tickers = tickers[:args.limit]
    print(f"    대상 종목: {len(tickers)}개\n")

    # 3) 종목별 재무 조회
    print(f"[3] 종목별 재무 조회 (기준연도 {base_year}, sleep {args.sleep}초)…")
    n_ok = n_nodata = n_fail = 0
    n_status = {"OK": 0, "WARN": 0, "HIGH_RISK": 0, "NO_DATA": 0}
    batch: list[dict] = []
    n_total = len(tickers)

    for i, (ticker, name) in enumerate(tickers, start=1):
        corp_code = corp_map.get(ticker)
        if not corp_code:
            # DART에 매핑 없음 → NO_DATA로 기록
            batch.append({
                "ticker": ticker, "fiscal_year": base_year,
                "operating_income": None, "net_income": None, "revenue": None,
                "fin_status": "NO_DATA",
            })
            n_nodata += 1
            n_status["NO_DATA"] += 1
            continue

        # 기준연도부터 직전연도까지 최대 2개년 시도
        fin = None
        used_year = base_year
        for y in (base_year, base_year - 1):
            try:
                fin = fetch_financials(corp_code, y)
            except RuntimeError as e:
                print(f"\n    ⚠️ {e}")
                # 요청 제한이면 여기까지 적재하고 종료
                upsert("financials", batch)
                sys.exit(1)
            if fin is not None:
                used_year = y
                break
            time.sleep(args.sleep)

        if fin is None:
            batch.append({
                "ticker": ticker, "fiscal_year": base_year,
                "operating_income": None, "net_income": None, "revenue": None,
                "fin_status": "NO_DATA",
            })
            n_nodata += 1
            n_status["NO_DATA"] += 1
        else:
            status = compute_fin_status(fin["operating_income"], fin["net_income"])
            batch.append({
                "ticker": ticker, "fiscal_year": used_year,
                "operating_income": fin["operating_income"],
                "net_income": fin["net_income"],
                "revenue": fin["revenue"],
                "fin_status": status,
            })
            n_ok += 1
            n_status[status] += 1

        time.sleep(args.sleep)

        # 진행 표시 + 중간 저장 (100개마다)
        if i % 100 == 0 or i == n_total:
            upsert("financials", batch)
            batch = []
            elapsed = time.time() - overall_start
            eta = elapsed / i * (n_total - i) if i < n_total else 0
            print(f"    [{i}/{n_total}] 적재 {n_ok} / 데이터없음 {n_nodata} / "
                  f"eta {int(eta // 60)}분 {int(eta % 60)}초")

    # 남은 배치 저장
    if batch:
        upsert("financials", batch)

    elapsed = time.time() - overall_start
    print(f"\n    ✓ 재무 적재 {n_ok} / 데이터없음 {n_nodata} / 실패 {n_fail}")
    print(f"    ✓ 상태 분포 — 정상 {n_status['OK']} / 주의 {n_status['WARN']} / "
          f"고위험 {n_status['HIGH_RISK']} / 데이터없음 {n_status['NO_DATA']}")
    print(f"    ✓ 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초")


if __name__ == "__main__":
    main()
