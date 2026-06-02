# U-Turn Scanner — 확장 점검 보고서

> **작성 기준일:** 2026-05-27
> **목적:** "직장인용 AI 투자 기회·위험 점검판"으로의 확장을 시작하기 전, 현재 구조를 파악하고 새 기능을 어디에 안전하게 붙일지 정리한 **읽기 전용 점검 보고서**.
> **성격:** 코드·DB·환경설정 무수정. 향후 v0.1 설계의 기준 문서.

## 0. 절대 보호 원칙

1. `scripts/run_scan.py`의 **매매 조건·점수화·TOP10 산출 로직**은 변경하지 않는다.
2. **DB 테이블 구조와 기존 데이터**(특히 `daily_prices`, `reports`, `scan_results`, `stock_notes`, `backtest_results`)는 변경·삭제하지 않는다.
3. `daily_prices.trade_value = NULL` 저장 규칙은 깨지 않는다.
4. `run_daily.bat`의 9단계 흐름·실패처리·**CRLF 줄바꿈**을 손상시키지 않는다.
5. `.env.local`은 출력·수정·커밋하지 않는다.

## 0-1. 사용 표현 원칙 (확장 화면·텍스트 전반)

다음 표현만 사용한다.
**진짜 주도주 후보 / 후발주 관찰 / 기회 후보 / 추격 위험 / 조건 부족 / 보유자 대응 / 바닥 관찰 / U턴 시도 / U턴 확인 / 추세전환 후보**.

다음 표현은 절대 쓰지 않는다.
**매수하세요 / 매도하세요 / 목표가 / 급등 예상 / 상한가 후보**.

---

## 1. 현재 구조 요약

### 폴더 구조 (핵심)
```
u-turn-scanner/
├─ app/                     Next.js 화면 (App Router, 7개)
│  ├─ page.tsx              홈(최신 일일 리포트 + 시장 요약)
│  ├─ reports/[id]/         리포트 상세 (TOP10 표 + 시장 요약 박스)
│  ├─ stocks/[ticker]/      종목 상세 + 차트(Chart.tsx) + 메모(MemoForm.tsx)
│  ├─ backtest/             백테스트 결과
│  ├─ alerts/               알림 목록 + 읽음 처리
│  ├─ history/              과거 리포트 목록
│  ├─ search/               검색 (리포트 유형·날짜)
│  ├─ _components/          SearchForm.tsx
│  └─ layout.tsx  globals.css
├─ components/ui/           공용 UI(button.tsx, table.tsx, shadcn)
├─ lib/                     supabase.ts(DB 접속), utils.ts
├─ scripts/                 Python 배치 14개 (수집·분석·도구)
├─ docs/                    DB_SCHEMA.md, STATUS.md, HANDOFF.md, PERF_ANALYSIS_2차.md, EXPANSION_INSPECTION.md(이 문서)
├─ public/                  정적 이미지
├─ logs/                    run_daily.log, _price_cache.pkl (git 제외)
├─ run_daily.bat            매일 실행 배치(9단계)
└─ .env.local              환경변수(절대 외부 노출/커밋 금지)
```

### 주요 실행 파일
- **`scripts/run_scan.py`** — ★ 핵심. `fetch_all_prices()`(147~로드, B안으로 `_load_prices_from_db`/`fetch_all_prices(use_cache)`로 분리), `analyze()`(매매 조건·점수화), `main()`(스캔→`reports`/`scan_results` 저장). **로직 변경 금지.**
- **`run_daily.bat`** — 9단계 오케스트레이션. ①종목마스터 ②일봉(시총필터+빈틈방지+병렬+fast-ticker-index) ③지수 ④뉴스 ⑤일일스캔(`--use-price-cache`) ⑥주간스캔(`--use-price-cache`) ⑦백테스트 ⑧알림 ⑨웹서버. **흐름·CRLF 유지 금지.**
- **`scripts/check_db.py`** — 읽기 전용 DB 점검. 테이블별 행수·신선도. 확장 진단 도구의 좋은 본보기.
- **`scripts/run_logger.py`** — 실행 로그 헬퍼(start/done/fail). 확장 시 새 단계 로그를 추가할 자리는 여기.

### 데이터 흐름 한눈에
```
[수집] load_stocks → stocks/daily_prices
       load_indices → market_indices
       load_news_risks → news_risks
       load_financials → financials
[분석] run_scan → reports + scan_results
       run_backtest → backtest_results
       generate_alerts → alerts
[입력] 웹앱 MemoForm → stock_notes
[표시] Next.js 7개 화면이 위 테이블들을 읽음
```

## 2. 기존 보호 대상 (변경 금지)

| 대상 | 보호 이유 |
|------|-----------|
| `scripts/run_scan.py`의 `analyze()`·점수화·후보 선정·저장 로직 | 매매 조건·TOP10 산출 = 프로젝트 정체성. 결과가 바뀌면 안 됨 |
| `daily_prices.trade_value = NULL` 저장 규칙 (`fetch_one_ticker`) | NULL이면 `run_scan`이 `close×volume` 근사. 실값이 섞이면 결과가 바뀜 |
| DB 10개 테이블 구조와 기존 행 | `stocks·daily_prices·market_indices·news_risks·financials·reports·scan_results·backtest_results·stock_notes·alerts` 모두 |
| `run_daily.bat` 9단계 순서·실패처리·**CRLF** | 흐름 보존 + LF로 바뀌면 즉시 실행 불가 |
| `.env.local` (키 5개) | 외부 노출·git 커밋 금지 |
| `lib/supabase.ts` (anon 키 접속 단일 진입점) | 웹앱의 모든 화면이 의존 |

## 3. 새 기능별 연결 가능 위치 (안전한 지점만)

기본 원칙: **새 기능은 "읽기 전용 새 화면 + (필요 시) 새 사이드카 스크립트"로 추가.** 기존 핵심 파일(run_scan/run_daily/스키마)은 손대지 않는다.

### A. 오늘의 시장 지도
- **데이터:** `market_indices`(KOSPI·KOSDAQ ma60·20일수익률) + `scan_results`에 저장된 시장 요약 + (선택) 신규 사이드카 스크립트가 산출한 업종 집계.
- **연결 위치:** **새 화면 `app/market/page.tsx`**. 기존 홈 그대로 두고 헤더에 링크만 추가. (대안: 홈 상단 카드로 임베드)
- **운영 표현 예:** "**진짜 주도주 후보 vs 후발주 관찰 / 추세전환 후보**" 섹션, "60일선 위/아래" 표시 그대로.

### B. 오늘의 기회 포착판
- **데이터:** `reports`(오늘 daily/weekly) + `scan_results`(TOP) + `final_grade`. 추가로 "5조건 통과(추가조건 부족) 진단"은 현재 콘솔만 출력되고 저장은 안 됨 → v0.1은 **TOP/CHASE_RISK 위주**로 시작, 추가 진단은 v0.2에서 사이드카 JSON으로 확장.
- **연결 위치:** **새 화면 `app/opportunities/page.tsx`** 또는 기존 `app/reports/[id]/page.tsx`에 "기회 후보 / 추격 위험 / 조건 부족" 탭 추가(읽기 추가만).
- **운영 표현 예:** A·B 등급 → "기회 후보", `CHASE_RISK` → "추격 위험", `WATCH`/`EXCLUDE` → "조건 부족" 또는 "보유자 대응".

### C. 바닥 U턴 후보
- **데이터:** `cond_uturn_ok`(60일 중 60선 아래 ≥10일) + 골든크로스 미발생/임박 종목. **현재 `scan_results`엔 통과 종목만 저장**되어 바닥 단계 미통과 종목 정보는 없음 → 사이드카 필요(아래 5절).
- **연결 위치:** **새 화면 `app/bottom-watch/page.tsx`**. 데이터 원천은 새 사이드카 스크립트가 JSON으로 떨군 파일을 읽거나(가장 안전), 추후 별도 테이블 추가(v0.2 이후).
- **운영 표현 예:** "**바닥 관찰 → U턴 시도 → U턴 확인**" 3단계로 시각화.

### D. 주도주/후발주 분류
- **데이터:** `stocks.sector` + `daily_prices`(20일 수익률) + `market_indices`(시장 20일 수익률). `run_scan` 내부에 이미 업종 평균 20일 수익률 계산 로직 존재(저장은 안 함, 콘솔만).
- **연결 위치:** **새 사이드카 스크립트**(예: `scripts/sector_dump.py`)가 업종별 수익률·종목군을 JSON으로 떨구고, **새 화면 `app/leaders/page.tsx`** 가 읽음.
- **운영 표현 예:** 시장보다 강한 섹터의 강한 종목 = "**진짜 주도주 후보**", 같은 섹터의 늦은 종목 = "**후발주 관찰**".

### E. 추격 위험 필터
- **데이터:** 이미 존재. `scan_results.final_grade = 'CHASE_RISK'`, 이격도·일목 등.
- **연결 위치:** **기존 `app/reports/[id]/page.tsx`의 표 컬럼/필터**로 충분히 표현 가능. 신규 화면 불필요.
- **운영 표현 예:** "추격 위험" 배지(이미 사용 중) + "이격 20% 초과·후행스팬 불일치 등 조건 부족" 보조 텍스트.

### F. 키움 자동감시주문 입력 참고표
- **데이터:** 이미 존재. `scan_results.stop_loss / buy1_price / buy2_price / upside_pct / rr_ratio`.
- **연결 위치:** **새 화면 `app/kiwoom-helper/page.tsx`** — 사용자가 종목 선택 → 위 값을 **복사-붙여넣기 좋은 표** 형태로 보여줌. **자동주문 연결 아님.** "사용자가 키움에 손으로 입력하기 위한 참고표"라는 사실을 화면 상단에 명시.
- **표현 주의:** 어떤 셀에도 "매수/매도", 가격에도 "목표가" 같은 표현 금지. "**보유자 대응**: 손절선 X / 1차·2차 관찰가 Y/Z" 같은 중립적 라벨만 사용.

### G. 매매일지 초안 자동 생성
- **데이터:** `stock_notes`(관심도·매매가·자유메모) + `scan_results`(점수·등급·한 줄 코멘트·근거) + `backtest_results`(같은 종목의 과거 시뮬). `news_risks`도 보조.
- **연결 위치:** **새 화면 `app/journal/page.tsx`** — 선택 종목의 위 데이터를 한 페이지에 묶어 "일지 초안" 형태로 표시. 기존 `MemoForm.tsx`는 그대로 두고, 일지 화면은 **읽기 위주 + 자유메모 보강** 정도로 시작.
- **표현 예:** "**U턴 시도** 단계에서 관찰 시작, X일에 **U턴 확인**, Y일에 **보유자 대응**(손절선 도달) ..." 식 템플릿.

## 4. 현재 데이터로 가능한 것

다음은 **DB·핵심 로직 무수정**으로 새 화면만 추가하면 곧장 만들 수 있다.

- 오늘의 시장 지도(기초): `market_indices`(KOSPI/KOSDAQ 60일선·20일수익률) 표시.
- 오늘의 기회 포착판(기초): `reports`+`scan_results`의 TOP과 `final_grade`(A/B/WATCH/CHASE_RISK/EXCLUDE) 필터·뱃지 표시.
- 추격 위험 필터: `final_grade='CHASE_RISK'`로 바로 표.
- 키움 자동감시 참고표: `scan_results`의 `stop_loss / buy1_price / buy2_price / upside_pct / rr_ratio` 복사 친화 표.
- 매매일지 초안(기초): `stock_notes` + 해당 종목의 `scan_results` 최신 행을 묶어 보여주기.
- 종목별 뉴스 위험 컨텍스트: `news_risks`(CRITICAL/WARN) 표시.
- 재무 상태 컨텍스트: `financials.fin_status`(OK/WARN/HIGH_RISK/NO_DATA) 표시.

## 5. 추가 데이터가 필요한 것

핵심 로직을 안 건드린 채 다음을 보강하려면, **사이드카 스크립트 + 사이드카 저장(파일 또는 추후 추가 테이블)** 이 필요하다. (v0.2 이후 별도 작업으로)

- **5조건 통과(추가조건 부족)·바닥 관찰 등 "TOP 외" 후보 목록** — 현재 `scan_results`에 저장되지 않고 콘솔에만 출력됨. 해결안: 같은 `analyze()` 로직을 그대로 `import`해서 호출하는 **별도 스크립트**(예: `scripts/scan_dump.py`)가 진단 결과를 `logs/scan_dump_<date>.json`으로 떨구고 웹앱이 그 JSON을 읽음. **`run_scan.py` 수정 없이** 가능.
- **업종별 강도·주도주/후발주 분류 산출물** — `run_scan` 내부에서 계산만 되고 저장 안 됨. 해결안: 같은 방식으로 `scripts/sector_dump.py` 사이드카가 JSON 떨굼.
- **개인 보유 포지션·거래 이력** — 키움 API 연결 없이 시작 단계는 **사용자가 직접 입력**(`stock_notes` 확장 또는 신규 사이드카 JSON). v0.1은 입력 폼만 추가하고 자동 동기화는 보류.
- **종목별 일중 모멘텀/체결** — 현재는 일봉만 있음. 일중 데이터는 별도 수집 파이프라인이 필요해 v0.1 범위 외.

## 6. 위험한 수정 지점

| 지점 | 위험 | 회피 방법 |
|------|------|------------|
| `run_scan.py`의 `analyze()` 본문 | 매매 결과가 바뀜 | **수정 금지.** 필요 시 외부에서 import만. |
| `fetch_one_ticker()`의 `trade_value` 기본값 | NULL→실값으로 바뀌면 `cond_value_ok`/점수가 달라짐 | 그대로 둠. 새 수집 경로도 NULL 유지. |
| `reports`/`scan_results` 스키마 | 기존 화면·백테스트·알림이 의존 | 스키마 변경 금지. 새 정보는 신규 테이블 또는 사이드카 파일로. |
| `run_daily.bat` 9단계 흐름 | 실패처리·로깅과 얽혀 있음 | 단계 추가 시 끝(⑩ 등)으로만, **CRLF 유지**. |
| `lib/supabase.ts` 단일 접속점 | 모든 화면이 의존 | 그대로. 새 화면도 이걸 통해 읽음. |
| `.env.local`·service role 키 | 노출 시 보안 사고 | 출력·로그·커밋 금지. |

## 7. 추천 개발 순서

**원칙: 기존 보호 + 옵션·신규 화면으로만 시작 → 동작 확인 후 다음 단계.**

1. **v0.1-1 시장 지도(기초)** — 새 화면 `app/market/page.tsx`. `market_indices` + `reports` 시장요약만 읽음. 1~2시간 작업, 결과/DB 영향 0.
2. **v0.1-2 기회 포착판(기초)** — 새 화면 `app/opportunities/page.tsx`. 오늘의 `reports`+`scan_results` TOP에서 등급별 카드 표시. `CHASE_RISK`는 "추격 위험" 라벨.
3. **v0.1-3 키움 자동감시 참고표** — 새 화면 `app/kiwoom-helper/page.tsx`. 선택 종목의 `stop_loss/buy1/buy2` 등 **복사 친화 표**. 화면 상단에 "사용자가 키움에 직접 입력하기 위한 참고표(자동주문 아님)" 명시.
4. **v0.1-4 매매일지 초안(기초)** — 새 화면 `app/journal/page.tsx`. `stock_notes` + 해당 종목 최신 `scan_results` 묶어 표시. 자유메모 보완 입력만(자동 분석 X).
5. **v0.2-1 사이드카 분석 도입** — `scripts/scan_dump.py`, `scripts/sector_dump.py` 신설. `run_scan.py` 수정 없이 같은 `analyze()`/업종 계산 결과를 JSON 출력. 바닥 U턴·주도주/후발주 화면이 이 JSON을 읽음.
6. **v0.2-2 바닥 U턴 후보 화면** — `app/bottom-watch/page.tsx`. 위 JSON 기반 "바닥 관찰 → U턴 시도 → U턴 확인" 3단계 표시.
7. **v0.2-3 주도주/후발주 분류 화면** — `app/leaders/page.tsx`. 업종 사이드카 JSON 기반 "진짜 주도주 후보 vs 후발주 관찰" 분류.

각 단계마다 **기존 동작 회귀 확인**(`run_daily.bat` 1회 정상 실행 + 홈 화면 정상) 후 다음으로.

## 8. v0.1에서 할 일 / 하지 말아야 할 일

### 할 일 (v0.1 범위)
- 새 페이지만 추가: `app/market`, `app/opportunities`, `app/kiwoom-helper`, `app/journal`.
- 새 페이지는 **기존 테이블 읽기 전용**. `lib/supabase.ts` 그대로 사용.
- 헤더/네비게이션에 새 페이지 링크 추가(기존 화면은 그대로).
- 표현 원칙(0-1절)을 모든 라벨·툴팁·문구에 일관 적용.
- 키움 참고표 화면 상단에 **자동주문 아님**·**참고용 표**임을 명시.
- 새 페이지에 한해 작은 컴포넌트 추가는 허용(기존 컴포넌트 수정 금지).

### 하지 말아야 할 일 (v0.1에서 금지)
- `scripts/run_scan.py` 어떤 형태의 수정도 금지(`import`만 허용).
- `run_daily.bat` 흐름 변경·단계 추가 금지(v0.2부터 검토).
- DB 테이블 생성·수정·삭제 금지. (v0.2의 사이드카는 **파일** JSON으로 시작)
- 키움 API 연동·자동주문·실시간 체결 수집 금지.
- "매수/매도/목표가/급등 예상/상한가 후보" 표현 사용 금지.
- 사용자 종목 추천을 표현하는 모든 문구 금지 — 화면은 "기회 후보·추격 위험·조건 부족·보유자 대응" 등 **관찰·대응의 보조**로만 표기.

---

## 부록. 참고 테이블 매핑 (요청 항목과 실제 이름)

| 요청에 적힌 이름 | 실제 테이블 (DB_SCHEMA.md) | 비고 |
|-----------------|-----------------------------|------|
| tickers | **stocks** | 종목 마스터 |
| daily_prices | daily_prices | 일봉 |
| scan_results | scan_results | TOP 결과 |
| market_indices | market_indices | 지수 |
| financials | financials | 재무 |
| disclosure/risk | **news_risks** | DART 공시 위험 등급(CRITICAL/WARN) |
| 메모/관심종목 | **stock_notes** | 사용자 메모(관심도·매매가·자유메모). 관심종목은 stock_notes 기반으로 인식 |
| (그 외 기존) | reports, backtest_results, alerts | |

전체 컬럼 정의는 `docs/DB_SCHEMA.md` 참고.
