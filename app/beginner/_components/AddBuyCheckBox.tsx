'use client';
// app/beginner/_components/AddBuyCheckBox.tsx
// v0.4 클라이언트 — 추가매수 4 조건 체크 박스 (사용자 명세 §9)

import { useEffect, useState } from 'react';
import { TradePlan, ADD_BUY_LABEL, AddBuyConditions } from '../../_lib/trade_plan';
import { saveAddBuyCheck } from '../../_lib/trade_storage';
import { evaluateAddBuy } from '../../_lib/scoring';
import { BeginnerRow } from '../../_lib/beginner';

interface Props {
  plan: TradePlan;
  row: BeginnerRow | null;
  currentPrice: number | null;
  onChanged: (plan: TradePlan) => void;
}

export default function AddBuyCheckBox({ plan, row, currentPrice, onChanged }: Props) {
  // 사용자가 직접 토글: 4번째 (within_budget)
  const [withinBudget, setWithinBudget] = useState<boolean>(
    plan.add_buy_check?.conditions.within_budget ?? true
  );

  // 자동 평가
  const check = currentPrice != null
    ? evaluateAddBuy(plan, currentPrice, row, withinBudget)
    : null;

  // 평가 결과 저장 (자동)
  useEffect(() => {
    if (!check) return;
    const updated = saveAddBuyCheck(plan.id, check);
    if (updated) onChanged(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check?.passed_count, withinBudget]);

  if (!check || currentPrice == null) {
    return (
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="font-medium text-slate-700">🔍 추가매수 검토</div>
        <div className="mt-1 text-xs text-slate-500">현재가 정보 없음 — 키움에서 직접 확인 필요.</div>
      </div>
    );
  }

  const labelColor =
    check.verdict === 'BUY_MORE_OK' ? 'text-emerald-700' :
    check.verdict === 'BUY_MORE_WAIT' ? 'text-violet-700' :
    'text-red-700';

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-medium text-slate-700">🔍 추가매수 검토</div>
        <div className={`text-xs font-semibold ${labelColor}`}>
          AI 판단: {check.verdict_label}
        </div>
      </div>
      <div className="mt-1 text-xs text-slate-600">조건 충족: {check.passed_count}/4</div>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {(Object.entries(check.conditions) as Array<[keyof AddBuyConditions, boolean]>).map(([k, v]) => {
          // 4번째는 사용자 토글
          if (k === 'within_budget') {
            return (
              <li key={k} className="flex items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={withinBudget}
                    onChange={(e) => setWithinBudget(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span className={withinBudget ? '' : 'text-slate-500'}>
                    {ADD_BUY_LABEL[k]} <span className="text-slate-400">(직접 체크)</span>
                  </span>
                </label>
              </li>
            );
          }
          return (
            <li key={k} className="flex items-center gap-1.5">
              <span className={v ? 'text-emerald-600' : 'text-slate-400'}>{v ? '✔' : '✖'}</span>
              <span className={v ? '' : 'text-slate-500'}>{ADD_BUY_LABEL[k]}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 text-xs text-slate-700">💡 {check.reason}</div>
      <div className="mt-2">
        <div className="text-xs font-medium text-slate-700">📋 오늘 행동</div>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {check.today_actions.map((a, i) => (
            <li key={i}>□ {a}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
