// app/beginner/_components/TopPick1st.tsx
// v0.4-1 서버 컴포넌트 — 오늘 매매계획 추천 1순위
// 기존 TodayTopPick 대체. "없음" 케이스 명시.

import { BeginnerRow, judgeRow } from '../../_lib/beginner';
import { AI_DISCLAIMER } from '../../_lib/trade_plan';
import { ActionBadge, RiskBadge } from './Badges';
import TradePlanButton from './TradePlanButton';

interface Props {
  pick: BeginnerRow | null;
  reasonForNone: string | null;
}

export default function TopPick1st({ pick, reasonForNone }: Props) {
  if (!pick) {
    return (
      <section className="rounded-lg border border-slate-300 bg-slate-50 p-4">
        <h2 className="text-lg font-semibold text-slate-700">⭐ 오늘 매매계획 추천 1순위 없음</h2>
        <p className="mt-2 text-sm text-slate-600">
          {reasonForNone ?? '오늘은 신규 매수 후보 중 강한 신호가 잡히지 않았습니다.'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          후보가 약한 날에는 매매보다 보유/예약 상태 점검이 자연스럽습니다.
        </p>
      </section>
    );
  }
  const v = judgeRow(pick);
  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-semibold text-amber-900">⭐ 오늘 매매계획 추천 1순위</h2>
      <p className="mt-0.5 text-xs text-amber-700">하루 하나만 본다면 이 종목을 먼저 확인하세요.</p>
      <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {pick.name} <span className="text-sm text-slate-500">({pick.ticker})</span>
            </div>
            {pick.sector && <div className="text-xs text-slate-500">섹터: {pick.sector}</div>}
          </div>
          <div className="flex items-center gap-1.5">
            <RiskBadge risk={v.risk} />
            <ActionBadge action={v.ai_judgement} />
          </div>
        </div>
        <div className="mt-2 text-sm text-slate-700">
          U턴 신호 단계: <strong>5개 조건 중 {v.uturn_passed}개 충족</strong>
        </div>
        {pick.close != null && (
          <div className="mt-1 text-sm text-slate-700">
            현재가: <strong>{pick.close.toLocaleString()}원</strong>
            {pick.disparity_pct != null && <span className="ml-2 text-xs text-slate-500">이격 {pick.disparity_pct.toFixed(1)}%</span>}
          </div>
        )}
        {v.why_picked.length > 0 && (
          <div className="mt-2 text-xs text-slate-600">
            💡 {v.why_picked.slice(0, 3).join(' · ')}
          </div>
        )}
        <div className="mt-3">
          <TradePlanButton row={pick} />
        </div>
      </div>
      <p className="mt-2 text-[10px] text-amber-700">※ {AI_DISCLAIMER}</p>
    </section>
  );
}
