'use client';
// app/beginner/_components/PriceChangeModal.tsx
// v0.4 클라이언트 — 목표 매도가 / 손절 기준가 변경 모달 (이유 필수)

import { useState } from 'react';
import { TradePlan, AI_DISCLAIMER } from '../../_lib/trade_plan';
import { changeTargetPrice, changeStopLoss } from '../../_lib/trade_storage';
import { suggestTargetReasons, suggestStopReasons } from '../../_lib/beginner';

type Kind = 'target' | 'stop_loss';

interface Props {
  plan: TradePlan;
  kind: Kind;
  onClose: () => void;
  onSaved: (plan: TradePlan) => void;
}

export default function PriceChangeModal({ plan, kind, onClose, onSaved }: Props) {
  const isTarget = kind === 'target';
  const currentPrice = isTarget ? plan.target_sell_price : plan.stop_loss_price;
  const title = isTarget ? '목표 매도가 변경' : '손절 기준가 변경';

  const [newPrice, setNewPrice] = useState<string>(String(currentPrice));
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const np = Number(newPrice);
  const suggestions = isTarget
    ? suggestTargetReasons(currentPrice, Number.isFinite(np) ? np : currentPrice)
    : suggestStopReasons(currentPrice, Number.isFinite(np) ? np : currentPrice);

  const handleSave = () => {
    setError(null);
    if (!Number.isFinite(np) || np <= 0) {
      setError('변경 가격은 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (!reason.trim()) {
      setError('변경 이유는 필수입니다.');
      return;
    }
    try {
      const updated = isTarget
        ? changeTargetPrice(plan.id, np, reason.trim())
        : changeStopLoss(plan.id, np, reason.trim());
      if (!updated) {
        setError('저장 실패 — 계획을 찾을 수 없습니다.');
        return;
      }
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: 'tradePlans' }));
      } catch {}
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{plan.name} ({plan.ticker})</p>
          <p className="text-xs text-slate-500">※ {AI_DISCLAIMER}</p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <div>
            <div className="text-xs font-medium text-slate-700">기존 가격</div>
            <div className="text-slate-600">{currentPrice.toLocaleString()}원</div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 가격 (원) *</label>
            <input
              type="number"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 이유 * (필수)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="왜 가격을 바꾸나요?"
            />
          </div>
          {suggestions.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-slate-500">추천 이유 칩 (클릭하여 입력)</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setReason(s)}
                    className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <p className="text-xs text-slate-500">※ 변경 이유는 필수입니다. 빈 칸이면 저장되지 않습니다.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            변경 기록
          </button>
        </div>
      </div>
    </div>
  );
}
