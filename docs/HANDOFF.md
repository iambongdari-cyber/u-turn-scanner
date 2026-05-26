# U-Turn Scanner — 개발 인수인계 문서 (HANDOFF)

> **작성 기준일:** 2026-05-25
> **목적:** 새 프로젝트/새 개발자가 코드 없이도 맥락을 이해하고 바로 이어서 작업할 수 있도록 정리한 인수인계 문서.
> **대원칙:** 매매 조건·TOP10 산출 로직·기존 DB/데이터/리포트 구조는 절대 임의로 바꾸지 않는다. 개선은 "옵션으로 켜고 끄는" 방식으로, 한 번에 하나씩, 매번 검증하고 git에 커밋한다.

---

## 1. U-Turn Scanner의 목적

코스피·코스닥 전 종목을 매일 스캔해, **60일 이동평균선 U턴(골든크로스 복귀) 패턴**에 부합하는 종목을 100점 만점으로 점수화하고 상위 종목(TOP 10)을 리포트로 보여 주는 **개인용 보조 도구**다.

- 개인이 자기 PC에서 돌리는 용도. 외부 배포·서버 운영 전제 아님.
- 모든 판정은 **KRX 정규장 종가 기준**. 투자 보조 도구일 뿐 매매 권유가 아니다.

## 2. 현재까지 개발된 주요 기능

- **데이터 수집:** 종목 마스터, 일봉(OHLCV), 시장지수(KOSPI/KOSDAQ), 재무(DART), 공시 위험도(DART)
- **핵심 분석(run_scan):** 필수 5조건 + 추가 필터 + 100점 점수화 → 일일/주간 TOP10 리포트 생성, 등급(A/B/관망/추격주의/제외) 부여
- **백테스트:** 진입 후 60거래일 시뮬레이션(전략 청산 vs 단순 보유)
- **알림:** 신규 위험공시 / TOP 신규진입 / 관심종목 위험 (중복 방지 포함)
- **웹앱(Next.js) 화면 7개:** 홈, 리포트 상세(TOP10 표+시장요약), 종목 상세(차트+메모), 백테스트, 알림, 과거 리포트, 검색
- **사용자 메모 저장:** 종목별 관심도·매매가·자유메모
- **운영 도구:** 매일 실행 배치(`run_daily.bat`, 9단계), DB 점검 스크립트(`check_db.py`), 실행 로그(`run_logger.py` → `logs/run_daily.log`)

### 최근(이번 작업) 개선 완료 항목 — 실행 시간 단축
- **시가총액 필터(`--min-cap 800`):** 일봉 수집 단계에서 시총 800억 미만 종목 제외 (아래 7·8번 참고)
- **데이터 빈틈 방지(`--gap-fill`):** DB의 마지막 저장일 기준으로 누락분만 자동 보강
- **병렬 수집(`--workers 8`):** 종목을 동시에 수집 → 일봉 단계 **약 30분 → 4분 미만**, 전체 **약 41분 → 8분대**
- **실행 로그:** 단계별 성공/실패·총 실행시간·수집 통계 자동 기록

## 3. 현재 폴더 구조

```
u-turn-scanner/
├─ app/                     Next.js 화면 (App Router)
│  ├─ page.tsx              홈(최신 일일 리포트 + 시장 요약)
│  ├─ reports/[id]/         리포트 상세 (TOP10 표)
│  ├─ stocks/[ticker]/      종목 상세 + 차트(Chart.tsx) + 메모(MemoForm.tsx)
│  ├─ backtest/  alerts/  history/  search/
│  ├─ _components/          SearchForm.tsx
│  └─ layout.tsx  globals.css
├─ components/ui/           공용 UI (button.tsx, table.tsx)
├─ lib/                     supabase.ts(DB 접속), utils.ts
├─ scripts/                 Python 배치 (아래 4번 참고)
├─ docs/                    DB_SCHEMA.md, STATUS.md, HANDOFF.md(이 문서)
├─ public/                  정적 이미지
├─ logs/                    run_daily.log (실행 로그, git 제외)
├─ run_daily.bat            매일 실행 배치 (9단계)
└─ .env.local              환경변수 5개 (git 제외, 절대 외부 노출 금지)
```

## 4. 주요 파일 설명

| 파일 | 역할 | 비고 |
|------|------|------|
| `scripts/run_scan.py` | ★ 핵심 분석. 5조건+추가필터+100점 점수화→TOP10 저장 | **매매 로직. 함부로 수정 금지** |
| `scripts/load_stocks.py` | 종목 마스터 + 일봉 수집(FinanceDataReader) | 시총필터/빈틈방지/병렬 옵션 포함 |
| `scripts/load_indices.py` | 시장 지수 수집 | |
| `scripts/load_financials.py` | 재무 수집(DART) | 분기/연 1회 수동 |
| `scripts/load_news_risks.py` | 공시 위험도 수집(DART) | CRITICAL 자동 제외 근거 |
| `scripts/load_sectors.py` | 업종 코드(DART) | 분기 1회 수동 |
| `scripts/run_backtest.py` | 60거래일 백테스트 | |
| `scripts/replay_history.py` | 과거 리포트 재생(백테스트 표본용) | |
| `scripts/generate_alerts.py` | 알림 생성(중복 방지) | |
| `scripts/check_conditions.py` | 단일 종목 조건 디버깅 | |
| `scripts/analyze_backtest.py` | 지표 변별력 분석(튜닝용) | |
| `scripts/check_db.py` | DB 상태 점검(읽기 전용) | 행수·신선도 확인 |
| `scripts/run_logger.py` | 실행 로그 기록 헬퍼 | run_daily.bat이 호출 |
| `lib/supabase.ts` | DB 접속 단일 진입점 | anon 키 |
| `app/reports/[id]/page.tsx` | 리포트 상세 화면 | 가장 큰 화면 |
| `run_daily.bat` | 전체 파이프라인 9단계 오케스트레이션 | **줄바꿈 CRLF 필수**(아래 7번) |
| `docs/DB_SCHEMA.md` | DB 테이블 10개 상세 정의 | |
| `.env.local` | 환경변수 5개 | **백업/비공개 필수** |

### load_stocks.py 주요 옵션 (실행 시간/안정성 관련)
- `--prices-only` : 일봉만 적재 (종목 마스터는 `--stocks-only`)
- `--min-cap N` : 시총 N억 미만 제외 (NULL·관심종목은 제외 안 함). **0이면 필터 끄기 = 전체 수집(롤백)**
- `--gap-fill` : DB 마지막 저장일 기준 누락분만 증분 수집 (신규 종목은 초기 400일)
- `--workers N` : 동시 수집 스레드 수. **1이면 순차(기존 동작), 2 이상이면 병렬**
- `--days N` : 최근 N일치만 (0이면 400일)
- `--skip-existing` : 이미 일봉 있는 종목 통째로 건너뜀(초기 적재 재개용)
- `--log-file PATH` : 수집 통계를 로그에 기록

## 5. DB 구조와 저장 데이터 (Supabase / PostgreSQL)

테이블 10개. 모든 접근은 Supabase REST(`/rest/v1`), 배치는 service role 키 / 웹앱은 anon 키. **상세 컬럼·키는 `docs/DB_SCHEMA.md` 참고.**

| 테이블 | 저장 데이터 | 적재 스크립트 |
|--------|-------------|----------------|
| `stocks` | 종목 마스터(코드·이름·시장·**시가총액**·업종) | load_stocks / load_kospi_all / load_sectors |
| `daily_prices` | 일봉 OHLCV (PK: ticker,date). `trade_value`는 NULL 저장 | load_stocks |
| `market_indices` | KOSPI/KOSDAQ 지수 일봉 | load_indices |
| `news_risks` | 종목별 최신 공시 위험도(CRITICAL/WARN) | load_news_risks |
| `financials` | 연간 재무(영업이익·순이익·매출·상태) | load_financials |
| `reports` | 리포트 헤더(일일/주간 × 기준일) | run_scan / replay_history |
| `scan_results` | 리포트별 TOP N 결과·조건·점수·등급 (컬럼 최다) | run_scan |
| `backtest_results` | 백테스트(전략/단순보유 수익률 등) | run_backtest |
| `stock_notes` | 사용자 메모(관심도·매매가·자유메모) = **관심종목 근거** | 웹앱 MemoForm |
| `alerts` | 알림 이벤트(읽음 여부) | generate_alerts |

> **중요(거래대금):** `daily_prices.trade_value`는 의도적으로 **NULL**로 저장한다. `run_scan.py`가 NULL이면 `close×volume`으로 근사하고, 값이 있으면 그 값을 쓴다. 따라서 실제 거래대금을 채워 넣으면 `cond_value_ok`·점수가 바뀌어 **TOP10 결과가 달라진다.** 결과 보존을 위해 NULL 유지 원칙을 깨지 말 것.

## 6. 현재 실행 방법

전제: `.env.local`(키 5개), Python 가상환경 `.venv`(`pip install -r scripts/requirements.txt`), Node 패키지(`npm install`), Supabase 테이블 10개.

```bat
REM 전체 파이프라인 (매일) — 9단계 자동
run_daily.bat

REM 웹앱만
npm run dev                  REM http://localhost:3000

REM DB 상태 점검 (읽기 전용)
.venv\Scripts\python.exe scripts\check_db.py

REM 일봉만 수동 최적화 수집
.venv\Scripts\python.exe scripts\load_stocks.py --market ALL --prices-only --gap-fill --min-cap 800 --workers 8 --log-file logs\run_daily.log

REM 종목 마스터만 갱신 (신규 상장 반영, 수십 초)
.venv\Scripts\python.exe scripts\load_stocks.py --market ALL --stocks-only
```

**run_daily.bat 9단계:** ①종목 마스터 ②일봉(시총필터+빈틈방지+병렬) ③지수 ④뉴스 ⑤일일스캔 ⑥주간스캔 ⑦백테스트 ⑧알림 ⑨웹서버. ②~⑥ 실패 시 멈춤, ①⑦⑧은 경고만 내고 계속. 로그는 `logs/run_daily.log`.

## 7. 현재 알려진 문제점

1. **일봉 갱신 시간 (개선됨, 잔여 있음):** 원래 약 2,500개 종목을 **하나씩 순차로** 수집해 **약 41분** 걸렸다. → 시총 필터 + **병렬 수집(`--workers 8`)** 으로 **일봉 단계 4분 미만, 전체 8분대**로 단축. 잔여 병목은 "준비 단계"(약 4~5분): ⑴종목목록 조회(StockListing), ⑵`get_tickers_with_prices()`가 `daily_prices` 약 67만 행을 1,000행씩 페이지네이션하는 비용. (개선 여지 있음 — 8번 참고)
2. **약 2,500개 순차 수집 문제 (개선됨):** 이제 시총 필터로 약 1,646개로 줄이고, 그마저 동시(병렬)로 수집. 단, 진짜 "한 번에" 받는 방식(pykrx 날짜기준)은 아직 미적용(8번 참고).
3. **최근 15일치 갱신의 데이터 빈틈 (해결됨):** 과거에는 "최근 15일 고정"이라 2주 이상 미실행 시 중간이 비었다. → `--gap-fill`로 **DB의 마지막 저장일을 읽어 그 다음부터 오늘까지 자동 보강**(간격+5일 마진, 최소 15일). 중복은 UPSERT로 제거, 신규 종목은 초기 400일.
4. **시가총액 컷 검토 결과 (적용됨):** 스캔의 실제 필터는 `cond_cap_ok = (market_cap is None) or (market_cap >= 1000억)`. 즉 1,000억 미만(비-NULL)은 어차피 스캔 탈락. 그래서 수집 단계에서 **800억** 미만을 제외(1,000억보다 200억 낮춰 경계 종목 이력 보존). NULL·관심종목은 제외하지 않음.
5. **`run_daily.bat` 줄바꿈은 반드시 CRLF (중요 함정):** 이 .bat을 편집 도구로 다시 쓰면 줄바꿈이 LF로 바뀔 수 있는데, LF면 cmd가 `if/goto/블록`을 파싱 못 해 **창이 즉시 닫힌다(실행 실패).** 편집 후에는 반드시 CRLF로 되돌릴 것. 변환 한 줄:
   ```bat
   .venv\Scripts\python.exe -c "d=open('run_daily.bat','rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n');open('run_daily.bat','wb').write(d)"
   ```
   또한 .bat의 `if(...)` 블록 안에는 **괄호 `( )` 를 넣지 말 것**(블록이 깨짐).
6. **`next.config.ts`:** TS/ESLint 빌드 오류 무시(`ignoreBuildErrors`/`ignoreDuringBuilds`)가 켜져 있고, `eslint` 키가 현재 Next 버전에서 미지원이라 dev 실행 시 경고가 뜬다(동작엔 무해). 정리하면 좋다.
7. **npm 취약점 6건:** 로컬 전용이라 위험 낮음. **`npm audit fix --force` 금지**(앱 깨질 수 있음).

## 8. 앞으로 개발해야 할 우선순위

1. **준비 단계 단축 (가장 체감 큼, 잔여 병목):** `get_tickers_with_prices()`가 67만 행을 페이지네이션하는 비용을 줄이기. 예: daily_prices의 (ticker, max(date))만 가볍게 얻는 방법 검토(현재는 DB 구조 변경 금지 원칙상 뷰/RPC 미사용 → 필요 시 신중히 도입).
2. **(선택, 큰 효과) pykrx 날짜기준 일괄 수집:** "특정 날짜의 전 종목"을 한 번에 받으면 요청 수가 급감. 단 ⑴거래대금은 결과 보존 위해 **NULL로 저장**해야 하고, ⑵신규 종목 초기 수집은 여전히 FDR 필요, ⑶휴장일·형식 처리 검증 필요. 위험이 있어 충분한 테스트 후 옵션으로 도입.
3. **`next.config.ts` 정리 + 빌드 점검:** 오류 무시를 잠깐 끄고 `npm run build`로 숨은 오류 확인 후 정리.
4. **실행 로그 활용/회전:** `logs/run_daily.log`가 계속 누적되므로 주기적 정리 또는 회전.
5. **(선택) 부가 기능:** Windows 작업 스케줄러 자동 실행, 핵심 로직 간단 테스트, 엑셀/CSV 내보내기.

## 9. 절대 손상시키면 안 되는 파일 / DB / 기능

- **`scripts/run_scan.py`의 매매 조건·점수화·TOP10 산출 로직** — 임의 변경 금지(결과가 바뀜).
- **DB 테이블 구조와 기존 데이터** — 특히 `daily_prices`(일봉), `reports`/`scan_results`(리포트), `stock_notes`(사용자 메모). 행 삭제·스키마 변경 금지.
- **`daily_prices.trade_value = NULL` 저장 규칙** — 깨면 스캔 결과가 달라짐.
- **`.env.local`** — 키 5개. 외부 노출/깃 커밋 금지(현재 `.gitignore`로 제외됨).
- **`run_daily.bat`의 단계 순서와 실패 처리(②~⑥ 중단, ①⑦⑧ 계속)**, 그리고 **CRLF 줄바꿈**.

## 10. 업데이트 전 반드시 백업해야 할 항목

1. **git 커밋:** 작업 시작 전 현재 상태를 커밋(또는 브랜치 분기). 문제가 생기면 `git checkout`으로 복원.
2. **`.env.local`:** 별도 안전한 곳에 사본 보관(깃에는 안 올라감).
3. **Supabase DB:** 큰 변경(특히 적재 로직 변경) 전 주요 테이블(`daily_prices`, `reports`, `scan_results`, `stock_notes`) export/백업.
4. **`run_daily.bat`:** 편집 전 사본 보관(LF 변환 사고 대비). 편집 후 CRLF 확인.

## 11. 다음 개발자가 바로 이어서 작업할 수 있는 개발 순서

> 모든 단계 공통 원칙: **새 기능은 옵션으로 추가(기본값은 기존 동작) → 단독 명령으로 먼저 테스트 → 실패/속도 확인 → run_daily.bat에 연결 → git 커밋.** 기존에 잘 되는 건 건드리지 않는다.

0. **환경 재현 + 동작 확인 (필수 0순위):**
   `.env.local` 채우기 → `.venv` 생성 + `pip install -r scripts/requirements.txt` → `npm install` → `check_db.py`로 DB 확인 → `run_daily.bat` 한 번 돌려 전 과정 정상인지 확인(웹서버까지 뜨면 OK). **단, run_daily.bat 줄바꿈이 CRLF인지 먼저 확인(7-5번).**
1. **준비 단계 단축**(8-1) — load_stocks.py만 수정, 단독 테스트로 시간 측정 후 커밋.
2. **(선택) pykrx 날짜기준 수집**(8-2) — 별도 옵션/모드로 추가, 거래대금 NULL 유지, 결과가 기존과 동일한지 표본 비교 후 도입.
3. **next.config.ts 정리**(8-3) — 빌드 점검.
4. 나머지 선택 기능.

## 12. 현재 기준 가장 먼저 해야 할 작업

새 환경/새 개발자라면 **0순위는 "환경 재현 + `run_daily.bat` 1회 정상 실행 확인"**(특히 줄바꿈 CRLF 확인)이다. 그게 끝나면 **첫 개선 작업은 "준비 단계 단축"**(8-1, `get_tickers_with_prices` 비용 절감)이 가장 체감이 크다. pykrx 날짜기준 수집은 효과는 크지만 위험이 있으므로 그다음, 충분한 검증과 함께 진행한다.

---

### 부록: 핵심 매매 로직 요약 (도메인 이해용)
- **필수 조건:** 최근 N거래일 내 10일선이 60일선 골든크로스(일일5/주간10) · 현재가>60일선 · 60일선 상승 중
- **추가 필터:** 후행스팬 OK · 일목 앞 구름 양운 · 20일 평균거래대금 ≥ 10억 · 시총 ≥ 1,000억 · 최근 60일 중 60일선 아래였던 날 ≥ 10일 · 점수 70+
- **특수 규칙:** 이격도 20% 초과 → 제외 아닌 `CHASE_RISK`(추격 주의) 표시하고 포함 · DART CRITICAL 공시 → 자동 제외
- **파생값:** 점수(100점), 등급(A/B/WATCH/CHASE_RISK/EXCLUDE), 손절선=max(최근20일 저가, 60일선), 상승여력, 손익비, 1·2차 매수가(10·20일선)
