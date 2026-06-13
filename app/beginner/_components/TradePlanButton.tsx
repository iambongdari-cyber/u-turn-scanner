'use client';
// app/beginner/_components/TradePlanButton.tsx
// v0.4 클라이언트 컴포넌트 — 매매 계획 기록 버튼 + 28필드 입력 폼 (모달)

import { useEffect, useState } from 'react';
import {
  TradePlan,
  ActionRecommend,
  ACTION_LABEL,
  AI_DISCLAIMER,
  NOT_REAL_TRADE_DISCLAIMER,
  nowISO,
} from '../../_lib/trade_plan';
import {
  createPlan,
  findActivePlanByTicker,
  loadAllPlans,
} from '../../_lib/trade_storage';
import { suggestBuyPlanDefaults } from '../../_lib/scoring';
import { BeginnerRow, judgeRow } from '../../_lib/beginner';

interface Props {
  row: BeginnerRow;
}

const ACTION_OPTIONS: ActionRecommend[] = ['WATCH', 'BUY', 'HOLD', 'PARTIAL_SELL', 'SELL', 'EXCLUDE'];

export default function TradePlanButton({ row }: Props) {
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<TradePlan | null>(null);

  // mount 후 기존 활성 계획 체크
  useEffect(() => {
    setExisting(findActivePlanByTicker(row.ticker));
  }, [row.ticker]);

  if (existing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
        ✓ 매매 계획 기록됨 (1차 {existing.first_buy_price.toLocaleString()}원)
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex flex-col items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
      >
        <span>📝 매매 계획 기록</span>
        <span className="text-[10px] text-indigo-500">예약매수 계획</span>
      </button>
      {open && (
        <TradePlanModal
          row={row}
          onClose={() => setOpen(false)}
          onSaved={(plan) => {
            setExisting(plan);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

interface ModalProps {
  row: BeginnerRow;
  onClose: () => void;
  onSaved: (plan: TradePlan) => void;
}

function TradePlanModal({ row, onClose, onSaved }: ModalProps) {
  const defaults = suggestBuyPlanDefaults(row);
  const verdict = judgeRow(row);

  const [firstBuyPrice, setFirstBuyPrice] = useState<string>(String(defaults.first_buy_price));
  const [firstBuyReason, setFirstBuyReason] = useState(defaults.first_buy_reason);
  const [secondBuyPrice, setSecondBuyPrice] = useState<string>(
    defaults.second_buy_price != null ? String(defaults.second_buy_price) : ''
  );
  const [secondBuyReason, setSecondBuyReason] = useState(defaults.second_buy_reason);
  const [targetPrice, setTargetPrice] = useState<string>(String(defaults.target_sell_price));
  const [targetReason, setTargetReason] = useState(defaults.target_sell_reason);
  const [stopPrice, setStopPrice] = useState<string>(String(defaults.stop_loss_price));
  const [stopReason, setStopReason] = useState(defaults.stop_loss_reason);
  const [aiJudgement, setAiJudgement] = useState<ActionRecommend>(verdict.ai_judgement);
  const [buyRecommendReason, setBuyRecommendReason] = useState(
    verdict.why_picked.slice(0, 2).join(' · ') || ''
  );
  const [userMemo, setUserMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    const fbp = Number(firstBuyPrice);
    const sbp = secondBuyPrice.trim() === '' ? null : Number(secondBuyPrice);
    const tgt = Number(targetPrice);
    const stp = Number(stopPrice);

    if (!Number.isFinite(fbp) || fbp <= 0) {
      setError('1차 매수가는 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (!Number.isFinite(tgt) || tgt <= 0) {
      setError('목표 매도가는 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (!Number.isFinite(stp) || stp <= 0) {
      setError('손절 기준가는 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (sbp != null && (!Number.isFinite(sbp) || sbp <= 0)) {
      setError('2차 매수가는 비워두거나 0보다 큰 숫자여야 합니다.');
      return;
    }
    if (!firstBuyReason.trim()) {
      setError('1차 매수가 이유는 필수입니다.');
      return;
    }
    if (!targetReason.trim()) {
      setError('목표 매도가 이유는 필수입니다.');
      return;
    }
    if (!stopReason.trim()) {
      setError('손절 이유는 필수입니다.');
      return;
    }

    const today = nowISO().slice(0, 10);

    const plan = createPlan({
      ticker: row.ticker,
      name: row.name,
      first_buy_price: fbp,
      first_buy_reason: firstBuyReason.trim(),
      second_buy_price: sbp,
      second_buy_reason: sbp != null ? secondBuyReason.trim() : null,
      target_sell_price: tgt,
      target_sell_reason: targetReason.trim(),
      stop_loss_price: stp,
      stop_loss_reason: stopReason.trim(),
      ai_judgement: aiJudgement,
      buy_recommend_reason: buyRecommendReason.trim(),
      status: 'WATCHING',
      reserved_at: null,
      first_filled_at: null,
      second_filled_at: null,
      actual_first_filled_price: null,
      actual_second_filled_price: null,
      closed_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      scoring_snapshot: {
        name: row.name,
        ticker: row.ticker,
        bought_at: today,
        buy_price: fbp,
        category_at_time: verdict.category,
        action_recommend_at_time: verdict.ai_judgement,
        risk_at_time: verdict.risk,
        uturn_conditions_at_time: verdict.uturn_conditions,
        why_picked_at_time: verdict.why_picked,
        beginner_checklist_at_time: verdict.beginner_checklist,
      },
      target_change_history: [],
      stop_loss_change_history: [],
      add_buy_check: null,
      user_memo: userMemo.trim(),
    });

    // 새 plan 리스트가 다른 컴포넌트에도 반영되도록 storage event 강제 트리거
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: 'tradePlans' }));
    } catch {}

    onSaved(plan);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-3">
          <h3 className="text-lg font-semibold text-slate-900">
            매매 계획 기록 — {row.name} ({row.ticker})
          </h3>
          <p className="text-xs text-slate-500">※ {AI_DISCLAIMER}</p>
          <p className="text-xs text-slate-500">※ {NOT_REAL_TRADE_DISCLAIMER}</p>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {/* AI 판단 */}
          <Field label="AI 판단">
            <select
              value={aiJudgement}
              onChange={(e) => setAiJudgement(e.target.value as ActionRecommend)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABEL[a]}</option>
              ))}
            </select>
          </Field>

          <Field label="매수 추천 이유">
            <textarea
              value={buyRecommendReason}
              onChange={(e) => setBuyRecommendReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="왜 이 종목을 뽑았는지 짧게..."
            />
          </Field>

          {/* 1차 매수가 */}
          <Field label="1차 예약매수가 (원) *">
            <input
              type="number"
              value={firstBuyPrice}
              onChange={(e) => setFirstBuyPrice(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="ml-2 text-xs text-slate-500">기본값: 현재가</span>
          </Field>
          <Field label="1차 매수가 이유 *">
            <textarea
              value={firstBuyReason}
              onChange={(e) => setFirstBuyReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>

          {/* 2차 매수가 */}
          <Field label="2차 예약매수가 (원, 선택)">
            <input
              type="number"
              value={secondBuyPrice}
              onChange={(e) => setSecondBuyPrice(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="ml-2 text-xs text-slate-500">기본값: 60일선 +2%</span>
          </Field>
          {secondBuyPrice.trim() !== '' && (
            <Field label="2차 매수가 이유">
              <textarea
                value={secondBuyReason}
                onChange={(e) => setSecondBuyReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </Field>
          )}

          {/* 목표가 */}
          <Field label="목표 매도가 (원) *">
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="ml-2 text-xs text-slate-500">기본값: 60일선 +20%</span>
          </Field>
          <Field label="목표 매도가 이유 *">
            <textarea
              value={targetReason}
              onChange={(e) => setTargetReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>

          {/* 손절가 */}
          <Field label="손절 기준가 (원) *">
            <input
              type="number"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="ml-2 text-xs text-slate-500">기본값: 60일선 -5%</span>
          </Field>
          <Field label="손절 이유 *">
            <textarea
              value={stopReason}
              onChange={(e) => setStopReason(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </Field>

          <Field label="사용자 메모 (선택)">
            <textarea
              value={userMemo}
              onChange={(e) => setUserMemo(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              placeholder="자유 메모..."
            />
          </Field>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
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
            기록하기
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

// 전체 계획 수 헬퍼 (다른 컴포넌트에서 mount 후 호출용)
export function getPlanCount(): number {
  return loadAllPlans().length;
}
