// app/beginner/_components/ActionGuideBoxes.tsx
// v0.6 오늘 해야 할 행동 / 오늘 하지 말아야 할 행동 — 두 박스 (사용자 명세 §3 §4)
//
// 시장 상태별 자동 생성된 추천/금지 행동을 정식 섹션으로 분리.

import { MarketRegimeResult } from '../../_lib/market_regime';

interface Props {
  regime: MarketRegimeResult | null;
}

export function RecommendedActionsBox({ regime }: Props) {
  const actions = regime?.recommendedActions ?? [
    '보합장 가정으로 보수적 접근',
    '1순위만 확인',
    '현금 비중 50% 이상 유지',
  ];
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
      <h2 className="text-lg font-semibold text-slate-900">✅ 오늘 해야 할 행동</h2>
      <ul className="mt-2 space-y-1">
        {actions.map((a, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-800">
            <span className="text-emerald-600">·</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ForbiddenActionsBox({ regime }: Props) {
  const actions = regime?.forbiddenActions ?? [
    '후보 전체 훑기',
    '손절가 없는 매수',
    '동시 다종목 진입',
  ];
  return (
    <section className="rounded-lg border border-red-200 bg-red-50/30 p-4">
      <h2 className="text-lg font-semibold text-slate-900">🚫 오늘 하지 말아야 할 행동</h2>
      <ul className="mt-2 space-y-1">
        {actions.map((a, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-800">
            <span className="text-red-500">·</span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
