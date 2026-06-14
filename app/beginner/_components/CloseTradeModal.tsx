'use client';
// app/beginner/_components/CloseTradeModal.tsx
// v0.7 매도완료 결과 입력 모달
//  - 실제 종료가 (필수)
//  - 자동 계산 수익률 (사용자 수정 가능)
//  - 종료일 (기본 오늘)
//  - 메모 (선택)
//  - 저장 시 changeStatus(plan.id, 'CLOSED', {...}) 호출

import { useMemo, useState } from 'react';
import { TradePlan, AI_DISCLAIMER, calculateAvgBuyPrice } from '../../_lib/trade_plan';
import { changeStatus } from '../../_lib/trade_storage';

interface Props {
  plan: TradePlan;
  onClose: () => void;
  onSaved: (plan: TradePlan) => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CloseTradeModal({ plan, onClose, onSaved }: Props) {
  const avgBuy = useMemo(() => calculateAvgBuyPrice(plan), [plan]);

  const [closePrice, setClosePrice] = useState<string>('');
  const [pnlOverride, setPnlOverride] = useState<string>(''); // 빈 칸이면 자동 계산
  const [closeDate, setCloseDate] = useState<string>(todayISO());
  const [memo, setMemo] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 자동 계산 수익률 (미입력 시 사용)
  const autoPnlPct = useMemo(() => {
    const cp = Number(closePrice);
    if (!Number.isFinite(cp) || cp <= 0 || avgBuy <= 0) return null;
    return (cp - avgBuy) / avgBuy * 100;
  }, [closePrice, avgBuy]);

  const effectivePnlPct = useMemo(() => {
    if (pnlOverride.trim() !== '') {
      const v = Number(pnlOverride);
      return Number.isFinite(v) ? v : null;
    }
    return autoPnlPct;
  }, [pnlOverride, autoPnlPct]);

  const handleSave = () => {
    setError(null);
    const cp = Number(closePrice);
    if (!Number.isFinite(cp) || cp <= 0) {
      setError('실제 종료가는 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (effectivePnlPct == null || !Number.isFinite(effectivePnlPct)) {
      setError('수익률 계산에 실패했습니다. 값을 확인해 주세요.');
      return;
    }
    if (!closeDate || !/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) {
      setError('종료일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
      return;
    }
    try {
      const updated = changeStatus(plan.id, 'CLOSED', {
        closed_at_price: cp,
        closed_pnl_pct: effectivePnlPct,
        closed_at_date: closeDate,
        close_memo: memo.trim() || undefined,
      });
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

  const pnlSign = effectivePnlPct != null && effectivePnlPct >= 0 ? '+' : '';
  const pnlColor = effectivePnlPct == null
    ? 'text-slate-500'
    : effectivePnlPct > 0
      ? 'text-emerald-700'
      : effectivePnlPct < 0
        ? 'text-red-700'
        : 'text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-lg font-semibold text-slate-900">매도완료 — 결과 기록</h3>
          <p className="text-xs text-slate-500">{plan.name} ({plan.ticker})</p>
          <p className="text-xs text-slate-500">평균 매수가: {avgBuy.toLocaleString()}원</p>
          <p className="text-xs text-slate-500">※ {AI_DISCLAIMER}</p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          {/* 실제 종료가 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">실제 종료가 (원) *</label>
            <input
              type="number"
              value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="원"
            />
          </div>

          {/* 자동 계산 수익률 */}
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">자동 계산 수익률</div>
            <div className={`text-base font-semibold tabular-nums ${pnlColor}`}>
              {effectivePnlPct == null ? '-' : `${pnlSign}${effectivePnlPct.toFixed(2)}%`}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              계산식: (종료가 - 평균매수가) / 평균매수가 × 100
            </div>
          </div>

          {/* 사용자 직접 수정 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              수익률 직접 수정 (선택, 비우면 위 자동값 사용)
            </label>
            <input
              type="number"
              step="0.01"
              value={pnlOverride}
              onChange={(e) => setPnlOverride(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="%"
            />
          </div>

          {/* 종료일 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">종료일 *</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>

          {/* 메모 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">메모 (선택)</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="예: 목표가 도달 후 일부매도 + 잔여 매도"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <p className="text-xs text-slate-500">
            ※ 이 기록은 전략 컨디션 (승률·기대수익) 계산에 사용됩니다.
          </p>
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
            className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            매도완료 기록
          </button>
        </div>
      </div>
    </div>
  );
}
