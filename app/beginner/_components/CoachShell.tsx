'use client';
// app/beginner/_components/CoachShell.tsx
// v0.6.1 코치 쉘 — selectTradePlanTargets 를 한 번만 호출하고 양쪽에 동일 데이터 전달.
// v0.8-4.1 화면 중복 정리:
//   - "오늘의 결론" (TodayConclusion) 화면 노출 제거 — MarketFlowBox 와 중복.
//   - MarketFlowBox 를 화면 최상단 핵심 카드로 승격.
//   - 화면 순서: MarketFlowBox → middleBoxes(MarketRegimeBox + StrategyConditionBox) → MustSeeSection.
//   - TodayConclusion 컴포넌트 파일은 보존 (향후 재사용/회귀 대비).

import { ReactNode, useEffect, useState } from 'react';
import { BeginnerRow } from '../../_lib/beginner';
import { ActionRecommend } from '../../_lib/trade_plan';
import { loadAllPlans } from '../../_lib/trade_storage';
import {
  TodayBriefItem,
  selectTradePlanTargets,
} from '../../_lib/today_brief';
import { buildAllBriefItems } from '../../_lib/gpt_report';
import { MarketRegimeResult } from '../../_lib/market_regime';
import { evaluateStrategyCondition } from '../../_lib/strategy_condition';
import { MarketStrength, CapStyle } from '../../_lib/market_strength';
import { SectorFlow } from '../../_lib/sector_flow';
import { classifyStockCharacter, StockCharacterResult } from '../../_lib/stock_character';
import { buildTomorrowAction, TomorrowAction } from '../../_lib/tomorrow_action';
// v0.8-4.1: TodayConclusion 화면 노출 제거 → import 제거 (파일은 그대로 유지)
import MustSeeSection from './MustSeeSection';
import MarketFlowBox from './MarketFlowBox';

interface Props {
  regime: MarketRegimeResult | null;
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  /** §1~§4 영역 (MarketRegimeBox + StrategyConditionBox) */
  middleBoxes: ReactNode;
  /** v0.8-1 KOSPI/KOSDAQ 강도 + 대형주/중소형주 */
  marketStrength?: MarketStrength | null;
  capStyle?: CapStyle | null;
  /** v0.8-2 업종 흐름 + 주도 업종 + 대장주 */
  sectorFlow?: SectorFlow | null;
}

export default function CoachShell({
  regime, rows, priceByTicker, previousJudgementByTicker, middleBoxes, marketStrength, capStyle, sectorFlow,
}: Props) {
  const [selectedNewTargets, setSelectedNewTargets] = useState<TodayBriefItem[]>([]);
  // v0.8-1 내일 행동 지시 — selectedNewTargets 와 함께 갱신
  const [tomorrowAction, setTomorrowAction] = useState<TomorrowAction | null>(null);
  // v0.8-3 1순위 종목 성격 — 5등급
  const [stockCharacter, setStockCharacter] = useState<StockCharacterResult | null>(null);

  useEffect(() => {
    const recompute = () => {
      const plans = loadAllPlans();
      const priceMap = new Map<string, number>(Object.entries(priceByTicker));
      const prevMap = previousJudgementByTicker
        ? new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker))
        : undefined;
      const briefItems = buildAllBriefItems({
        rows,
        plans,
        priceMap,
        previousJudgementMap: prevMap,
      });
      const newItems = briefItems.filter(i => i.urgency.kind === 'NEW_CANDIDATE');
      const reservedItems = briefItems.filter(i => i.urgency.kind === 'RESERVED');
      const holdingItems = briefItems.filter(i => i.urgency.kind === 'HOLDING');
      const hasHoldingOrReserved = reservedItems.length + holdingItems.length > 0;
      // v0.7 전략 컨디션 평가 → 종목 선정에 반영
      const condition = evaluateStrategyCondition(plans);
      const targets = selectTradePlanTargets(newItems, hasHoldingOrReserved, regime?.mode, condition.state);
      setSelectedNewTargets(targets);

      // v0.8-3 1순위 종목 성격 분류 (사용자 명세 §4)
      const top1Row = targets[0]?.row ?? null;
      const character = regime
        ? classifyStockCharacter({
            row: top1Row,
            regime: regime.regime,
            conditionState: condition.state,
            sectorFlow: sectorFlow ?? null,
          })
        : null;
      setStockCharacter(character);

      // v0.8-1 내일 행동 지시 빌드 + v0.8-3 stockCharacter 반영
      if (regime) {
        const action = buildTomorrowAction({
          regime: regime.regime,
          conditionState: condition.state,
          topPickName: targets[0]?.name ?? null,
          hasHoldingOrReserved,
          strongCandidateCount: targets.length,
          stockCharacter: character?.character ?? null,
        });
        setTomorrowAction(action);
      } else {
        setTomorrowAction(null);
      }
    };
    recompute();
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === 'tradePlans') recompute();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, priceByTicker, previousJudgementByTicker, regime?.mode, regime?.regime, sectorFlow]);

  // v0.6.1: 1순위 종목명 — 양쪽에 동일 데이터로 전달되므로 절대 다르지 않음
  const topPickName = selectedNewTargets[0]?.name ?? null;

  return (
    <>
      {/* v0.8-4.1 최상단 핵심 카드: 🌊 내일 한눈에 보기 (오늘 장 요약 / 내일 행동 / 금지 행동 통합) */}
      {regime && marketStrength && capStyle && tomorrowAction && (
        <MarketFlowBox
          marketRegime={regime}
          marketStrength={marketStrength}
          capStyle={capStyle}
          tomorrowAction={tomorrowAction}
          sectorFlow={sectorFlow ?? null}
          stockCharacter={stockCharacter}
          topPickName={topPickName}
        />
      )}

      {/* 📊 오늘 시장 상태 + 🧭 전략 컨디션 (page.tsx 에서 middleBoxes 로 전달) */}
      {middleBoxes}

      {/* 📝 매매계획 기록하기 — 동일한 selectedNewTargets */}
      <MustSeeSection selectedNewTargets={selectedNewTargets} />
    </>
  );
}
