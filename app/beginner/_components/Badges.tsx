// app/beginner/_components/Badges.tsx
// v0.4 서버 컴포넌트 — 상태/액션/위험/U턴/수익률 뱃지 모음
//
// ※ 표시 전용. 클라이언트 상태 없음.

import {
  TradeStatus,
  ActionRecommend,
  RiskLevel,
  UTurnStageLevel,
  UTurnConditions,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  ACTION_LABEL,
  ACTION_BADGE_CLASS,
  RISK_LABEL,
  RISK_BADGE_CLASS,
  UTURN_STAGE_LABEL,
  UTURN_STAGE_BADGE_CLASS,
  UTURN_CONDITION_LABEL,
  countUTurnConditions,
  deriveUTurnStageLevel,
} from '../../_lib/trade_plan';

export function StatusBadge({ status }: { status: TradeStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ActionBadge({ action }: { action: ActionRecommend }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_BADGE_CLASS[action]}`}>
      {ACTION_LABEL[action]}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BADGE_CLASS[risk]}`}>
      위험 {RISK_LABEL[risk]}
    </span>
  );
}

export function UTurnStageBadge({ level }: { level: UTurnStageLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${UTURN_STAGE_BADGE_CLASS[level]}`}>
      {UTURN_STAGE_LABEL[level]}
    </span>
  );
}

/** U턴 신호 단계 표현 + 체크리스트 — 사용자 명세 §3 */
export function UTurnStageBox({ conditions }: { conditions: UTurnConditions }) {
  const level = deriveUTurnStageLevel(conditions);
  const n = countUTurnConditions(conditions);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">U턴 신호 단계:</span>
        <UTurnStageBadge level={level} />
        <span className="font-medium text-slate-800">5개 조건 중 {n}개 충족</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-slate-700">
        {(Object.entries(conditions) as Array<[keyof UTurnConditions, boolean]>).map(([k, v]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={v ? 'text-emerald-600' : 'text-slate-400'}>{v ? '✔' : '✖'}</span>
            <span className={v ? '' : 'text-slate-500'}>{UTURN_CONDITION_LABEL[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PnlBadge({ pct }: { pct: number }) {
  const cls = pct > 0
    ? 'bg-emerald-100 text-emerald-800'
    : pct < 0
      ? 'bg-red-100 text-red-800'
      : 'bg-slate-100 text-slate-700';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold ${cls}`}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

/** 안내 문구 작은 회색 배너 */
export function Disclaimer({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-xs text-slate-500">※ {children}</p>
  );
}
