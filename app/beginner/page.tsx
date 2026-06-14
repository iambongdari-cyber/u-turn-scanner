// app/beginner/page.tsx
// v0.4-3 오늘의 투자판단 — 날짜 파라미터 (?date=YYYY-MM-DD) 지원
//
// 화면 순서:
// 1~3. 오늘 결론 + 오늘 할 일 + 꼭 보세요 (TopBrief)
// 4. 내 예약매수 대기 + 5. 내 보유종목 점검 (MyPlansSection)
// 6. 관심 후보 + 7. 참고 후보 (CollapsibleCandidates)
// 8. 지난 투자판단 (MissedReportsBox — 클릭 가능 + 날짜별 [보기])
// 9. GPT 상담용 리포트 복사

import Link from 'next/link';
import { loadBeginnerData, loadMissedReports, loadPreviousScanRows } from '../_lib/beginner_data';
import { judgeRow } from '../_lib/beginner';
import { ActionRecommend, AI_DISCLAIMER, KIWOOM_DISCLAIMER, NOT_REAL_TRADE_DISCLAIMER } from '../_lib/trade_plan';
import { computeUrgency } from '../_lib/today_brief';

import CoachShell from './_components/CoachShell';
import MyPlansSection from './_components/MyPlansSection';
import CollapsibleCandidates from './_components/CollapsibleCandidates';
import MissedReportsBox from './_components/MissedReportsBox';
// v0.7.5: PC/모바일 UX 분리 — 모바일은 Link 로 /beginner/gpt-report 이동,
// PC 는 GptReportButton 으로 같은 화면에서 인라인 펼침
import GptReportButton from './_components/GptReportButton';
import MarketRegimeBox from './_components/MarketRegimeBox';
import StrategyConditionBox from './_components/StrategyConditionBox';
// v0.7.6: RecommendedActionsBox / ForbiddenActionsBox 화면 노출 제거 (오늘의 결론과 중복).
// 데이터는 보존 — GPT 리포트 §3 §4 그대로 + MarketRegimeBox 자세히 보기에 보조 표시.

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  // Next 15: searchParams 는 Promise
  searchParams?: Promise<{ date?: string }>;
}

export default async function BeginnerPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const rawDate = typeof sp.date === 'string' ? sp.date : undefined;
  const requestedDate = rawDate && DATE_RE.test(rawDate) ? rawDate : undefined;

  const data = await loadBeginnerData(requestedDate);
  const missed = await loadMissedReports();
  const prevScan = await loadPreviousScanRows(requestedDate);

  const rowsByTicker: Record<string, typeof data.rows[number]> = {};
  for (const r of data.rows) rowsByTicker[r.ticker] = r;
  const priceByTicker: Record<string, number> = {};
  for (const [t, p] of data.priceByTicker.entries()) priceByTicker[t] = p;

  const previousJudgementByTicker: Record<string, ActionRecommend> = {};
  for (const r of prevScan.rows) {
    previousJudgementByTicker[r.ticker] = judgeRow(r).ai_judgement;
  }

  // "지난 투자판단 보기" 모드 — URL ?date= 가 주어진 경우
  const isPastView = !!requestedDate;
  // 최신 base_date (지난 판단 보기인지 판별 + 비교용)
  // missed.reports[0] 이 최신
  const latestAvailableDate = missed.reports[0]?.date ?? null;

  if (!data.hasData) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Header
          baseDate={data.base_date}
          isPastView={isPastView}
          latestDate={latestAvailableDate}
          requestedDate={requestedDate ?? null}
        />
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <h2 className="text-lg font-semibold text-red-900">
            {requestedDate ? `${requestedDate} 사이드카 데이터 없음` : '사이드카 데이터 없음'}
          </h2>
          <p className="mt-2">
            {requestedDate
              ? `해당 날짜의 scan_dump_${requestedDate}.json 파일이 없거나 비어있습니다. 다른 날짜를 선택하거나 `
              : 'scan_dump_latest.json / sector_dump_latest.json 파일이 없거나 비어있습니다. '}
            <Link href="/beginner" className="underline">최신 투자판단</Link>으로 돌아가세요.
          </p>
        </div>
      </main>
    );
  }

  const interestRows = data.rows.filter(r => {
    const u = computeUrgency({
      plan: null,
      row: r,
      currentPrice: r.close ?? null,
      previousJudgement: previousJudgementByTicker[r.ticker] ?? null,
    });
    return u.level === 'INTEREST';
  });
  const referenceRows = data.rows.filter(r => {
    const u = computeUrgency({
      plan: null,
      row: r,
      currentPrice: r.close ?? null,
      previousJudgement: previousJudgementByTicker[r.ticker] ?? null,
    });
    return u.level === 'LATER' || u.level === 'INTEREST' || u.level === 'TODAY' || u.level === 'URGENT';
  });
  const bottomRows = referenceRows.filter(r => judgeRow(r).category === 'BOTTOM_UTURN');
  const leaderRows = referenceRows.filter(r => judgeRow(r).category === 'CURRENT_LEADER');
  const lateRows = referenceRows.filter(r => judgeRow(r).category === 'LATE_STRONG');

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <Header
        baseDate={data.base_date}
        isPastView={isPastView}
        latestDate={latestAvailableDate}
        requestedDate={requestedDate ?? null}
      />

      {/* v0.6.1: CoachShell 이 §0 오늘의 결론 + §1~§4 + §5 매매계획 기록 대상을 한 번에 묶고
                  selectTradePlanTargets 를 단 한 번 호출해 양쪽에 동일 데이터 전달 */}
      <CoachShell
        regime={data.marketRegime}
        rows={data.rows}
        priceByTicker={priceByTicker}
        previousJudgementByTicker={previousJudgementByTicker}
        middleBoxes={
          <>
            <MarketRegimeBox regime={data.marketRegime} />
            <StrategyConditionBox />
          </>
        }
      />

      {/* §6 §7 내 보유종목 점검 + 내 예약매수 대기 */}
      <MyPlansSection rowsByTicker={rowsByTicker} priceByTicker={priceByTicker} />

      {/* 6 + 7. 관심 후보 + 참고 후보 */}
      <CollapsibleCandidates
        interestRows={interestRows}
        bottomRows={bottomRows}
        leaderRows={leaderRows}
        lateRows={lateRows}
      />

      {/* 8. 지난 투자판단 */}
      <MissedReportsBox
        reports={missed.reports}
        todayDate={latestAvailableDate}
        effectiveDate={data.effectiveDate}
      />

      {/* 9. GPT 리포트 — v0.7.5 PC/모바일 분리 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">💬 GPT 상담 / 확인</h2>
        <p className="mt-1 text-xs text-slate-500">
          {isPastView
            ? `${data.base_date ?? requestedDate} 기준 투자판단 리포트를 생성합니다.`
            : 'ChatGPT 에게 그대로 붙여넣어 상담받을 수 있는 행동 중심 마크다운 리포트를 생성합니다.'}
        </p>

        {/* 모바일 (md 미만) — 별도 페이지 Link (안정성 우선) */}
        <div className="mt-3 md:hidden">
          <Link
            href={requestedDate ? `/beginner/gpt-report?date=${requestedDate}` : '/beginner/gpt-report'}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          >
            💬 GPT 상담용 리포트 보기/복사
          </Link>
          <p className="mt-1 text-[10px] text-slate-500">
            모바일 — 별도 페이지에서 열림
          </p>
        </div>

        {/* PC (md 이상) — 같은 화면에서 인라인 펼침 (편의성 우선) */}
        {/* v0.7.6.2: PC wrapper + flex 컨테이너에 min-w-0 / overflow-hidden 추가 — 인라인 펼침 시 가로 확장 방지 */}
        <div className="mt-3 hidden min-w-0 max-w-full overflow-hidden md:block">
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <GptReportButton
              base_date={data.base_date}
              rows={data.rows}
              priceByTicker={priceByTicker}
              previousJudgementByTicker={previousJudgementByTicker}
              marketRegime={data.marketRegime}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            PC — 버튼 클릭 시 이 카드 안에서 펼침
          </p>
        </div>
      </section>

      <footer className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <div>※ {AI_DISCLAIMER}</div>
        <div>※ {KIWOOM_DISCLAIMER}</div>
        <div>※ {NOT_REAL_TRADE_DISCLAIMER}</div>
        <div className="mt-1">
          <Link href="/" className="text-indigo-600 hover:underline">← 홈으로</Link>
        </div>
      </footer>
    </main>
  );
}

function Header({
  baseDate, isPastView, latestDate, requestedDate,
}: {
  baseDate: string | null;
  isPastView: boolean;
  latestDate: string | null;
  requestedDate: string | null;
}) {
  return (
    <header className="border-b border-slate-200 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">📊 오늘의 투자판단</h1>
        {baseDate && (
          <span className={`text-sm ${isPastView ? 'rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800' : 'text-slate-500'}`}>
            기준일: {baseDate}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        퇴근 후 10분, 오늘 해야 할 행동만 보여드립니다.
      </p>
      {isPastView ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          📜 지난 투자판단을 보고 있습니다.
          <br />
          현재 날짜가 아니라 선택한 기준일({requestedDate})의 스냅샷입니다.
          {latestDate && latestDate !== requestedDate && (
            <>
              {' '}
              <Link href="/beginner" className="ml-1 underline">
                최신({latestDate})으로 돌아가기 →
              </Link>
            </>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          ※ 이 화면은 매수/매도 추천이 아닙니다. 모든 판단은 개인 기록용이며 실제 최종 결정은 사용자가 합니다.
        </p>
      )}
    </header>
  );
}
