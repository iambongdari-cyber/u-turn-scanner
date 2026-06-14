// app/_lib/sector_flow.ts
// v0.8-2 업종 흐름 + 주도 업종 + 대장주 판단
//
// 입력: sector_dump.sectors_strong[]
// 출력:
//   - TOP 3 강한 업종 (점수 정렬)
//   - 주도 업종 (조건 만족 시 leadingSector, 아니면 null)
//   - 업종별 대장주 후보 (leaders 우선, 비면 followers/opportunities 의 leadership 점수 ≥ 60)
//   - 모든 narrative 는 한국어
//
// 사용자 명세 §3·§4·§6 그대로.

import { getSectorLabel, isSectorUnmapped } from './sector_names';

// ───────────────────────────────────────────────────────────────
// 입력 raw 구조 (사이드카 sector_dump 의 일부)
// ───────────────────────────────────────────────────────────────
export interface SectorMemberRaw {
  ticker?: string;
  name?: string;
  label?: string;
  return_20d?: number | null;
  value_20d_eok?: number | null;
  near_high_pct?: number | null;
  disparity_pct?: number | null;
  above_ma60?: boolean | null;
}

export interface SectorGroupRaw {
  sector?: string;
  n_stocks?: number;
  sector_20d_return?: number | null;
  market_relative_strength?: number | null;
  leaders?: SectorMemberRaw[];
  followers?: SectorMemberRaw[];
  opportunities?: SectorMemberRaw[];
  chase_risk?: SectorMemberRaw[];
}

// ───────────────────────────────────────────────────────────────
// 결과 인터페이스 (사용자 명세 §2 그대로)
// ───────────────────────────────────────────────────────────────
export interface SectorStrength {
  sector: string;
  sectorLabel: string;
  return20d: number | null;
  marketRelStrength: number | null;
  totalValue20dEok: number;
  leaderCount: number;
  followerCount: number;
  opportunityCount: number;
  score: number;
  isLeading: boolean;
  narrative: string;
}

export interface LeaderStock {
  ticker: string;
  name: string;
  sector: string;
  sectorLabel: string;
  return20d: number | null;
  value20dEok: number | null;
  nearHighPct: number | null;
  disparityPct: number | null;
  aboveMa60: boolean | null;
  leadershipScore: number;
  /** 'TRUE_LEADER' = sectors_strong.leaders 에서 가져옴, 'QUASI_LEADER' = followers/opportunities 에서 보정 */
  source: 'TRUE_LEADER' | 'QUASI_LEADER';
  narrative: string;
}

export interface SectorFlow {
  topThree: SectorStrength[];
  leadingSector: SectorStrength | null;
  leadersBySector: Record<string, LeaderStock[]>;
  /** 업종 TOP 3 자연어 ("오늘 강한 업종은 반도체, 자동차, 금융입니다.") */
  narrative: string;
  /** 대장주 자연어 ("대장주 흐름은 아직 살아 있습니다.") */
  leaderNarrative: string;
  /** 데이터 부족 안내 표시 여부 */
  insufficient: boolean;
}

// ───────────────────────────────────────────────────────────────
// 업종 점수화 (사용자 명세 §3)
// ───────────────────────────────────────────────────────────────
export function scoreSector(s: SectorGroupRaw): number {
  let score = 0;

  // 20일 수익률
  if (typeof s.sector_20d_return === 'number') {
    score += Math.min(35, Math.max(0, s.sector_20d_return * 0.7));
  }
  // 시장 대비 상대강도
  if (typeof s.market_relative_strength === 'number') {
    score += Math.min(30, Math.max(0, s.market_relative_strength * 0.5));
  }
  // 거래대금 합계
  const allStocks: SectorMemberRaw[] = [
    ...(s.leaders ?? []),
    ...(s.followers ?? []),
    ...(s.opportunities ?? []),
  ];
  const totalValue = allStocks.reduce((sum, x) => sum + (x.value_20d_eok ?? 0), 0);
  score += Math.min(20, totalValue / 50);

  // 후보 종목 수
  score += Math.min(15, allStocks.length * 3);

  // 추격 위험 감점 (chase_risk 가 비어있지 않으면)
  if (Array.isArray(s.chase_risk) && s.chase_risk.length > 0) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ───────────────────────────────────────────────────────────────
// 종목 leadership 점수화 (사용자 명세 §6)
// ───────────────────────────────────────────────────────────────
export function scoreLeaderStock(stock: SectorMemberRaw): number {
  let score = 0;

  const value = stock.value_20d_eok ?? 0;
  if (value >= 100) score += 30;
  else if (value >= 50) score += 20;
  else score += 10;

  const r = stock.return_20d ?? 0;
  if (r >= 5 && r <= 30) score += 25;
  else if (r > 30) score += 10;

  if (stock.above_ma60) score += 15;

  const nh = stock.near_high_pct ?? 0;
  if (nh >= 80) score += 15;

  const dp = stock.disparity_pct ?? 0;
  if (dp >= 20) score -= 25;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ───────────────────────────────────────────────────────────────
// 단일 업종 → SectorStrength 변환
// ───────────────────────────────────────────────────────────────
function toSectorStrength(s: SectorGroupRaw): SectorStrength {
  const sector = s.sector ?? '';
  const sectorLabel = getSectorLabel(sector);
  const score = scoreSector(s);
  const leaderCount = s.leaders?.length ?? 0;
  const followerCount = s.followers?.length ?? 0;
  const opportunityCount = s.opportunities?.length ?? 0;
  const allStocks = [...(s.leaders ?? []), ...(s.followers ?? []), ...(s.opportunities ?? [])];
  const totalValue20dEok = allStocks.reduce((sum, x) => sum + (x.value_20d_eok ?? 0), 0);

  return {
    sector,
    sectorLabel,
    return20d: typeof s.sector_20d_return === 'number' ? s.sector_20d_return : null,
    marketRelStrength: typeof s.market_relative_strength === 'number' ? s.market_relative_strength : null,
    totalValue20dEok,
    leaderCount,
    followerCount,
    opportunityCount,
    score,
    isLeading: false,  // 나중에 leadingSector 선정 시 갱신
    narrative: '',     // 보조 안내 — 우선 비움
  };
}

// ───────────────────────────────────────────────────────────────
// 대장주 추출 (leaders 우선, 비면 followers/opportunities fallback)
// ───────────────────────────────────────────────────────────────
function extractLeaders(
  s: SectorGroupRaw,
  sectorLabel: string,
): LeaderStock[] {
  const leaders = (s.leaders ?? []).map(m => ({
    raw: m, source: 'TRUE_LEADER' as const,
  }));

  // leaders 가 비어있으면 followers + opportunities 중 leadership 점수 ≥ 60 fallback
  const fallbackPool = leaders.length === 0
    ? [...(s.followers ?? []), ...(s.opportunities ?? [])].map(m => ({
        raw: m, source: 'QUASI_LEADER' as const,
      }))
    : [];

  const pool = leaders.length > 0 ? leaders : fallbackPool;

  const scored = pool
    .filter(p => !!p.raw.ticker && !!p.raw.name)
    .map(p => {
      const ls = scoreLeaderStock(p.raw);
      return { ...p, leadershipScore: ls };
    })
    // QUASI_LEADER 는 leadership 60 이상만 통과
    .filter(p => p.source === 'TRUE_LEADER' || p.leadershipScore >= 60)
    .sort((a, b) => b.leadershipScore - a.leadershipScore);

  return scored.slice(0, 3).map(p => ({
    ticker: p.raw.ticker!,
    name: p.raw.name!,
    sector: s.sector ?? '',
    sectorLabel,
    return20d: p.raw.return_20d ?? null,
    value20dEok: p.raw.value_20d_eok ?? null,
    nearHighPct: p.raw.near_high_pct ?? null,
    disparityPct: p.raw.disparity_pct ?? null,
    aboveMa60: p.raw.above_ma60 ?? null,
    leadershipScore: p.leadershipScore,
    source: p.source,
    narrative: p.source === 'QUASI_LEADER' ? '준대장주 후보' : '대장주',
  }));
}

// ───────────────────────────────────────────────────────────────
// 주도 업종 narrative 빌드 (사용자 명세 §4)
// ───────────────────────────────────────────────────────────────
function buildSectorNarrative(
  topThree: SectorStrength[],
  leadingSector: SectorStrength | null,
): string {
  if (topThree.length === 0) {
    return '오늘 강한 업종이 뚜렷하지 않습니다.';
  }
  const names = topThree.map(s => s.sectorLabel).join(', ');
  let out = `오늘 강한 업종은 ${names}입니다.`;
  if (leadingSector) {
    out += ` 가장 뚜렷한 주도 업종은 ${leadingSector.sectorLabel}입니다.`;
  } else {
    out += ' 다만 가장 뚜렷한 주도 업종을 특정하기 어렵습니다.';
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// 대장주 narrative 빌드
// ───────────────────────────────────────────────────────────────
function buildLeaderNarrative(
  leadersBySector: Record<string, LeaderStock[]>,
  leadingSector: SectorStrength | null,
): string {
  const totalLeaders = Object.values(leadersBySector).flat();

  if (totalLeaders.length === 0) {
    return '오늘 업종별 대장주를 특정하기 어렵습니다.';
  }

  // 모든 대장주가 QUASI_LEADER 면 흐름 약함 안내
  const hasTrueLeader = totalLeaders.some(l => l.source === 'TRUE_LEADER');

  const lines: string[] = [];
  // 주도 업종부터 우선 노출
  const sectorOrder = leadingSector
    ? [leadingSector.sector, ...Object.keys(leadersBySector).filter(k => k !== leadingSector.sector)]
    : Object.keys(leadersBySector);

  for (const sector of sectorOrder) {
    const arr = leadersBySector[sector];
    if (!arr || arr.length === 0) continue;
    const label = arr[0].sectorLabel;
    const names = arr.map(s => s.name).join(', ');
    lines.push(`${label}: ${names}`);
  }

  let summary = '';
  const avgScore = totalLeaders.reduce((sum, l) => sum + l.leadershipScore, 0) / totalLeaders.length;
  if (avgScore >= 70) summary = '대장주 흐름은 아직 살아 있습니다.';
  else if (avgScore >= 50) summary = '대장주 흐름은 보통 수준입니다.';
  else summary = '대장주 흐름은 약합니다.';

  if (!hasTrueLeader) {
    summary += ' (사이드카 대장주 목록 비어 — 후발/기회 종목으로 보정.)';
  }

  return [...lines, summary].join('\n');
}

// ───────────────────────────────────────────────────────────────
// 메인: judgeSectorFlow
// ───────────────────────────────────────────────────────────────
export function judgeSectorFlow(sectors_strong: SectorGroupRaw[] | null | undefined): SectorFlow {
  if (!Array.isArray(sectors_strong) || sectors_strong.length === 0) {
    return {
      topThree: [],
      leadingSector: null,
      leadersBySector: {},
      narrative: '오늘 강한 업종이 뚜렷하지 않습니다.',
      leaderNarrative: '오늘 업종별 대장주를 특정하기 어렵습니다.',
      insufficient: true,
    };
  }

  // 1) 점수 정렬
  const scored = sectors_strong.map(toSectorStrength).sort((a, b) => b.score - a.score);
  const topThree = scored.slice(0, 3);

  // 2) 주도 업종 선정 (사용자 명세 §4)
  let leadingSector: SectorStrength | null = null;
  if (topThree.length > 0) {
    const top = topThree[0];
    const candidateCount = top.leaderCount + top.followerCount + top.opportunityCount;
    if (
      top.score >= 70 &&
      candidateCount >= 3 &&
      top.totalValue20dEok >= 50  // 거래대금 합계 50억 이상
    ) {
      leadingSector = { ...top, isLeading: true };
      // topThree 안에서도 같은 객체 isLeading 갱신
      topThree[0] = leadingSector;
    }
  }

  // 3) 업종별 대장주 추출 (TOP 3 만)
  const leadersBySector: Record<string, LeaderStock[]> = {};
  for (const ss of topThree) {
    // 원본 SectorGroupRaw 다시 찾기
    const raw = sectors_strong.find(r => r.sector === ss.sector);
    if (!raw) continue;
    const leaders = extractLeaders(raw, ss.sectorLabel);
    if (leaders.length > 0) {
      leadersBySector[ss.sector] = leaders;
    }
  }

  // 4) narrative 생성
  const narrative = buildSectorNarrative(topThree, leadingSector);
  const leaderNarrative = buildLeaderNarrative(leadersBySector, leadingSector);

  // 5) insufficient 판정 — TOP 1 점수 < 50 or 매핑 미등록 다수
  const insufficient =
    topThree.length === 0 ||
    topThree[0].score < 50 ||
    topThree.every(s => isSectorUnmapped(s.sector));

  return {
    topThree,
    leadingSector,
    leadersBySector,
    narrative,
    leaderNarrative,
    insufficient,
  };
}
