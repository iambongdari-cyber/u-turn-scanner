'use client';
// app/beginner/_components/StrategyConditionBox.tsx
// v0.7 전략 컨디션 카드 — 실수치 + 신뢰도
//
// 표시:
//  - 상태 뱃지 (매우 좋음/좋음/보통/주의/위험/데이터 부족)
//  - 신뢰도 뱃지 (높음/보통/낮음/계산 안 함)
//  - 누적 매매 진행도 바
//  - 메트릭 4 그리드 (승률 / 평균 수익 / 평균 손실 / 기대수익)
//  - advice (코치 톤)

import { useEffect, useState } from 'react';
import { loadAllPlans } from '../../_lib/trade_storage';
import {
  evaluateStrategyCondition,
  StrategyConditionResult,
  STATE_BADGE_CLASS,
  CONFIDENCE_BADGE_CLASS,
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

  // SSR / 초기 mount 사이 fallback
  const display: StrategyConditionResult = result ?? {
    state: 'DATA_INSUFFICIENT',
    stateLabel: '데이터 부족',
    confidence: 'NONE',
    confidenceLabel: '계산 안 함',
    windowSize: WINDOW_SIZE,
    actualCount: 0,
    totalClosedCount: 0,
    winRate: null,
    avgGainPct: null,
    avgLossPct: null,
    expectedReturnPct: null,
    advice: '아직 종결된 매매 결과가 없습니다. 매매 결과가 누적되면 승률·기대수익을 표시합니다.',
    futureItems: [
      '최근 20회 매매 승률',
      '평균 수익률',
      '평균 손실률',
      '기대수익',
      '전략 상태: 매우 좋음 / 좋음 / 보통 / 주의 / 위험',
    ],
  };

  const isInsufficient = display.state === 'DATA_INSUFFICIENT';
  const progressPct = mounted ? Math.min(100, (display.actualCount / display.windowSize) * 100) : 0;

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">🧭 전략 컨디션</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATE_BADGE_CLASS[display.state]}`}>
            상태: {display.stateLabel}
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_BADGE_CLASS[display.confidence]}`}>
            신뢰도: {display.confidenceLabel}
          </span>
        </div>
      </div>

      {/* 누적 매매 / 진행도 */}
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-slate-700">
            현재 누적 매매:{' '}
            <strong className="tabular-nums text-slate-900">{display.actualCount}건</strong>
            <span className="text-slate-500"> / 목표 {display.windowSize}건</span>
          </span>
          {display.totalClosedCount > display.actualCount && (
            <span className="text-xs text-amber-700">
              ※ 결과 미입력 {display.totalClosedCount - display.actualCount}건
            </span>
          )}
        </div>
        {/* 진행도 바 */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-indigo-400"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between text-[10px] text-slate-500">
          <span>0~4건 계산 안 함 · 5~9건 낮음 · 10~19건 보통 · 20+ 높음</span>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{display.advice}</p>

      {/* 실수치 메트릭 그리드 (계산 가능 시) */}
      {!isInsufficient && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {display.winRate != null && (
            <Metric label="승률" value={`${display.winRate.toFixed(1)}%`} colorByValue={display.winRate - 50} />
          )}
          {display.avgGainPct != null && (
            <Metric label="평균 수익" value={`+${display.avgGainPct.toFixed(1)}%`} colorByValue={1} />
          )}
          {display.avgLossPct != null && (
            <Metric label="평균 손실" value={`${display.avgLossPct.toFixed(1)}%`} colorByValue={-1} />
          )}
          {display.expectedReturnPct != null && (
            <Metric
              label="기대수익"
              value={`${display.expectedReturnPct >= 0 ? '+' : ''}${display.expectedReturnPct.toFixed(2)}%`}
              colorByValue={display.expectedReturnPct}
              strong
            />
          )}
        </div>
      )}

      {/* 데이터 부족 시 향후 표시 항목 */}
      {isInsufficient && display.futureItems.length > 0 && (
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
            ※ 매도완료 시 결과 입력 모달에서 종료가/수익률을 기록하면 자동 누적됩니다.
          </p>
        </div>
      )}
    </section>
  );
}

function Metric({
  label, value, colorByValue, strong,
}: {
  label: string;
  value: string;
  colorByValue: number;       // 양수 = emerald, 음수 = red, 0 = slate
  strong?: boolean;
}) {
  const cls = colorByValue > 0
    ? 'text-emerald-700'
    : colorByValue < 0
      ? 'text-red-700'
      : 'text-slate-800';
  return (
    <div className={`rounded-md border ${strong ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50'} px-3 py-1.5`}>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
