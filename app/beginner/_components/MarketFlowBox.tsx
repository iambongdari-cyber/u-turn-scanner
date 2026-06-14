// app/beginner/_components/MarketFlowBox.tsx
// v0.8-1 오늘 장 요약 / 내일 행동 / 금지 행동 — 3 단 카드
//
// 사용자 명세 §4:
//  - 너무 튀지 않게 / 기존 카드들과 비슷한 디자인
//  - 모바일에서도 읽기 쉽게 / 텍스트 중심
//  - 자세히 보기는 details 태그로 간단히

import { MarketRegimeResult, REGIME_BADGE_CLASS } from '../../_lib/market_regime';
import { MarketStrength, CapStyle } from '../../_lib/market_strength';
import { TomorrowAction } from '../../_lib/tomorrow_action';
import { AI_DISCLAIMER } from '../../_lib/trade_plan';

interface Props {
  marketRegime: MarketRegimeResult;
  marketStrength: MarketStrength;
  capStyle: CapStyle;
  tomorrowAction: TomorrowAction;
}

export default function MarketFlowBox({
  marketRegime, marketStrength, capStyle, tomorrowAction,
}: Props) {
  // 오늘 장 요약 3 줄
  const todayLines = [
    `오늘은 ${marketRegime.display}입니다.`,
    marketStrength.narrative,
    capStyle.narrative,
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">🌊 내일 한눈에 보기</h2>
      {marketStrength.insufficient && (
        <p className="mt-1 text-[10px] text-slate-500">
          ※ 일부 시장 데이터가 부족해 보수적으로 판단합니다.
        </p>
      )}

      {/* 오늘 장 요약 */}
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">🌊 오늘 장 요약</h3>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${REGIME_BADGE_CLASS[marketRegime.regime]}`}>
            {marketRegime.display}
            {marketRegime.displayScore != null && ` ${marketRegime.displayScore}점`}
          </span>
        </div>
        <ul className="mt-2 space-y-0.5 text-sm text-slate-800">
          {todayLines.map((line, i) => (
            <li key={i}>· {line}</li>
          ))}
        </ul>
      </div>

      {/* 내일 행동 */}
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/40 p-3">
        <h3 className="text-sm font-semibold text-amber-900">🎯 내일 행동</h3>
        <ul className="mt-2 space-y-0.5 text-sm text-slate-800">
          {tomorrowAction.summaryLines.map((line, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-amber-700">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {tomorrowAction.canEnterNew && (
          <div className="mt-2 text-[11px] text-amber-800">
            내일 신규 진입 가능 — 최대 {tomorrowAction.maxNewCount} 종목
          </div>
        )}
        {!tomorrowAction.canEnterNew && (
          <div className="mt-2 text-[11px] text-slate-600">
            내일 신규 진입은 보류 — 보유/예약 점검에 집중
          </div>
        )}
      </div>

      {/* 금지 행동 */}
      <div className="mt-3 rounded-md border border-red-200 bg-red-50/40 p-3">
        <h3 className="text-sm font-semibold text-red-900">🚫 금지 행동</h3>
        <ul className="mt-2 space-y-0.5 text-sm text-slate-800">
          {tomorrowAction.mustNotDo.map((line, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-red-500">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 자세히 보기 — details 태그 (사용자 명세 §4 — 간단 구현) */}
      <details className="mt-3 rounded-md border border-slate-200 bg-white/70">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-indigo-700 hover:underline">
          자세히 보기
        </summary>
        <div className="space-y-2 px-3 pb-3 text-xs text-slate-700">
          <div>
            <div className="font-semibold text-slate-800">KOSPI / KOSDAQ 강도</div>
            <div className="mt-0.5">
              KOSPI: <strong>{labelStrength(marketStrength.kospi)}</strong> · KOSDAQ: <strong>{labelStrength(marketStrength.kosdaq)}</strong> · 상대강도: <strong>{labelRelative(marketStrength.relative)}</strong>
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">대형주 / 중소형주</div>
            <div className="mt-0.5">
              <strong>{labelCapStyle(capStyle.style)}</strong> — {capStyle.narrative}
            </div>
          </div>
          <div>
            <div className="font-semibold text-slate-800">매매 강도</div>
            <div className="mt-0.5">
              {labelIntensity(tomorrowAction.intensity)} (최대 {tomorrowAction.maxNewCount} 종목)
            </div>
          </div>
          {tomorrowAction.topPickName && (
            <div>
              <div className="font-semibold text-slate-800">1순위 종목</div>
              <div className="mt-0.5">{tomorrowAction.topPickName}</div>
            </div>
          )}
        </div>
      </details>

      <p className="mt-3 text-[10px] text-slate-500">※ {AI_DISCLAIMER}</p>
    </section>
  );
}

function labelStrength(s: MarketStrength['kospi']): string {
  switch (s) {
    case 'STRONG': return '강함';
    case 'NEUTRAL': return '보통';
    case 'WEAK': return '약함';
  }
}

function labelRelative(r: MarketStrength['relative']): string {
  switch (r) {
    case 'KOSPI_LEAD': return 'KOSPI 우위';
    case 'KOSDAQ_LEAD': return 'KOSDAQ 우위';
    case 'BALANCED': return '균형';
  }
}

function labelCapStyle(c: CapStyle['style']): string {
  switch (c) {
    case 'LARGE_CAP_LEAD': return '대형주 중심';
    case 'SMALL_CAP_LEAD': return '중소형주 중심';
    case 'BALANCED': return '혼재';
  }
}

function labelIntensity(i: TomorrowAction['intensity']): string {
  switch (i) {
    case 'NORMAL': return '정상';
    case 'LIGHT': return '약하게';
    case 'NONE': return '진입 보류';
  }
}
