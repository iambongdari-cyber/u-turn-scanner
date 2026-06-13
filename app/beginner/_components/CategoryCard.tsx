// app/beginner/_components/CategoryCard.tsx
// v0.4 서버 컴포넌트 — 카테고리별 후보 카드 (바닥 U턴 / 주도주 / 후발 강세)

import { BeginnerRow, judgeRow } from '../../_lib/beginner';
import { ActionBadge, RiskBadge, UTurnStageBox, Disclaimer } from './Badges';
import TradePlanButton from './TradePlanButton';
import { AI_DISCLAIMER } from '../../_lib/trade_plan';

interface Props {
  row: BeginnerRow;
}

export default function CategoryCard({ row }: Props) {
  const v = judgeRow(row);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">
            {row.name} <span className="text-xs text-slate-500">({row.ticker})</span>
          </div>
          {row.sector && <div className="text-xs text-slate-500">섹터: {row.sector}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          <RiskBadge risk={v.risk} />
          <ActionBadge action={v.ai_judgement} />
        </div>
      </div>

      {row.close != null && (
        <div className="mt-2 text-sm text-slate-700">
          현재가: <strong>{row.close.toLocaleString()}원</strong>
          {row.ma60 != null && <span className="ml-2 text-xs text-slate-500">60일선: {row.ma60.toLocaleString()}원</span>}
          {row.disparity_pct != null && <span className="ml-2 text-xs text-slate-500">이격: {row.disparity_pct.toFixed(1)}%</span>}
        </div>
      )}

      {/* U턴 신호 단계 — 사용자 명세 §3 */}
      <div className="mt-3">
        <UTurnStageBox conditions={v.uturn_conditions} />
      </div>

      {/* 왜 뽑혔나 */}
      {v.why_picked.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-medium text-slate-700">💡 왜 뽑혔나</div>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {v.why_picked.slice(0, 4).map((w, i) => (
              <li key={i} className="text-xs">· {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 행동 가이드 */}
      {v.beginner_checklist.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-medium text-slate-700">📋 행동 가이드</div>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {v.beginner_checklist.map((c, i) => (
              <li key={i} className="text-xs">□ {c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 매매 계획 기록 버튼 (클라이언트) */}
      <div className="mt-3 flex items-center gap-2">
        <TradePlanButton row={row} />
      </div>

      <Disclaimer>{AI_DISCLAIMER}</Disclaimer>
    </div>
  );
}
