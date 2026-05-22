# U-Turn Scanner (60일 이동평균선 매매법)

코스피·코스닥 전 종목을 매일 스캔해서 **60일 이동평균선 U턴(골든크로스 복귀) 패턴**에
부합하는 종목을 100점 만점으로 점수화하고, 상위 종목을 리포트로 보여 주는 개인용 도구다.

- **데이터 수집·분석**: Python 배치 스크립트 (`scripts/`) — 가격·지수·재무·공시를 받아 Supabase에 적재하고, 스캔/백테스트/알림을 생성한다.
- **저장소**: Supabase (PostgreSQL + REST API)
- **화면**: Next.js 웹앱 (`app/`) — 일일/주간 리포트, 종목 상세 차트, 백테스트, 알림, 메모를 본다.

> 개인이 자기 PC에서 돌리는 용도다. 외부 배포·서버 운영을 전제로 하지 않는다.
> 모든 판정은 **KRX 정규장 종가 기준**이며, 투자 판단의 보조 도구일 뿐 매매 권유가 아니다.

관련 문서:
- 일상 사용법 → `60일 이동평균선 매매법/사용자_매뉴얼.md` (워크스페이스 폴더)
- DB 테이블 구조 → `docs/DB_SCHEMA.md`

---

## 1. 필요한 것

| 항목 | 버전 / 비고 |
|------|-------------|
| Windows | `run_daily.bat` 기준 (다른 OS는 스크립트를 직접 실행) |
| Python | 3.10 이상 (가상환경 `.venv` 사용) |
| Node.js | 18 이상 (Next.js 16) |
| Supabase 프로젝트 | URL + anon key + service role key |
| DART OpenAPI 키 | 공시·재무 수집용 (https://opendart.fss.or.kr) |

---

## 2. 설치

### 2-1. 저장소 클론 / 이동

```bash
cd C:\Users\iambo\dev\u-turn-scanner
```

### 2-2. 환경변수 (`.env.local`)

프로젝트 루트에 `.env.local` 파일을 만들고 아래 5개 값을 채운다.

```ini
# 웹앱(브라우저)에서 사용 — 공개되어도 되는 값
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 배치 스크립트(서버 권한)에서 사용 — 절대 외부 노출 금지
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# DART OpenAPI (공시·재무)
DART_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_URL`은 같은 값이어도 된다.
스크립트는 `SUPABASE_URL`을 먼저 찾고 없으면 `NEXT_PUBLIC_SUPABASE_URL`로 폴백한다.

### 2-3. Python 가상환경 + 패키지

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r scripts\requirements.txt
```

`scripts/requirements.txt`에는 `pykrx`, `finance-datareader`, `supabase`,
`python-dotenv`, `pandas`가 들어 있다.

### 2-4. Node 패키지

```bash
npm install
```

### 2-5. DB 테이블 생성

Supabase 프로젝트에 테이블이 있어야 한다. 컬럼·키 정의는 `docs/DB_SCHEMA.md`를 참고해
Supabase SQL 에디터에서 테이블을 만든다. 필요한 테이블은 다음과 같다.

```
stocks · daily_prices · market_indices · news_risks · financials
reports · scan_results · backtest_results · stock_notes · alerts
```

---

## 3. 최초 데이터 적재 (한 번만)

순서가 중요하다. 종목 마스터 → 가격 → 부가 데이터(업종/재무/공시/지수) 순으로 채운다.

```bash
# 1) 종목 마스터 + 일봉 (코스피+코스닥 전체, 수십 분 소요)
.venv\Scripts\python.exe scripts\load_stocks.py --market ALL

# 2) 업종 코드 (DART, 8~15분) — 한 번만, 이후 분기 1회
.venv\Scripts\python.exe scripts\load_sectors.py

# 3) 재무 정보 (DART 사업보고서)
.venv\Scripts\python.exe scripts\load_financials.py

# 4) 시장 지수 (KOSPI/KOSDAQ)
.venv\Scripts\python.exe scripts\load_indices.py

# 5) 공시 기반 뉴스 리스크 (최근 30일)
.venv\Scripts\python.exe scripts\load_news_risks.py

# 6) 최초 스캔 (일일 + 주간)
.venv\Scripts\python.exe scripts\run_scan.py --report-type daily
.venv\Scripts\python.exe scripts\run_scan.py --report-type weekly
```

과거 리포트를 만들어 백테스트 표본을 쌓고 싶으면 `replay_history.py`로
지난 날짜들을 재생한 뒤 `run_backtest.py`를 돌린다.

```bash
.venv\Scripts\python.exe scripts\replay_history.py        # 과거 리포트 재생성
.venv\Scripts\python.exe scripts\run_backtest.py          # 60거래일 시뮬레이션
```

---

## 4. 매일 실행

장 마감 후(또는 다음 날 아침) **`run_daily.bat` 더블클릭 한 번**이면 끝난다.
배치는 다음 8단계를 순서대로 실행한다.

1. 일봉 갱신 (`load_stocks.py --prices-only --skip-existing`)
2. 시장 지수 갱신 (`load_indices.py`)
3. 뉴스 리스크 갱신 (`load_news_risks.py`, 최근 30일)
4. 일일 스캔 (`run_scan.py --report-type daily`)
5. 주간 스캔 (`run_scan.py --report-type weekly`)
6. 백테스트 갱신 (`run_backtest.py`, 미청산 포지션 재평가)
7. 알림 생성 (`generate_alerts.py`)
8. 웹 서버 기동(`npm run dev`) + 브라우저 자동 오픈

1~5단계는 실패 시 멈추고, 6~8단계는 실패해도 경고만 내고 계속 진행한다.

> 업종(`load_sectors.py`)과 재무(`load_financials.py`)는 자주 안 바뀌므로
> 매일 배치에는 들어 있지 않다. 분기에 한 번, 또는 신규 상장 추가 시 수동으로 돌린다.

---

## 5. 웹앱만 따로 실행

```bash
npm run dev      # 개발 서버 (http://localhost:3000)
npm run build    # 프로덕션 빌드
npm run start    # 빌드 결과 실행
npm run lint     # ESLint
```

주요 화면:

| 경로 | 내용 |
|------|------|
| `/` | 최신 일일 리포트 TOP 10 + 시장 요약 |
| `/reports/[id]` | 특정 리포트 상세 |
| `/stocks/[ticker]` | 종목 차트 + 지표 + 메모(관심도/매매가/자유메모) |
| `/backtest` | 백테스트 결과(전략 청산 vs 단순 보유) |
| `/alerts` | 알림 목록(읽음 처리 가능) |
| `/history` | 과거 리포트 목록 |
| `/search` | 종목/날짜 검색 |

---

## 6. 디렉터리 구조

```
u-turn-scanner/
├─ app/                  Next.js 화면 (App Router)
│  ├─ page.tsx           홈(최신 일일 리포트)
│  ├─ reports/[id]/      리포트 상세
│  ├─ stocks/[ticker]/   종목 상세 + 차트 + 메모
│  ├─ backtest/  alerts/  history/  search/
│  └─ layout.tsx  globals.css
├─ lib/                  supabase 클라이언트, 유틸
├─ scripts/              Python 배치
│  ├─ load_stocks.py        종목 + 일봉
│  ├─ load_prices.py        (구) 관심종목 일봉 적재
│  ├─ load_kospi_all.py     코스피 전체 + 시가총액
│  ├─ load_indices.py       시장 지수
│  ├─ load_sectors.py       업종 코드(DART)
│  ├─ load_financials.py    재무(DART)
│  ├─ load_news_risks.py    공시 위험도(DART)
│  ├─ run_scan.py           ★ 핵심: 5조건 + 점수화 + TOP 10
│  ├─ run_backtest.py       60일 시뮬레이션
│  ├─ replay_history.py     과거 리포트 재생
│  ├─ generate_alerts.py    알림 생성
│  ├─ check_conditions.py   단일 종목 조건 점검(디버깅)
│  └─ analyze_backtest.py   지표별 변별력 분석(튜닝용)
├─ run_daily.bat         매일 실행 배치(8단계)
└─ .env.local           환경변수(깃 제외)
```

---

## 7. 매매 로직 한눈에

**필수 통과 조건** (하나라도 빠지면 제외)

- 최근 N거래일 내 **10일선이 60일선을 골든크로스** (일일 5일 / 주간 10일 윈도우)
- 현재가가 **60일선 위**
- **60일선이 상승 중** (5거래일 전보다 높음)

**추가 필터** (후보가 되려면 모두 충족)

- 후행스팬 OK · 일목 앞 구름 양운 · 20일 평균거래대금 ≥ 10억 · 시가총액 ≥ 1,000억 · 최근 60일 중 60일선 아래였던 날 ≥ 10일(U턴 검증) · 점수 70 이상

**이격도 20% 초과**는 제외가 아니라 `CHASE_RISK`(추격 주의)로 표시하되 후보에는 포함한다.

**자동 제외**: DART 공시상 위험도 CRITICAL 종목

점수·등급·이격도 해석은 워크스페이스의 `사용자_매뉴얼.md`에 자세히 정리해 두었다.

---

## 8. 자주 막히는 곳

- **`환경변수 ... 가 비어있습니다`** → `.env.local` 위치(루트)와 키 이름 확인.
- **일봉이 안 받아짐** → KRX/네이버 점검 시간대일 수 있다. `load_stocks.py`는 FinanceDataReader 백엔드라 KRX 점검과 무관하지만, 장중에는 종가가 확정되지 않으니 마감 후 실행.
- **공시·재무가 비어 있음** → `DART_API_KEY` 확인. DART는 분당 호출 제한이 있어 `--sleep` 옵션으로 간격을 둔다.
- **스캔 결과 0개** → 시장 약세장에서는 정상이다. `run_scan.py` 로그 하단의 조건별 통과 수(`cond_*`)로 어디서 걸렸는지 확인.
