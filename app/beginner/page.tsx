// app/beginner/page.tsx
// v0.4 오늘의 투자판단 (구 "초보자 모드" — UI 명칭은 "오늘의 투자판단")
//
// 화면 구성 (사용자 명세 §12 우선순위):
// 1. 오늘의 1픽
// 2. 내 예약매수 대기
// 3. 내 보유종목 점검
// 4. 바닥 U턴 후보
// 5. 현재 주도주
// 6. 후발 강세 후보
// 7. 놓친 리포트
// 8. GPT 리포트 복사 / 확인 완료

import Link from 'next/link';
import { loadBeginnerData, loadMissedReports, loadPreviousScanRows } from '../_lib/beginner_data';
import { judgeRow } from '../_lib/beginner';
import { ActionRecommend, AI_DISCLAIMER, KIWOOM_DISCLAIMER, NOT_REAL_TRADE_DISCLAIMER } from '../_lib/trade_plan';
import TodayTopPick from './_components/TodayTopPick';
import MyPlansSection from './_components/MyPlansSection';
import CategoryCard from './_components/CategoryCard';
import MissedReportsBox from './_components/MissedReportsBox';
import GptReportButton from './_components/GptReportButton';

export const dynamic = 'force-dynamic';

export default async function BeginnerPage() {
  const data = await loadBeginnerData();
  const missed = await loadMissedReports();
  const prevScan = await loadPreviousScanRows();

  // 카테고리 분류 (BOTTOM_UTURN / CURRENT_LEADER / LATE_STRONG)
  const bottomRows = data.rows.filter(r => {
    const v = judgeRow(r);
    return v.category === 'BOTTOM_UTURN';
  }).slice(0, 20);

  const leaderRows = data.rows.filter(r => {
    const v = judgeRow(r);
    return v.category === 'CURRENT_LEADER';
  }).slice(0, 20);

  const lateRows = data.rows.filter(r => {
    const v = judgeRow(r);
    return v.category === 'LATE_STRONG';
  }).slice(0, 20);

  // rowsByTicker (보유/예약 섹션이 row 정보 필요할 때 매핑)
  const rowsByTicker: Record<string, typeof data.rows[number]> = {};
  for (const r of data.rows) rowsByTicker[r.ticker] = r;

  // priceByTicker (Object 형태로 client 에 전달)
  const priceByTicker: Record<string, number> = {};
  for (const [t, p] of data.priceByTicker.entries()) priceByTicker[t] = p;

  // 어제 AI 판단 매핑
  const previousJudgementByTicker: Record<string, ActionRecommend> = {};
  for (const r of prevScan.rows) {
    previousJudgementByTicker[r.ticker] = judgeRow(r).ai_judgement;
  }

  if (!data.hasData) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Header baseDate={data.base_date} />
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <h2 className="text-lg font-semibold text-red-900">사이드카 데이터 없음</h2>
          <p className="mt-2">
            scan_dump_latest.json / sector_dump_latest.json 파일이 없거나 비어있습니다.
            <br />
            run_daily.bat 을 실행한 후 다시 방문해 주세요.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <Header baseDate={data.base_date} />

      {/* 1. 오늘의 1픽 */}
      <TodayTopPick rows={data.rows} />

      {/* 2. 내 예약매수 대기 + 3. 내 보유종목 점검 (한 클라이언트 컴포넌트 안) */}
      <MyPlansSection rowsByTicker={rowsByTicker} priceByTicker={priceByTicker} />

      {/* 4. 바닥 U턴 후보 */}
      <CategorySection
        title="🌱 바닥 U턴 후보"
        subtitle="오랜 하락을 마치고 60일선 위로 회복 중인 종목"
        rows={bottomRows}
      />

      {/* 5. 현재 주도주 */}
      <CategorySection
        title="🏆 현재 주도주"
        subtitle="같은 섹터 안에서 거래대금과 가격 위치가 동시에 좋은 종목"
        rows={leaderRows}
      />

      {/* 6. 후발 강세 후보 */}
      <CategorySection
        title="🥈 후발 강세 후보"
        subtitle="주도주를 뒤따라가는 후발 강세 종목"
        rows={lateRows}
      />

      {/* 7. 놓친 리포트 */}
      <MissedReportsBox reports={missed.missedReports} todayDate={data.base_date} />

      {/* 8. GPT 리포트 복사 + 확인 완료 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">💬 GPT 상담 / 확인</h2>
        <p className="mt-1 text-xs text-slate-500">
          ChatGPT 에게 그대로 붙여넣어 상담받을 수 있는 마크다운 리포트를 생성합니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <GptReportButton
            base_date={data.base_date}
            rows={data.rows}
            priceByTicker={priceByTicker}
            previousJudgementByTicker={previousJudgementByTicker}
          />
        </div>
      </section>

      {/* 하단 안내 */}
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

function Header({ baseDate }: { baseDate: string | null }) {
  return (
    <header className="border-b border-slate-200 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">📊 오늘의 투자판단</h1>
        {baseDate && <span className="text-sm text-slate-500">기준일: {baseDate}</span>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        퇴근 후 10분, 오늘 볼 종목과 해야 할 행동을 정리합니다.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        ※ 이 화면은 매수/매도 추천이 아닙니다. 모든 판단은 개인 기록용이며 실제 최종 결정은 사용자가 합니다.
      </p>
    </header>
  );
}

function CategorySection({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Awaited<ReturnType<typeof loadBeginnerData>>['rows'];
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        <p className="mt-3 text-sm text-slate-500">오늘 해당 카테고리 후보 없음.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">{title} ({rows.length})</h2>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {rows.map(r => (
          <CategoryCard key={r.ticker} row={r} />
        ))}
      </div>
    </section>
  );
}
