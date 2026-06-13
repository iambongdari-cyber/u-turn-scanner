'use client';
// app/beginner/_components/MyPlansSection.tsx
// v0.4 클라이언트 — 내 예약매수 대기 + 내 보유종목 점검 (한 파일에 두 섹션)

import { useEffect, useState } from 'react';
import {
  TradePlan,
  STATUS_LABEL,
  AI_DISCLAIMER,
  KIWOOM_DISCLAIMER,
  calculateAvgBuyPrice,
} from '../../_lib/trade_plan';
import { loadAllPlans, groupPlans } from '../../_lib/trade_storage';
import { buildReservationOpinion, buildHoldingOpinion } from '../../_lib/scoring';
import { StatusBadge, PnlBadge, ActionBadge } from './Badges';
import StatusChangeButtons from './StatusChangeButtons';
import PriceChangeModal from './PriceChangeModal';
import ChangeHistoryBox from './ChangeHistoryBox';
import AddBuyCheckBox from './AddBuyCheckBox';
import { BeginnerRow } from '../../_lib/beginner';

interface Props {
  rowsByTicker: Record<string, BeginnerRow>;     // 종목코드 → row (서버에서 prop으로 전달, 클라에서 Map 변환)
  priceByTicker: Record<string, number>;         // 종목코드 → 현재가
}

export default function MyPlansSection({ rowsByTicker, priceByTicker }: Props) {
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // mount + storage event 시 plans 갱신
  useEffect(() => {
    setPlans(loadAllPlans());
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === 'tradePlans') {
        setPlans(loadAllPlans());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [reloadKey]);

  const { reserved, holding } = groupPlans(plans);

  const handleChanged = () => setReloadKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <ReservedSection
        plans={reserved}
        priceByTicker={priceByTicker}
        onChanged={handleChanged}
      />
      <HoldingSection
        plans={holding}
        rowsByTicker={rowsByTicker}
        priceByTicker={priceByTicker}
        onChanged={handleChanged}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 내 예약매수 대기
// ───────────────────────────────────────────────────────────────
function ReservedSection({
  plans,
  priceByTicker,
  onChanged,
}: {
  plans: TradePlan[];
  priceByTicker: Record<string, number>;
  onChanged: () => void;
}) {
  if (plans.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">🔔 내 예약매수 대기</h2>
        <p className="mt-0.5 text-xs text-slate-500">※ {KIWOOM_DISCLAIMER}</p>
        <p className="mt-3 text-sm text-slate-500">현재 예약매수 대기 종목 없음. 후보 카드에서 [매매 계획 기록] 을 시작하세요.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
      <h2 className="text-lg font-semibold text-slate-900">🔔 내 예약매수 대기 ({plans.length})</h2>
      <p className="mt-0.5 text-xs text-slate-500">※ {KIWOOM_DISCLAIMER}</p>
      <p className="mt-0.5 text-xs text-slate-500">※ {AI_DISCLAIMER}</p>
      <div className="mt-3 space-y-3">
        {plans.map((p) => (
          <ReservedCard key={p.id} plan={p} currentPrice={priceByTicker[p.ticker] ?? null} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function ReservedCard({ plan, currentPrice, onChanged }: { plan: TradePlan; currentPrice: number | null; onChanged: () => void }) {
  const op = currentPrice != null ? buildReservationOpinion(plan, currentPrice) : null;
  const sign1 = op && op.diff1_pct >= 0 ? '+' : '';
  const sign2 = op && op.diff2_pct != null && op.diff2_pct >= 0 ? '+' : '';

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">{plan.name} <span className="text-xs text-slate-500">({plan.ticker})</span></div>
        <StatusBadge status={plan.status} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-slate-700">
        <div>1차 예약매수가: <strong>{plan.first_buy_price.toLocaleString()}원</strong></div>
        {plan.second_buy_price != null && (
          <div>2차 예약매수가: <strong>{plan.second_buy_price.toLocaleString()}원</strong></div>
        )}
        {currentPrice != null && (
          <div>현재가: <strong>{currentPrice.toLocaleString()}원</strong></div>
        )}
        {op && (
          <div className="col-span-2 text-xs text-slate-500">
            1차 대비 {sign1}{op.diff1_pct.toFixed(1)}%
            {op.diff2_pct != null && ` · 2차 대비 ${sign2}${op.diff2_pct.toFixed(1)}%`}
          </div>
        )}
      </div>
      {op && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">AI 판단:</span>
            <span className="font-semibold text-indigo-700">{op.verdict_label}</span>
          </div>
          <div className="mt-1 text-xs text-slate-700">💡 {op.reason}</div>
          <div className="mt-2">
            <div className="text-xs font-medium text-slate-700">📋 오늘 행동</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {op.today_actions.map((a, i) => <li key={i}>□ {a}</li>)}
            </ul>
          </div>
        </div>
      )}
      <StatusChangeButtons plan={plan} variant="reserved" onChanged={onChanged} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 내 보유종목 점검
// ───────────────────────────────────────────────────────────────
function HoldingSection({
  plans,
  rowsByTicker,
  priceByTicker,
  onChanged,
}: {
  plans: TradePlan[];
  rowsByTicker: Record<string, BeginnerRow>;
  priceByTicker: Record<string, number>;
  onChanged: () => void;
}) {
  if (plans.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">📦 내 보유종목 점검</h2>
        <p className="mt-3 text-sm text-slate-500">현재 보유 종목 없음. 예약매수 체결 시 [1차 체결] / [2차 체결] 클릭으로 이동합니다.</p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
      <h2 className="text-lg font-semibold text-slate-900">📦 내 보유종목 점검 ({plans.length})</h2>
      <p className="mt-0.5 text-xs text-slate-500">※ {AI_DISCLAIMER}</p>
      <div className="mt-3 space-y-3">
        {plans.map((p) => (
          <HoldingCard
            key={p.id}
            plan={p}
            row={rowsByTicker[p.ticker] ?? null}
            currentPrice={priceByTicker[p.ticker] ?? null}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

function HoldingCard({
  plan,
  row,
  currentPrice,
  onChanged,
}: {
  plan: TradePlan;
  row: BeginnerRow | null;
  currentPrice: number | null;
  onChanged: () => void;
}) {
  const [modalKind, setModalKind] = useState<null | 'target' | 'stop_loss'>(null);
  const avgBuy = calculateAvgBuyPrice(plan);
  const opinion = currentPrice != null ? buildHoldingOpinion(plan, currentPrice, plan.add_buy_check) : null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-900">{plan.name} <span className="text-xs text-slate-500">({plan.ticker})</span></div>
        <StatusBadge status={plan.status} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-slate-700">
        <div>체결 상태: <strong>{STATUS_LABEL[plan.status]}</strong></div>
        <div>평균 매수가: <strong>{avgBuy.toLocaleString()}원</strong></div>
        {currentPrice != null && (
          <>
            <div>현재가: <strong>{currentPrice.toLocaleString()}원</strong></div>
            <div className="flex items-center gap-1">현재 수익률: {opinion && <PnlBadge pct={opinion.pnl_pct} />}</div>
          </>
        )}
        <div className="flex items-center gap-1">
          목표 매도가: <strong>{plan.target_sell_price.toLocaleString()}원</strong>
          <button
            type="button"
            onClick={() => setModalKind('target')}
            className="ml-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            수정
          </button>
        </div>
        <div className="flex items-center gap-1">
          손절 기준가: <strong>{plan.stop_loss_price.toLocaleString()}원</strong>
          <button
            type="button"
            onClick={() => setModalKind('stop_loss')}
            className="ml-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            수정
          </button>
        </div>
      </div>

      {opinion && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">AI 판단:</span>
            <ActionBadge action={opinion.verdict} />
            <span className="text-xs text-slate-500">({opinion.verdict_label})</span>
          </div>
          <div className="mt-1 text-xs text-slate-700">💡 {opinion.reason}</div>
          <div className="mt-2">
            <div className="text-xs font-medium text-slate-700">📋 오늘 행동 가이드</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {opinion.today_actions.map((a, i) => <li key={i}>□ {a}</li>)}
            </ul>
          </div>
        </div>
      )}

      <AddBuyCheckBox plan={plan} row={row} currentPrice={currentPrice} onChanged={onChanged} />
      <ChangeHistoryBox targetHistory={plan.target_change_history} stopLossHistory={plan.stop_loss_change_history} />
      <StatusChangeButtons plan={plan} variant="holding" onChanged={onChanged} />

      {modalKind && (
        <PriceChangeModal
          plan={plan}
          kind={modalKind}
          onClose={() => setModalKind(null)}
          onSaved={() => { setModalKind(null); onChanged(); }}
        />
      )}
    </div>
  );
}
