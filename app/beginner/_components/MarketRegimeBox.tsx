'use client';
// app/beginner/_components/MarketRegimeBox.tsx
// v0.5 시장 상태 박스 (사용자 명세 §3 + 추천/금지 행동)
// - 4단계 표시 (강세장 / 보합장 / 약세장 / 판단 보류) + 점수 표시 (0~100)
// - 전략 모드 뱃지 (공격 / 선별 / 방어 + 짧은 반등)
// - 자연어 안내
// - 추천 행동 / 금지 행동 두 박스
// - 메트릭 한 줄 + 사유 칩 + 자세히 보기 토글 (7 신호 점수 풀)

import { useState } from 'react';
import {
  MarketRegimeResult,
  REGIME_SECTION_CLASS,
  REGIME_BADGE_CLASS,
  MODE_BADGE_CLASS,
} from '../../_lib/market_regime';

interface Props {
  regime: MarketRegimeResult | null;
}

export default function MarketRegimeBox({ regime }: Props) {
  const [open, setOpen] = useState(false);

  if (!regime) {
    return (
      <section className="rounded-lg border border-slate-200 bg-slate-50/30 p-4">
        <h2 className="text-lg font-semibold text-slate-700">📊 오늘 시장 상태: 판단 보류</h2>
        <p className="mt-1 text-sm text-slate-600">
          시장 상태 판단에 필요한 데이터가 부족합니다. 보합장(선별) 모드로 동작합니다.
        </p>
      </section>
    );
  }

  return (
    <section className={`rounded-lg border p-4 ${REGIME_SECTION_CLASS[regime.regime]}`}>
      {/* 헤더 — 시장 상태 + 점수 + 전략 모드 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          📊 오늘 시장 상태:{' '}
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-bold ${REGIME_BADGE_CLASS[regime.regime]}`}>
            {regime.display}
          </span>
          {regime.displayScore != null && (
            <span className="ml-2 text-base font-bold text-slate-700 tabular-nums">
              ({regime.displayScore}점)
            </span>
          )}
        </h2>
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${MODE_BADGE_CLASS[regime.mode]}`}>
          전략 모드: {regime.modeLabel}
        </span>
      </div>

      {/* 자연어 안내 */}
      <p className="mt-2 text-sm leading-relaxed text-slate-800">
        {regime.advice}
      </p>

      {/* 추천 행동 / 금지 행동 — 2열 */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-emerald-200 bg-white/70 p-3">
          <div className="text-sm font-semibold text-emerald-800">✅ 추천 행동</div>
          <ul className="mt-1.5 space-y-1">
            {regime.recommendedActions.map((a, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-slate-800">
                <span className="text-emerald-600">·</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-red-200 bg-white/70 p-3">
          <div className="text-sm font-semibold text-red-800">🚫 금지 행동</div>
          <ul className="mt-1.5 space-y-1">
            {regime.forbiddenActions.map((a, i) => (
              <li key={i} className="flex gap-1.5 text-sm text-slate-800">
                <span className="text-red-500">·</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 메트릭 한 줄 */}
      {regime.metrics.length > 0 && (
        <p className="mt-3 text-xs text-slate-600">
          {regime.metrics.join(' · ')}
        </p>
      )}

      {/* 사유 칩 */}
      {regime.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-xs text-slate-500">판단 사유:</span>
          {regime.reasons.map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-white/60 px-2 py-0.5 text-[10px] text-slate-700 ring-1 ring-slate-200"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {/* UNKNOWN 케이스 — 부족 데이터 안내 */}
      {regime.regime === 'UNKNOWN' && regime.missingData.length > 0 && (
        <div className="mt-2 text-xs text-slate-600">
          부족 데이터: {regime.missingData.join(' · ')}
        </div>
      )}

      {/* 자세히 보기 토글 — 7 신호 점수 풀 노출 */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs text-indigo-700 hover:underline"
        >
          {open ? '자세히 닫기 ▴' : '자세히 보기 ▾'}
        </button>
        {open && (
          <div className="mt-2 rounded-md border border-slate-200 bg-white/70 p-2">
            <div className="text-xs font-semibold text-slate-700">
              시장 상태 시그널 ({regime.signals.length}개) · raw 총점 {regime.score >= 0 ? '+' : ''}{regime.score}
              {regime.displayScore != null && ` · 표시 점수 ${regime.displayScore}/100`}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {regime.signals.map((s, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-slate-700">{s.label}</span>
                  <span className={`tabular-nums ${s.score > 0 ? 'text-emerald-700' : s.score < 0 ? 'text-red-700' : 'text-slate-500'}`}>
                    {s.score > 0 ? '+' : ''}{s.score}
                  </span>
                </li>
              ))}
            </ul>

            {/* v0.6 점수 기준표 */}
            <div className="mt-3 border-t border-slate-200 pt-2">
              <div className="text-xs font-semibold text-slate-700">점수 기준</div>
              <ul className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                <li>· 80~100 <span className="font-medium text-emerald-700">강세장</span> (공격)</li>
                <li>· 60~79 <span className="font-medium text-slate-700">보합장</span> (선별)</li>
                <li>· 40~59 <span className="font-medium text-amber-700">약세장</span> (방어)</li>
                <li>· 0~39 <span className="font-medium text-red-700">위험구간</span> (관망)</li>
              </ul>
            </div>

            <p className="mt-2 text-[10px] text-slate-500">
              ※ 이 판단은 자동 분석 결과이며 실제 투자 판단은 사용자가 최종 결정합니다.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
