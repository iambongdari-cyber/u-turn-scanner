# DB 스키마 정리 (Supabase / PostgreSQL)

U-Turn Scanner가 사용하는 Supabase 테이블 10개를 정리한 문서다.
모든 접근은 Supabase REST API(`/rest/v1`)로 이뤄지며, 배치 스크립트는 service role 키,
웹앱은 anon 키를 쓴다.

용어:
- **PK** = 기본키 / 고유 식별. UPSERT의 `on_conflict` 대상이기도 하다.
- 컬럼 타입은 권장값이다(이 프로젝트는 SQL 마이그레이션 파일을 따로 두지 않으므로,
  실제 적재 코드에서 쓰는 값에 맞춰 표기했다).

데이터 흐름 요약:

```
load_stocks ─┬─▶ stocks ──────────────┐
             └─▶ daily_prices ────────┤
load_sectors ──▶ stocks.sector        │
load_financials ▶ financials          ├─▶ run_scan ─▶ reports + scan_results
load_indices ──▶ market_indices       │                      │
load_news_risks ▶ news_risks ─────────┘                      ├─▶ run_backtest ─▶ backtest_results
                                                              └─▶ generate_alerts ─▶ alerts
웹앱 사용자 입력 ──────────────────────────────────────────────▶ stock_notes
```

---

## 1. `stocks` — 종목 마스터

종목 기본 정보. 모든 분석의 출발점.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `ticker` | text **PK** | 6자리 종목코드 (예: `005930`) |
| `name` | text | 종목명 |
| `market` | text | `KOSPI` / `KOSDAQ` |
| `market_cap` | bigint | 시가총액(원). NULL 가능 |
| `sector` | text | KSIC 대분류 2자리 (업종). `load_sectors.py`가 채움 |

적재: `load_stocks.py`, `load_kospi_all.py` (시가총액), `load_sectors.py` (업종)

---

## 2. `daily_prices` — 일봉

종목별 일별 OHLCV. 분석의 핵심 원천 데이터.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `ticker` | text **PK1** | 종목코드 (FK → stocks) |
| `date` | date **PK2** | 거래일 |
| `open` | bigint | 시가 |
| `high` | bigint | 고가 |
| `low` | bigint | 저가 |
| `close` | bigint | 종가 |
| `volume` | bigint | 거래량 |
| `trade_value` | bigint | 거래대금(원). 공개 모드에선 NULL → 분석 시 `close×volume`으로 근사 |

PK: `(ticker, date)` · 적재: `load_stocks.py`, `load_prices.py`

---

## 3. `market_indices` — 시장 지수 일봉

KOSPI / KOSDAQ 지수. 시장 60일선 위/아래 판정과 20일 상대강도 계산에 사용.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `index_name` | text **PK1** | `KOSPI` / `KOSDAQ` |
| `date` | date **PK2** | 거래일 |
| `open` | float | 시가 |
| `high` | float | 고가 |
| `low` | float | 저가 |
| `close` | float | 종가 |
| `change_pct` | float | 전일 대비 등락률(%) |
| `volume` | bigint | 거래량 |

PK: `(index_name, date)` · 적재: `load_indices.py`

---

## 4. `news_risks` — 공시 위험도

DART 공시 목록을 훑어 종목별 최신 위험 등급을 저장. 종목당 한 행(최신).
스캔 시 **CRITICAL은 후보에서 자동 제외**, WARN은 표시만 한다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `ticker` | text **PK** | 종목코드 |
| `level` | text | `CRITICAL` / `WARN` (OK는 저장 안 함) |
| `latest_date` | date | 최신 위험 공시 접수일 |
| `latest_title` | text | 공시 제목 (최대 300자) |

적재: `load_news_risks.py` (매 실행 시 전체 교체) · 기본 윈도우 30일

위험 등급 판정:
- **CRITICAL** — 횡령·배임, 상장폐지, 감사의견 문제, 관리종목 지정 등
- **WARN** — 유상증자, 전환사채, 불성실공시, 감자 등 주가 영향 큰 공시

---

## 5. `financials` — 재무 정보

DART 사업보고서에서 추출한 연간 재무. 종목·연도별 한 행.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `ticker` | text **PK1** | 종목코드 |
| `fiscal_year` | int **PK2** | 사업연도 |
| `operating_income` | bigint | 영업이익(원) |
| `net_income` | bigint | 당기순이익(원) |
| `revenue` | bigint | 매출액(원) |
| `fin_status` | text | `OK` / `WARN` / `HIGH_RISK` / `NO_DATA` |

PK: `(ticker, fiscal_year)` · 적재: `load_financials.py`

재무 상태 판정:
- 영업이익 흑자 + 순이익 흑자 → **OK**
- 영업이익 흑자 + 순이익 적자 → **WARN**
- 영업이익 적자 → **HIGH_RISK**
- 데이터 없음 → **NO_DATA**

---

## 6. `reports` — 리포트 헤더

스캔 1회 = 리포트 1건. 일일/주간 × 기준일로 유일.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid **PK** | 리포트 ID (자동 생성) |
| `report_type` | text | `daily` / `weekly` |
| `base_date` | date | 기준 거래일 |
| `is_final` | bool | 확정 여부 (기본 true) |

UNIQUE: `(report_type, base_date)` — UPSERT 충돌키 · 적재: `run_scan.py`, `replay_history.py`

---

## 7. `scan_results` — 스캔 결과 (TOP N)

리포트별 통과 종목(최대 10개)과 모든 계산값·조건 통과 여부·등급.
**테이블 중 가장 컬럼이 많다.** 화면 표시와 백테스트 진입가의 원천.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `report_id` | uuid **PK1** | FK → reports.id |
| `ticker` | text **PK2** | 종목코드 |
| `rank` | int | 점수 내림차순 순위 (1~10) |
| `score` | float | 100점 만점 점수 |
| `cond_golden` | bool | 골든크로스 발생 |
| `cond_above_ma60` | bool | 현재가 > 60일선 |
| `cond_ma60_rising` | bool | 60일선 상승 중 |
| `cond_lagging_ok` | bool | 후행스팬 OK |
| `cond_cloud_red` | bool | 일목 앞 구름 양운(span_a > span_b) |
| `close` | float | 종가 |
| `ma10` / `ma20` / `ma60` | float | 10/20/60일 이동평균 |
| `disparity_pct` | float | 60일선 대비 이격도(%) |
| `golden_date` | date | 골든크로스 발생일 |
| `golden_days_ago` | int | 골든크로스 경과 거래일 수 |
| `trade_value` | bigint | 당일 거래대금 |
| `avg_value_20` | bigint | 20일 평균거래대금 |
| `stop_loss` | float | 손절선 = max(최근20일 저가, 60일선) |
| `upside_pct` | float | 60일 고가까지 상승여력(%) |
| `rr_ratio` | float | 손익비 (상승여력 / 손절폭) |
| `buy1_price` | float | 1차 매수 후보가 (10일선) |
| `buy2_price` | float | 2차 매수 후보가 (20일선) |
| `final_grade` | text | `A` / `B` / `WATCH` / `CHASE_RISK` / `EXCLUDE` |
| `one_line` | text | 자동 생성 한 줄 설명 |

PK: `(report_id, ticker)` · 적재: `run_scan.py`

> `cond_disp_ok / cond_value_ok / cond_cap_ok / cond_uturn_ok`는 후보 선정 단계의
> 추가 필터로 코드 내부에서만 쓰이고, 표에는 위 컬럼들만 저장된다.

---

## 8. `backtest_results` — 백테스트

각 스캔 결과를 진입 다음 거래일 시가에 매수했다고 가정하고 60거래일을 시뮬레이션.
**전략 청산(A)**과 **단순 60일 보유(B)** 두 시나리오를 함께 기록한다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `report_id` | uuid **PK1** | FK → reports.id |
| `ticker` | text **PK2** | 종목코드 |
| `base_date` | date | 리포트 기준일 |
| `entry_date` | date | 진입일(기준일 다음 거래일) |
| `entry_price` | float | 진입가(시가) |
| `stop_loss` | float | 손절선 |
| `target_price` | float | 목표가 |
| `strategy_exit_date` | date | 전략 청산일 |
| `strategy_exit_price` | float | 전략 청산가 |
| `strategy_exit_reason` | text | `TARGET` / `STOP` / `TIMEOUT` / `OPEN` |
| `strategy_holding_days` | int | 전략 보유 거래일 |
| `strategy_return_pct` | float | 전략 수익률(%) |
| `buyhold_exit_date` | date | 단순보유 청산일(60일째) |
| `buyhold_exit_price` | float | 단순보유 청산가 |
| `buyhold_holding_days` | int | 단순보유 보유일 |
| `buyhold_return_pct` | float | 단순보유 수익률(%) |
| `max_gain_pct` | float | 보유 중 최대 평가이익(%) |
| `max_drawdown_pct` | float | 보유 중 최대 낙폭(%) |
| `is_open` | bool | 미청산(60일 미도달) 여부 |

PK: `(report_id, ticker)` · 적재: `run_backtest.py` (OPEN 포지션은 매일 재평가)

청산 규칙:
- 첫날 시가 ≥ 목표가 → 즉시 TARGET(갭상승)
- 종가 ≤ 손절선 → STOP(종가 청산)
- 고가 ≥ 목표가 → TARGET
- 같은 날 둘 다 → STOP 우선(보수적)
- 60일 도달 → TIMEOUT / 미도달 → OPEN

---

## 9. `stock_notes` — 사용자 메모

웹앱 종목 상세 화면에서 사용자가 직접 입력. 알림(관심종목 위험 신호)의 기준이 된다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `report_id` | uuid **PK1** | 리포트 맥락 |
| `ticker` | text **PK2** | 종목코드 |
| `interest_level` | text | 관심도 (`HIGH` 등) |
| `my_decision` | text | 내 판단 (`CONSIDER` 등) |
| `target_buy` | float | 목표 매수가 |
| `target_stop` | float | 목표 손절가 |
| `target_sell` | float | 목표 매도가 |
| `free_memo` | text | 자유 메모 |

PK: `(report_id, ticker)` · 입력: 웹앱 `MemoForm.tsx` (UPSERT)

> `generate_alerts.py`는 `interest_level = HIGH` 또는 `my_decision = CONSIDER`인
> 종목을 "관심종목"으로 보고, 여기에 위험 공시가 뜨면 알림을 만든다.

---

## 10. `alerts` — 알림

매일 배치 끝에 감지한 변동 이벤트. 웹앱 `/alerts`에서 읽음 처리 가능.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid/serial **PK** | 알림 ID |
| `alert_type` | text | `NEW_CRITICAL` / `NEW_TOP` / `INTEREST_CRITICAL` |
| `ticker` | text | 종목코드 |
| `title` | text | 알림 제목 |
| `detail` | text | 상세 |
| `severity` | text | `CRITICAL` / `WARN` / `INFO` |
| `base_date` | date | 관련 기준일 |
| `is_read` | bool | 읽음 여부 |
| `created_at` | timestamptz | 생성 시각(중복 방지 dedup 기준) |

적재: `generate_alerts.py`

알림 타입과 중복 방지 기간:
- **NEW_CRITICAL** — 새 위험 공시 (30일 dedup)
- **NEW_TOP** — TOP 10 신규 진입 (14일 dedup)
- **INTEREST_CRITICAL** — 관심종목에 위험/주의 신호 (7일 dedup)

같은 `(alert_type, ticker)`가 dedup 기간 안에 이미 있으면 다시 만들지 않는다.

---

## 부록: 키·관계 한눈에

```
stocks (ticker)
  ├─1:N─ daily_prices (ticker, date)
  ├─1:N─ financials (ticker, fiscal_year)
  └─1:1─ news_risks (ticker)

reports (id)
  ├─1:N─ scan_results (report_id, ticker)
  ├─1:N─ backtest_results (report_id, ticker)
  └─1:N─ stock_notes (report_id, ticker)

market_indices (index_name, date)   ← 독립 (스캔 시 참조)
alerts (id)                          ← generate_alerts가 생성
```
