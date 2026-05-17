"""
load_sectors.py
DART company API로 종목별 업종코드(induty_code)를 가져와 stocks.sector 에 저장.

induty_code는 한국표준산업분류(KSIC) 5자리. 앞 2자리(대분류)를 sector로 사용.
예시:
  26 = 전자부품, 컴퓨터, 영상, 음향 및 통신장비 제조업 (반도체·디스플레이 등)
  64 = 금융업
  21 = 의료용 물질 및 의약품 제조업
  58 = 출판업 (게임·소프트웨어 일부)

업종은 거의 바뀌지 않으므로 한 번만 실행하면 된다. 분기에 한 번 또는 신규상장 추가 시 재실행.

[옵션]
  --limit N      처음 N개만 (테스트용)
  --sleep S      종목 사이 sleep 초 (기본 0.15)
  --only-empty   sector가 비어있는 종목만 처리 (재실행 시 빠르게)

[예시]
  python scripts/load_sectors.py --limit 20    # 20개 테스트
  python scripts/load_sectors.py               # 전체 (8~15분)
"""
import argparse
import io
import os
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
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


def fetch_stocks(only_empty: bool = False) -> list[dict]:
    """stocks 전체 조회. only_empty=True면 sector가 NULL인 것만."""
    rows: list[dict] = []
    offset, PAGE = 0, 1000
    while True:
        params = {
            "select": "ticker,name,market,market_cap,sector",
            "order": "ticker.asc",
        }
        if only_empty:
            params["sector"] = "is.null"
        r = requests.get(
            f"{REST_URL}/stocks",
            headers={**HEADERS, "Range": f"{offset}-{offset + PAGE - 1}"},
            params=params,
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


# ── DART 고유번호 매핑 ──────────────────────────────────────────
def get_corp_code_map() -> dict[str, str]:
    print("[1] DART 고유번호 매핑 다운로드…")
    r = requests.get(
        f"{DART_BASE}/corpCode.xml",
        params={"crtfc_key": DART_API_KEY},
        timeout=60,
    )
    r.raise_for_status()
    if r.headers.get("content-type", "").startswith("application/json"):
        sys.exit(f"    DART 오류 응답: {r.text[:200]}")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    xml_bytes = z.read(z.namelist()[0])
    root = ET.fromstring(xml_bytes)
    mapping: dict[str, str] = {}
    for item in root.iter("list"):
        stock_code = (item.findtext("stock_code") or "").strip()
        corp_code = (item.findtext("corp_code") or "").strip()
        if stock_code and corp_code and len(stock_code) == 6 and stock_code.isdigit():
            mapping[stock_code] = corp_code
    print(f"    상장사 매핑: {len(mapping)}개\n")
    return mapping


# ── DART 회사 정보 ──────────────────────────────────────────────
def fetch_company(corp_code: str) -> dict | None:
    r = requests.get(
        f"{DART_BASE}/company.json",
        params={"crtfc_key": DART_API_KEY, "corp_code": corp_code},
        timeout=30,
    )
    if not r.ok:
        return None
    data = r.json()
    if data.get("status") != "000":
        if data.get("status") == "020":
            raise RuntimeError("DART 요청 제한 초과(020). 잠시 후 재시도.")
        return None
    return data


# ── 메인 ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='DART 업종 정보 적재')
    parser.add_argument('--limit', type=int, default=0, help='처음 N개만')
    parser.add_argument('--sleep', type=float, default=0.15, help='sleep 초')
    parser.add_argument('--only-empty', action='store_true',
                        help='sector가 비어있는 종목만 처리')
    args = parser.parse_args()

    overall_start = time.time()

    # 1) 매핑
    corp_map = get_corp_code_map()

    # 2) stocks
    print(f"[2] stocks 로드 (only_empty={args.only_empty})…")
    stocks = fetch_stocks(only_empty=args.only_empty)
    if args.limit:
        stocks = stocks[:args.limit]
    print(f"    대상 종목: {len(stocks)}개\n")

    if not stocks:
        print("처리할 종목 없음.")
        return

    # 3) DART company API로 induty_code 조회
    print(f"[3] 종목별 업종 조회 (sleep {args.sleep}초)…")
    n_ok = n_nodata = 0
    batch: list[dict] = []
    n_total = len(stocks)
    sector_dist: dict[str, int] = {}

    for i, srow in enumerate(stocks, start=1):
        ticker = srow["ticker"]
        corp_code = corp_map.get(ticker)
        if not corp_code:
            n_nodata += 1
            continue
        try:
            comp = fetch_company(corp_code)
        except RuntimeError as e:
            print(f"\n    ⚠️ {e}")
            upsert("stocks", batch)
            sys.exit(1)

        if comp is None:
            n_nodata += 1
            time.sleep(args.sleep)
            continue

        induty = (comp.get("induty_code") or "").strip()
        if not induty:
            n_nodata += 1
            time.sleep(args.sleep)
            continue

        # 앞 2자리(KSIC 중분류). 예: 26410 → 26
        sector = induty[:2]
        sector_dist[sector] = sector_dist.get(sector, 0) + 1

        batch.append({
            "ticker":     ticker,
            "name":       srow["name"],
            "market":     srow["market"],
            "market_cap": srow.get("market_cap"),
            "sector":     sector,
        })
        n_ok += 1
        time.sleep(args.sleep)

        # 100개마다 중간 저장 + 진행 표시
        if i % 100 == 0 or i == n_total:
            upsert("stocks", batch)
            batch = []
            elapsed = time.time() - overall_start
            eta = elapsed / i * (n_total - i) if i < n_total else 0
            print(f"    [{i}/{n_total}] 적재 {n_ok} / 없음 {n_nodata} / "
                  f"eta {int(eta // 60)}분 {int(eta % 60)}초")

    if batch:
        upsert("stocks", batch)

    elapsed = time.time() - overall_start
    print(f"\n    ✓ 적재 {n_ok} / 데이터없음 {n_nodata}")
    print(f"    ✓ 소요 {int(elapsed // 60)}분 {int(elapsed % 60)}초")

    # 업종 분포 상위 10개
    if sector_dist:
        print("\n[업종 분포 상위 10개]")
        top = sorted(sector_dist.items(), key=lambda x: x[1], reverse=True)[:10]
        for sector, cnt in top:
            print(f"    {sector}: {cnt}개")


if __name__ == "__main__":
    main()
