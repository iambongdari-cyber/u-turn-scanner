// app/beginner/_components/TodayTopPick.tsx
// v0.4 서버 컴포넌트 — 오늘의 1픽
// 선정 로직: U턴 5조건 충족 수가 가장 높은 + 위험도 낮음 + AI 판단 BUY 우선

import { BeginnerRow, judgeRow } from '../../_lib/beginner';
import { ACTION_LABEL, AI_DISCLAIMER, RISK_LABEL } from '../../_lib/trade_plan';
import { ActionBadge, RiskBadge, Disclaimer } from './Badges';

interface Props {
  rows: BeginnerRow[];
}

export default function TodayTopPick({ rows }: Props) {
  const pick = selectTopPick(rows);
  if (!pick) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">🎯 오늘의 1픽</h2>
        <p className="mt-2 text-sm text-slate-500">오늘의 1픽 후보가 잡히지 않았습니다. 후보 카드를 직접 둘러보세요.</p>
      </section>
    );
  }
  const v = judgeRow(pick);
  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-semibold text-amber-900">🎯 오늘의 1픽</h2>
      <p className="mt-0.5 text-xs text-amber-700">하루 하나만 본다면 이 종목 — {AI_DISCLAIMER}</p>
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
      </div>
      <Disclaimer>{AI_DISCLAIMER} (위험 {RISK_LABEL[v.risk]} · AI 판단 {ACTION_LABEL[v.ai_judgement]})</Disclaimer>
    </section>
  );
}

function selectTopPick(rows: BeginnerRow[]): BeginnerRow | null {
  if (rows.length === 0) return null;
  let best: { row: BeginnerRow; score: number } | null = null;
  for (const r of rows) {
    const v = judgeRow(r);
    // 점수: U턴 충족 + 위험도 가산점 + AI 판단 가산점
    let score = v.uturn_passed * 10;
    if (v.risk === 'LOW') score += 5;
    else if (v.risk === 'MED') score += 2;
    if (v.ai_judgement === 'BUY') score += 5;
    if (v.ai_judgement === 'EXCLUDE') score -= 100;
    if (r.news_critical) score -= 50;
    if (best == null || score > best.score) best = { row: r, score };
  }
  return best && best.score > 0 ? best.row : null;
}
