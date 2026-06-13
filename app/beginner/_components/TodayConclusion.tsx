'use client';
// app/beginner/_components/TodayConclusion.tsx
// v0.6.1 오늘의 결론 — CoachShell 로부터 selectedNewTargets[0].name 을 받아
// 매매계획 기록 대상과 1순위 종목명 동기화.

import { MarketRegimeResult, REGIME_BADGE_CLASS, MODE_BADGE_CLASS, buildConclusionText } from '../../_lib/market_regime';
import { AI_DISCLAIMER } from '../../_lib/trade_plan';

interface Props {
  regime: MarketRegimeResult | null;
  /** v0.6.1: CoachShell 이 계산한 selectTradePlanTargets 의 첫 번째 종목명 (없으면 null) */
  topPickName: string | null;
}

export default function TodayConclusion({ regime, topPickName }: Props) {
  if (!regime) {
    return (
      <section className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
        <h2 className="text-lg font-semibold text-indigo-900">📋 오늘의 결론</h2>
        <p className="mt-2 text-sm text-slate-700">
          시장 상태 판단에 필요한 데이터가 부족합니다. 보합장 가정으로 보수적으로 접근하세요.
        </p>
      </section>
    );
  }

  // v0.6.1: topPickName 반영해서 결론 문구 재빌드 (매매계획 기록 대상 1순위와 동기화)
  const conclusionText = buildConclusionText(regime.regime, regime.mode, topPickName);

  return (
    <section className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <h2 className="text-lg font-semibold text-indigo-900">📋 오늘의 결론</h2>

      {/* 오늘의 태도 / 시장 상태 / 전략 모드 */}
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">오늘의 태도:</span>
          <strong className="text-base text-slate-900">{regime.attitude}</strong>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">시장 상태:</span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${REGIME_BADGE_CLASS[regime.regime]}`}>
            {regime.display}
          </span>
          {regime.displayScore != null && (
            <strong className="tabular-nums text-slate-700">{regime.displayScore}점</strong>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">전략 모드:</span>
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${MODE_BADGE_CLASS[regime.mode]}`}>
            {regime.modeLabel}
          </span>
        </div>
      </div>

      {/* 자연어 안내 — 재빌드된 conclusionText (1순위 종목명 동기화) */}
      <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {conclusionText}
      </div>

      {/* 핵심 문장 */}
      <div className="mt-3 rounded-md border border-indigo-200 bg-white/70 px-3 py-2">
        <div className="text-sm font-semibold text-indigo-800">
          💡 {regime.corePhrase}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-indigo-600">※ {AI_DISCLAIMER}</p>
    </section>
  );
}
