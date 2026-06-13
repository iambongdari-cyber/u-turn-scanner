'use client';
// app/beginner/_components/StatusChangeButtons.tsx
// v0.4 클라이언트 — 매매 상태 변경 버튼 (체결/취소 등)

import { useState } from 'react';
import { TradePlan, TradeStatus } from '../../_lib/trade_plan';
import { changeStatus } from '../../_lib/trade_storage';

interface Props {
  plan: TradePlan;
  variant: 'reserved' | 'holding';   // 어느 섹션에서 호출하는가
  onChanged: (plan: TradePlan) => void;
}

export default function StatusChangeButtons({ plan, variant, onChanged }: Props) {
  const [showInput, setShowInput] = useState<null | 'first' | 'second' | 'cancel'>(null);
  const [actualPrice, setActualPrice] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const fire = (newStatus: TradeStatus, extras?: Parameters<typeof changeStatus>[2]) => {
    const updated = changeStatus(plan.id, newStatus, extras);
    if (updated) {
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: 'tradePlans' }));
      } catch {}
      onChanged(updated);
    }
  };

  const handleFirstFilled = () => {
    const p = Number(actualPrice);
    if (!Number.isFinite(p) || p <= 0) {
      alert('실제 1차 체결가를 입력해주세요.');
      return;
    }
    fire('FIRST_FILLED', { actual_first_filled_price: p });
    setShowInput(null);
    setActualPrice('');
  };

  const handleSecondFilled = () => {
    const p = Number(actualPrice);
    if (!Number.isFinite(p) || p <= 0) {
      alert('실제 2차 체결가를 입력해주세요.');
      return;
    }
    fire('SECOND_FILLED', { actual_second_filled_price: p });
    setShowInput(null);
    setActualPrice('');
  };

  const handleCancel = () => {
    if (!cancelReason.trim()) {
      alert('취소 사유를 입력해주세요.');
      return;
    }
    fire('CANCELLED', { cancellation_reason: cancelReason.trim() });
    setShowInput(null);
    setCancelReason('');
  };

  if (variant === 'reserved') {
    return (
      <div className="mt-2">
        <div className="text-xs text-slate-500">체결 여부:</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => fire('RESERVED')}
            disabled={plan.status === 'RESERVED'}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            미체결 (예약 걸림)
          </button>
          <button
            type="button"
            onClick={() => setShowInput('first')}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
          >
            1차 체결
          </button>
          <button
            type="button"
            onClick={() => setShowInput('second')}
            className="rounded-md border border-emerald-400 bg-emerald-100 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-200"
          >
            2차 체결
          </button>
          <button
            type="button"
            onClick={() => setShowInput('cancel')}
            className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            취소
          </button>
        </div>
        {showInput === 'first' && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
            <div className="text-xs text-slate-700">실제 1차 체결가 입력:</div>
            <div className="mt-1 flex gap-1.5">
              <input
                type="number"
                value={actualPrice}
                onChange={(e) => setActualPrice(e.target.value)}
                className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                placeholder="원"
              />
              <button type="button" onClick={handleFirstFilled} className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">기록</button>
              <button type="button" onClick={() => setShowInput(null)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">취소</button>
            </div>
          </div>
        )}
        {showInput === 'second' && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
            <div className="text-xs text-slate-700">실제 2차 체결가 입력:</div>
            <div className="mt-1 flex gap-1.5">
              <input
                type="number"
                value={actualPrice}
                onChange={(e) => setActualPrice(e.target.value)}
                className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
                placeholder="원"
              />
              <button type="button" onClick={handleSecondFilled} className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">기록</button>
              <button type="button" onClick={() => setShowInput(null)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">취소</button>
            </div>
          </div>
        )}
        {showInput === 'cancel' && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2">
            <div className="text-xs text-slate-700">취소 사유 (필수):</div>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="왜 취소하나요?"
            />
            <div className="mt-1 flex gap-1.5">
              <button type="button" onClick={handleCancel} className="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">취소 기록</button>
              <button type="button" onClick={() => setShowInput(null)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">닫기</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // variant === 'holding'
  return (
    <div className="mt-2">
      <div className="text-xs text-slate-500">상태 변경:</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => fire('HOLDING')}
          disabled={plan.status === 'HOLDING'}
          className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
        >
          보유중
        </button>
        <button
          type="button"
          onClick={() => setShowInput('second')}
          className="rounded-md border border-emerald-400 bg-emerald-100 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-200"
        >
          2차 체결 추가
        </button>
        <button
          type="button"
          onClick={() => fire('PARTIAL_SOLD')}
          disabled={plan.status === 'PARTIAL_SOLD'}
          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-40"
        >
          일부매도
        </button>
        <button
          type="button"
          onClick={() => fire('CLOSED')}
          className="rounded-md border border-slate-400 bg-slate-100 px-2 py-1 text-xs text-slate-800 hover:bg-slate-200"
        >
          매도완료
        </button>
      </div>
      {showInput === 'second' && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
          <div className="text-xs text-slate-700">실제 2차 체결가 입력:</div>
          <div className="mt-1 flex gap-1.5">
            <input
              type="number"
              value={actualPrice}
              onChange={(e) => setActualPrice(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="원"
            />
            <button type="button" onClick={handleSecondFilled} className="rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">기록</button>
            <button type="button" onClick={() => setShowInput(null)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">취소</button>
          </div>
        </div>
      )}
    </div>
  );
}
