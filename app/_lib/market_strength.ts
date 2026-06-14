// app/_lib/market_strength.ts
// v0.8-1 KOSPI/KOSDAQ 강도 + 대형주/중소형주 흐름 판단
//
// 사용자 명세 §2 그대로:
//  - above_ma60 = true 이고 20일 수익률 ≥ 3% → STRONG
//  - above_ma60 = false 이고 20일 수익률 ≤ -3% → WEAK
//  - 그 외 NEUTRAL
//  - KOSPI 20일 - KOSDAQ 20일 차이 ≥ 3 → KOSPI_LEAD
//  - 그 반대 → KOSDAQ_LEAD
//  - 그 외 BALANCED

import { ScanMarketRaw } from './market_regime';

// ───────────────────────────────────────────────────────────────
// 타입 정의 (사용자 명세 그대로)
// ───────────────────────────────────────────────────────────────
export type IndexStrength = 'STRONG' | 'NEUTRAL' | 'WEAK';

export interface MarketStrength {
  kospi: IndexStrength;
  kosdaq: IndexStrength;
  relative: 'KOSPI_LEAD' | 'KOSDAQ_LEAD' | 'BALANCED';
  narrative: string;
  /** 데이터 부족 케이스 — UI 에서 fallback 안내에 사용 */
  insufficient: boolean;
}

export interface CapStyle {
  style: 'LARGE_CAP_LEAD' | 'SMALL_CAP_LEAD' | 'BALANCED';
  narrative: string;
}

// ───────────────────────────────────────────────────────────────
// 한국어 라벨
// ───────────────────────────────────────────────────────────────
const STRENGTH_LABEL: Record<IndexStrength, string> = {
  STRONG: '강함',
  NEUTRAL: '보통',
  WEAK: '약함',
};

// ───────────────────────────────────────────────────────────────
// classifyIndex — 단일 지수 강도
// ───────────────────────────────────────────────────────────────
function classifyIndex(
  aboveMa60: boolean | null | undefined,
  ret20d: number | null | undefined,
): IndexStrength {
  // 데이터 부족 → NEUTRAL (fallback)
  if (aboveMa60 == null || ret20d == null) return 'NEUTRAL';
  if (aboveMa60 === true && ret20d >= 3) return 'STRONG';
  if (aboveMa60 === false && ret20d <= -3) return 'WEAK';
  return 'NEUTRAL';
}

// ───────────────────────────────────────────────────────────────
// compareIndices — KOSPI vs KOSDAQ 상대강도
// ───────────────────────────────────────────────────────────────
function compareIndices(
  kospi20: number | null | undefined,
  kosdaq20: number | null | undefined,
): MarketStrength['relative'] {
  if (kospi20 == null || kosdaq20 == null) return 'BALANCED';
  const diff = kospi20 - kosdaq20;
  if (diff >= 3) return 'KOSPI_LEAD';
  if (diff <= -3) return 'KOSDAQ_LEAD';
  return 'BALANCED';
}

// ───────────────────────────────────────────────────────────────
// buildStrengthNarrative — 두 지수 강도 조합 자연어
// ───────────────────────────────────────────────────────────────
function buildStrengthNarrative(
  kospi: IndexStrength,
  kosdaq: IndexStrength,
  relative: MarketStrength['relative'],
): string {
  // 두 지수 모두 강함
  if (kospi === 'STRONG' && kosdaq === 'STRONG') {
    return 'KOSPI 와 KOSDAQ 모두 강한 흐름입니다.';
  }
  // 두 지수 모두 약함
  if (kospi === 'WEAK' && kosdaq === 'WEAK') {
    return 'KOSPI 와 KOSDAQ 모두 약한 흐름입니다.';
  }
  // 한쪽만 강한 케이스
  if (kospi === 'STRONG' && kosdaq === 'WEAK') {
    return 'KOSPI 는 강하지만 KOSDAQ 은 약합니다.';
  }
  if (kosdaq === 'STRONG' && kospi === 'WEAK') {
    return 'KOSDAQ 은 강하지만 KOSPI 는 약합니다.';
  }
  // 두 지수 모두 보합
  if (kospi === 'NEUTRAL' && kosdaq === 'NEUTRAL') {
    return 'KOSPI 와 KOSDAQ 모두 보합 흐름입니다.';
  }
  // 상대강도 기반 보조 narrative
  if (relative === 'KOSPI_LEAD') {
    return `KOSPI 는 ${STRENGTH_LABEL[kospi]}, KOSDAQ 은 ${STRENGTH_LABEL[kosdaq]} — KOSPI 쪽이 상대적으로 강합니다.`;
  }
  if (relative === 'KOSDAQ_LEAD') {
    return `KOSPI 는 ${STRENGTH_LABEL[kospi]}, KOSDAQ 은 ${STRENGTH_LABEL[kosdaq]} — KOSDAQ 쪽이 상대적으로 강합니다.`;
  }
  return `KOSPI 는 ${STRENGTH_LABEL[kospi]}, KOSDAQ 은 ${STRENGTH_LABEL[kosdaq]} 흐름입니다.`;
}

// ───────────────────────────────────────────────────────────────
// judgeMarketStrength — main
// ───────────────────────────────────────────────────────────────
export function judgeMarketStrength(market: ScanMarketRaw | null | undefined): MarketStrength {
  const kospiAboveMa60 = typeof market?.kospi_above_ma60 === 'boolean' ? market.kospi_above_ma60 : null;
  const kosdaqAboveMa60 = typeof market?.kosdaq_above_ma60 === 'boolean' ? market.kosdaq_above_ma60 : null;
  const kospi20 = typeof market?.kospi_20d_return === 'number' ? market.kospi_20d_return : null;
  const kosdaq20 = typeof market?.kosdaq_20d_return === 'number' ? market.kosdaq_20d_return : null;

  // 데이터 부족 여부
  const insufficient = kospiAboveMa60 == null || kosdaqAboveMa60 == null || kospi20 == null || kosdaq20 == null;

  if (insufficient) {
    return {
      kospi: 'NEUTRAL',
      kosdaq: 'NEUTRAL',
      relative: 'BALANCED',
      narrative: '시장 흐름 데이터가 부족해 보수적으로 판단합니다.',
      insufficient: true,
    };
  }

  const kospi = classifyIndex(kospiAboveMa60, kospi20);
  const kosdaq = classifyIndex(kosdaqAboveMa60, kosdaq20);
  const relative = compareIndices(kospi20, kosdaq20);
  const narrative = buildStrengthNarrative(kospi, kosdaq, relative);

  return { kospi, kosdaq, relative, narrative, insufficient: false };
}

// ───────────────────────────────────────────────────────────────
// judgeCapStyle — 대형주 / 중소형주 흐름
// v0.8-1 단순 기준: 상대강도 기반
//  - KOSPI_LEAD → 대형주 중심
//  - KOSDAQ_LEAD → 중소형주 중심
//  - BALANCED → 혼재
// ───────────────────────────────────────────────────────────────
export function judgeCapStyle(strength: MarketStrength): CapStyle {
  if (strength.insufficient) {
    return {
      style: 'BALANCED',
      narrative: '대형주·중소형주 흐름을 판단할 데이터가 부족합니다.',
    };
  }
  switch (strength.relative) {
    case 'KOSPI_LEAD':
      return { style: 'LARGE_CAP_LEAD', narrative: '대형주 중심의 장세입니다.' };
    case 'KOSDAQ_LEAD':
      return { style: 'SMALL_CAP_LEAD', narrative: '중소형주 중심의 장세입니다.' };
    case 'BALANCED':
    default:
      return { style: 'BALANCED', narrative: '대형주·중소형주 흐름이 혼재되어 있습니다.' };
  }
}
