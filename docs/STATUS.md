# U-Turn Scanner — 개발 상태 점검 보고서

> **스냅샷 날짜:** 2026-05-23
> **목적:** 현재 개발 상태를 정리한 읽기 전용 점검 보고서. 향후 개발(예: GPT 등과 논의) 시 코드 없이도 맥락을 이해할 수 있도록 자립형으로 작성함.
> **점검 원칙:** 코드 수정·삭제·이동 없이 실제 파일/구조만 분석.

---

## 0. 한눈에 보기

- 개인용 국내주식 스캐너. **"60일 이동평균선 U턴(골든크로스 복귀) 패턴"** 종목을 매일 자동으로 찾아 100점 만점으로 점수화하고 TOP 10을 리포트로 보여 줌.
- 두 부분으로 구성: **Python 배치(수집·분석)** + **Next.js 웹앱(조회)**. 사이에 **Supabase(PostgreSQL)** 가 저장소.
- 개인 PC에서 `run_daily.bat` 더블클릭으로 운영. 외부 배포·서버 운영 전제 아님.
- **현재 상태: 기능적으로 사실상 완성 + 정상 가동 검증 완료.** 남은 것은 성능·안정성 개선(특히 시작 시간 단축)이 핵심.

---

## 1. 프로젝트 기본 정보

### 이름
`u-turn-scanner` (U턴 스캐너 — 60일 이동평균선 매매법)

### 사용 기술
| 영역 | 스택 |
|------|------|
| 데이터 수집·분석 | Python 3.x, FinanceDataReader, pykrx, pandas, python-dotenv, requests |
| 저장소 | Supabase (PostgreSQL + REST API), 테이블 10개 |
| 웹 화면 | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui(radix-ui), lightweight-charts |
| 외부 API | DART OpenAPI(공시·재무), Supabase REST |

### 실행 방식
- **전체 파이프라인:** `run_daily.bat` 더블클릭 → 9단계 자동 실행(아래 4번 참고)
- **웹앱 단독:** `npm run dev` → http://localhost:3000
- 개인 PC 전용. 인증/로그인 없음(환경변수로 키 관리).

### 주요 폴더 구조
```
u-turn-scanner/
├─ app/                     Next.js 화면 (App Router)
│  ├─ page.tsx              홈(최신 일일 리포트 + 시장 요약)
│  ├─ reports/[id]/         리포트 상세 (TOP10 표, 가장 큰 화면)
│  ├─ stocks/[ticker]/      종목 상세 + 차트(Chart.tsx) + 메모(MemoForm.tsx)
│  ├─ backtest/             백테스트 결과
│  ├─ alerts/               알림 목록 + 읽음 처리(AlertActions.tsx)
│  ├─ history/              과거 리포트 목록
│  ├─ search/               검색
│  ├─ _components/          SearchForm.tsx
│  └─ layout.tsx, globals.css
├─ components/ui/           공용 UI (button.tsx, table.tsx)
├─ lib/                     supabase.ts(DB 접속), utils.ts
├─ scripts/                 Python 배치 (14개)
├─ docs/                    DB_SCHEMA.md, STATUS.md(이 문서)
├─ public/                  정적 이미지
├─ run_daily.bat            매일 실행 배치(9단계)
└─ .env.local              환경변수 (키 5개, git 제외)
```

### 핵심 파일 목록
| 파일 | 역할 |
|------|------|
| `scripts/run_scan.py` | ★ 핵심: 5조건 + 추가필터 + 100점 점수화 → TOP10 저장 |
| `run_daily.bat` | 전체 파이프라인 오케스트레이션(9단계) |
| `scripts/load_stocks.py` | 종목 마스터 + 일봉 수집(FinanceDataReader) |
| `scripts/run_backtest.py` | 60거래일 시뮬레이션(전략 청산 vs 단순 보유) |
| `scripts/generate_alerts.py` | 알림 생성(중복 방지 포함) |
| `lib/supabase.ts` | DB 접속 단일 진입점 |
| `app/reports/[id]/page.tsx` | 리포트 상세 화면 |
| `docs/DB_SCHEMA.md` | 테이블 10개 구조 정의 |
| `scripts/check_db.py` | DB 상태 점검(읽기 전용) |
| `.env.local` | 환경변수 5개 (절대 외부 노출/커밋 금지) |

### Python 배치 14개
- 수집: `load_stocks.py`(종목+일봉), `load_indices.py`(지수), `load_sectors.py`/`load_financials.py`/`load_news_risks.py`(DART), `load_kospi_all.py`·`load_prices.py`(구버전 보조)
- 분석: `run_scan.py`(핵심), `run_backtest.py`, `replay_history.py`(과거 리포트 재생), `generate_alerts.py`
- 도구: `check_conditions.py`(단일 종목 디버깅), `analyze_backtest.py`(지표 변별력 분석), `check_db.py`(DB 점검)

---

## 2. 현재 구현된 기능 (실제 코드 기준)

| 기능 | 위치 | 비고 |
|------|------|------|
| 종목/리포트 검색 | `app/search` + `SearchForm.tsx` | 일일/주간·날짜로 검색, 가장 가까운 이전 리포트로 이동 |
| 차트 조회 | `app/stocks/[ticker]/Chart.tsx` | lightweight-charts 캔들 + 이동평균선 |
| 이동평균선 계산 | `run_scan.py` | 10/20/60일 이평, 골든크로스, 이격도, 일목(후행스팬·구름) |
| 60일선 U턴 핵심 로직 | `run_scan.py` | 아래 부록 A 참고 |
| 리포트 작성 | `run_scan.py` → `reports`+`scan_results` | 일일/주간, TOP10 점수·등급·한줄코멘트 |
| 메모 저장 | `MemoForm.tsx` → `stock_notes` | 관심도·매매가·손절가·자유메모 (UPSERT) |
| 시장 요약 | `reports/[id]/page.tsx` | KOSPI/KOSDAQ 60일선 위/아래 → 강세·중립·약세 |
| 재무 배지 | DART `financials` | 정상/주의/고위험/데이터없음 |
| 뉴스 리스크 필터 | `news_risks` | 공시 CRITICAL 자동 제외, WARN 표시 |
| 백테스트 | `run_backtest.py` + `/backtest` | 전략 청산 vs 단순 보유, 승률·수익·청산사유 통계 |
| 알림 | `generate_alerts.py` + `/alerts` | 신규 위험공시/TOP신규/관심종목위험, 읽음 처리, 중복방지 |
| 과거 리포트 | `/history` | 최근 60개 목록 |
| DB 점검 | `check_db.py` | 테이블 존재·행수·신선도 확인(읽기 전용) |
| 신규 상장 자동 반영 | `run_daily.bat` [1/9] | `--stocks-only`로 매일 종목 마스터 갱신 |

**구현되지 않은 기능(설계상 없음):** 엑셀/CSV 내보내기, 로그인/인증, 설정 화면 UI, 자동 스케줄링.

---

## 3. 미완성 / 임시 처리 여부

- 소스 코드 전체 검색 결과 **TODO / FIXME / 더미 데이터 / "준비중" / 미연결 코드 없음.**
- 로드맵 21단계(알림 시스템)까지 + 안정화 작업까지 모두 연결됨.
- 즉 "짓다 만 기능"은 없음. 운영상 약한 지점은 5번(위험 요소)에 정리.

---

## 4. 실행 가능 여부

**실행 가능 (검증 완료).** 2026-05-22 기준 수집→분석→리포트→화면까지 전 과정 정상 동작 확인, 홈 리포트가 최신 날짜로 갱신되는 것까지 검증함.

### 실행 명령
```bat
REM 전체 파이프라인 (매일)
run_daily.bat

REM 웹앱만
npm run dev            REM http://localhost:3000

REM DB 상태 점검 (읽기 전용)
.venv\Scripts\python.exe scripts\check_db.py

REM 종목 마스터만 빠르게 갱신 (신규 상장 반영, 수십 초)
.venv\Scripts\python.exe scripts\load_stocks.py --market ALL --stocks-only
```

### run_daily.bat 9단계
1. 종목 마스터 갱신 (`load_stocks.py --stocks-only`) — 신규 상장 반영, 실패해도 계속
2. 일봉 갱신 (`load_stocks.py --prices-only --days 15`)
3. 시장 지수 (`load_indices.py`)
4. 뉴스 리스크 (`load_news_risks.py`)
5. 일일 스캔 (`run_scan.py --report-type daily`)
6. 주간 스캔 (`run_scan.py --report-type weekly`)
7. 백테스트 (`run_backtest.py`) — 실패해도 계속
8. 알림 생성 (`generate_alerts.py`) — 실패해도 계속
9. 웹 서버 기동 + 브라우저 자동 오픈
- 1~6단계는 실패 시 멈춤, 1·7·8단계는 경고만 내고 계속.

### 전제조건 (현재 모두 충족)
- `.env.local` 키 5개: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DART_API_KEY`
- `.venv`(Python 가상환경) + `node_modules` 설치 완료
- Supabase 테이블 10개 + 데이터 존재 확인 완료

---

## 5. 오류 또는 위험 요소

실행을 막는 오류는 없음. 주의/개선 필요 지점:

| 구분 | 내용 | 영향도 |
|------|------|--------|
| 성능 | 일봉 갱신이 종목 2,500여 개를 하나씩 순차 수집 → 약 40분 소요 | **높음(체감 큼)** |
| 데이터 빈틈 | 일봉 갱신이 "최근 15일치" 기준 → 2주 넘게 미실행 시 공백 가능 | 중 |
| 빌드 점검 | `next.config.ts`에 TS/ESLint 오류 무시 켜짐 → 숨은 오류 가림(config 자체 사소한 타입경고 1건) | 중 |
| 데이터 위생 | 상장폐지 종목이 `stocks`에 계속 남음(정리 로직 없음) | 낮음 |
| 보안 | service role 키 로컬 평문 저장(개인 PC라 허용). `.env.local`은 `.gitignore`로 커밋 제외(양호) | 낮음 |
| 패키지 | npm 취약점 6건(로컬 도구라 위험 낮음). **`npm audit fix --force` 금지**(앱 깨질 수 있음) | 낮음 |
| 외부 제한 | DART 분당 호출 제한 → `--sleep`으로 간격 조절 | 낮음 |
| Git 표시 | 다수 파일이 "수정됨"으로 뜨나 줄바꿈(CRLF) 차이일 뿐, 내용 변경 아님 | 낮음(혼동 유발) |

import 오류·패키지 누락·경로 문제·UI 깨짐·미연결 기능은 발견되지 않음.

---

## 6. 앞으로 개발해야 할 순서 (초보자 안전 순서)

> **원칙:** 한 번에 하나씩 · 매번 실제 PC에서 검증 · 단계마다 git 커밋 · 동작하는 기능은 건드리지 않기.

1. **시작 시간 단축** (체감 가장 큼)
   - (a) **시총 미달 종목 제외:** 스캔 조건이 어차피 시가총액 ≥ 1,000억이므로, 그 미만 종목의 일봉 수집을 건너뜀 → 대상 수 감소. (안전, 권장 1순위)
   - (b) **날짜 기준 수집:** 종목별이 아니라 "특정 날짜의 전 종목"을 pykrx로 한 번에 수집 → 요청 수 2,500여 회 → 며칠치(5~10회). 40분 → 1~2분 기대. (효과 큼, 데이터 형식·신뢰성 검증 필요)
2. **데이터 빈틈 방지:** DB의 마지막 날짜를 읽어 그 다음 날부터 현재까지 자동 수집(며칠 건너뛰어도 안전).
3. **실행 로그 남기기:** 매 실행 결과를 파일에 한 줄씩 기록 → 실패 추적 용이.
4. **숨은 오류 점검:** `next.config.ts`의 오류 무시를 잠깐 끄고 `npm run build`로 점검 후 정리.
5. **(선택) 부가 기능:** 엑셀/CSV 내보내기, Windows 작업 스케줄러 자동 실행, 핵심 로직 간단 테스트.

---

## 7. 최종 요약

```
[현재 개발 상태 요약]
- 완성된 부분:
    데이터 수집(종목·일봉·지수·재무·공시), 핵심 U턴 스캔/점수화, 일일·주간 리포트,
    종목 차트, 메모 저장, 백테스트, 알림, 과거 리포트, 검색, 시장 요약.
    (웹 화면 7개 + Python 배치 14개 모두 동작)
- 일부 구현된 부분:
    신규 상장 자동 반영(매일 갱신, 가격은 다음 실행부터). 데이터 신선도는 최근 15일 윈도우 기준.
- 미완성 부분:
    엑셀/CSV 내보내기 없음, 설정 화면 UI 없음, 자동 스케줄링 없음, 실행 로그 없음. (모두 필수 아님)
- 바로 실행 가능한지:
    예. run_daily.bat(전체) 또는 npm run dev(웹). end-to-end 검증 완료.
- 다음에 가장 먼저 해야 할 일:
    시작 시간 단축 — 일봉 수집 방식 개선(안전한 "시총 미달 제외"부터, 그다음 날짜 기준 수집).
- 주의해야 할 파일/기능:
    run_scan.py(핵심 로직), load_stocks.py(수집 방식 개선 대상),
    run_daily.bat(실행 순서), next.config.ts(오류 무시 설정),
    .env.local(키, 절대 외부 노출·커밋 금지).
```

---

## 부록 A. 핵심 매매 로직 (GPT가 도메인 이해용)

**필수 통과 조건** (하나라도 빠지면 제외)
- 최근 N거래일 내 10일선이 60일선을 **골든크로스** (일일 5일 / 주간 10일 윈도우)
- 현재가가 **60일선 위**
- **60일선이 상승 중** (5거래일 전보다 높음)

**추가 필터** (후보가 되려면 모두 충족)
- 후행스팬 OK · 일목 앞 구름 양운 · 20일 평균거래대금 ≥ 10억 · 시가총액 ≥ 1,000억
- 최근 60일 중 60일선 아래였던 날 ≥ 10일 (U턴 검증) · 점수 70 이상

**기타 규칙**
- 이격도 20% 초과 → 제외가 아니라 `CHASE_RISK`(추격 주의)로 표시하되 후보 포함
- DART 공시 위험도 CRITICAL → 자동 제외
- 모든 판정은 **KRX 정규장 종가 기준**. 투자 판단 보조 도구일 뿐 매매 권유 아님.

**파생 계산값:** 점수(100점), 등급(A/B/WATCH/CHASE_RISK/EXCLUDE), 손절선(=max(최근20일 저가, 60일선)), 상승여력(60일 고가까지 %), 손익비(상승여력/손절폭), 1·2차 매수 후보가(10·20일선).

## 부록 B. DB 테이블 10개

`stocks`(종목 마스터) · `daily_prices`(일봉) · `market_indices`(지수) · `news_risks`(공시 위험도) · `financials`(재무) · `reports`(리포트 헤더) · `scan_results`(TOP N 결과, 컬럼 최다) · `backtest_results`(백테스트) · `stock_notes`(사용자 메모) · `alerts`(알림)

> 상세 컬럼·키는 `docs/DB_SCHEMA.md` 참고. 모든 접근은 Supabase REST(`/rest/v1`), 배치는 service role 키 / 웹앱은 anon 키 사용.

## 부록 C. 최근 변경 이력 (2026-05-23 기준)

오늘 커밋(`9894206`)에 포함된 안정화 작업:
- **일봉 매일 갱신 버그 수정:** `--skip-existing`(전 종목 건너뜀)이 매일 갱신을 무력화하던 문제 → `load_stocks.py`에 `--days N` 옵션 추가, `run_daily.bat`을 `--days 15`로 변경.
- **신규 상장 자동 반영:** `run_daily.bat`에 [1/9] 종목 마스터 갱신 단계(`--stocks-only`) 추가.
- **DB 점검 도구 추가:** `scripts/check_db.py`(읽기 전용).
- **정리:** 브라우저 탭 제목 "Create Next App" → "U턴 스캐너"(`layout.tsx`), 미사용 `lucide-react` 패키지 제거.
