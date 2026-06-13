// app/beginner/_components/ChangeHistoryBox.tsx
// v0.4 서버 컴포넌트 — 목표가/손절가 변경 이력 표시

import { TargetChangeEntry, StopLossChangeEntry } from '../../_lib/trade_plan';

interface Props {
  targetHistory: TargetChangeEntry[];
  stopLossHistory: StopLossChangeEntry[];
}

export default function ChangeHistoryBox({ targetHistory, stopLossHistory }: Props) {
  const hasAny = targetHistory.length > 0 || stopLossHistory.length > 0;
  if (!hasAny) return null;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-1 font-medium text-slate-700">변경 이력</div>
      {targetHistory.length > 0 && (
        <div className="mb-2">
          <div className="font-semibold text-slate-600">목표 매도가 ({targetHistory.length}회)</div>
          <ul className="mt-1 space-y-1">
            {targetHistory.slice(-3).map((e, i) => (
              <li key={i} className="text-slate-700">
                <span className="text-slate-500">{e.changed_at.slice(0, 10)}:</span>{' '}
                {e.old_price.toLocaleString()} → <strong>{e.new_price.toLocaleString()}</strong>원
                <div className="pl-4 text-slate-500">이유: {e.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stopLossHistory.length > 0 && (
        <div>
          <div className="font-semibold text-slate-600">손절 기준가 ({stopLossHistory.length}회)</div>
          <ul className="mt-1 space-y-1">
            {stopLossHistory.slice(-3).map((e, i) => (
              <li key={i} className="text-slate-700">
                <span className="text-slate-500">{e.changed_at.slice(0, 10)}:</span>{' '}
                {e.old_price.toLocaleString()} → <strong>{e.new_price.toLocaleString()}</strong>원
                <div className="pl-4 text-slate-500">이유: {e.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
