'use client';
// app/beginner/_components/StrategyConditionBox.tsx
// v0.6 전략 컨디션 카드
//
// 사용자 명세:
//  - 화면에 반드시 노출 (데이터 없어도 숨기지 않음)
//  - "현재 누적 매매 0건 / 20건 이상 누적되면 승률·기대수익 계산" 구조

import { useEffect, useState } from 'react';
import { loadAllPlans } from '../../_lib/trade_storage';
import {
  evaluateStrategyCondition,
  StrategyConditionResult,
  STATE_BADGE_CLASS,
  WINDOW_SIZE,
} from '../../_lib/strategy_condition';

export default function StrategyConditionBox() {
  const [result, setResult] = useState<StrategyConditionResult | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const recompute = () => {
      const plans = loadAllPlans();
      setResult(evaluateStrategyCondition(plans));
    };
    recompute();
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === 'tradePlans') recompute();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // SSR + 초기 mount 사이엔 데이터 부족 가정 표시
  const display = result ?? {
    state: 'DATA_INSUFFICIENT' as const,
    stateLabel: '데이터 부족',
    windowSize: WINDOW_SIZE,
    actualCount: 0,
    winRate: null,
    avgGainPct: null,
    avgLossPct: null,
    expectedReturnPct: null,
    advice: '아직 종결된 매매가 없습니다. 매매 결과가 누적되면 승률·기대수익을 표시합니다.',
    futureItems: [
      '최근 20회 매매 승률',
      '평균 수익률',
      '평균 손실률',
      '기대수익',
      '전략 상태: 매우 좋음 / 좋음 / 보통 / 주의 / 위험',
    ],
  };

  const isInsufficient = display.state === 'DATA_INSUFFICIENT';

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">🧭 전략 컨디션</h2>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATE_BADGE_CLASS[display.state]}`}>
          상태: {display.stateLabel}
        </span>
      </div>

      {/* 누적 매매 / 진행도 */}
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-slate-700">
            현재 누적 매매:{' '}
            <strong className="tabular-nums text-slate-900">{mounted ? display.actualCount : 0}건</strong>
            <span className="text-slate-500"> / 목표 {display.windowSize}건</span>
          </span>
          {mounted && display.actualCount > 0 && (
            <span className="text-xs text-slate-500">
              {display.windowSize}건 이상 누적되면 승률·기대수익 계산
            </span>
          )}
        </div>
        {/* 진행도 바 */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-indigo-400"
            style={{ width: `${mounted ? Math.min(100, (display.actualCount / display.windowSize) * 100) : 0}%` }}
          />
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700">{display.advice}</p>

      {isInsufficient && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
          <div className="text-xs font-semibold text-slate-700">
            향후 이 영역에서는 아래 항목을 표시합니다:
          </div>
          <ul className="mt-1 space-y-0.5">
            {display.futureItems.map((item, i) => (
              <li key={i} className="text-xs text-slate-600">· {item}</li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-slate-500">
            [v0.7 매매 결과 기록 기능 추가 예정 — v0.8 부터 실계산]
          </p>
        </div>
      )}

      {!isInsufficient && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {display.winRate != null && (
            <Metric label="승률" value={`${display.winRate.toFixed(1)}%`} />
          )}
          {display.avgGainPct != null && (
            <Metric label="평균 수익" value={`+${display.avgGainPct.toFixed(1)}%`} />
          )}
          {display.avgLossPct != null && (
            <Metric label="평균 손실" value={`-${Math.abs(display.avgLossPct).toFixed(1)}%`} />
          )}
          {display.expectedReturnPct != null && (
            <Metric label="기대수익" value={`${display.expectedReturnPct >= 0 ? '+' : ''}${display.expectedReturnPct.toFixed(2)}%`} />
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}
