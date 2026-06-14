'use client';
// app/beginner/_components/CoachShell.tsx
// v0.6.1 코치 쉘 — selectTradePlanTargets 를 한 번만 호출하고
// TodayConclusion 과 MustSeeSection 양쪽에 동일한 selectedNewTargets 전달.
//
// 사용자 명세 §3:
//  - 오늘의 결론과 매매계획 기록 대상이 항상 동일한 데이터를 참조
//  - 별도 추천 로직 중복 사용 금지

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
import { buildTomorrowAction, TomorrowAction } from '../../_lib/tomorrow_action';
import TodayConclusion from './TodayConclusion';
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
}

export default function CoachShell({
  regime, rows, priceByTicker, previousJudgementByTicker, middleBoxes, marketStrength, capStyle,
}: Props) {
  const [selectedNewTargets, setSelectedNewTargets] = useState<TodayBriefItem[]>([]);
  // v0.8-1 내일 행동 지시 — selectedNewTargets 와 함께 갱신
  const [tomorrowAction, setTomorrowAction] = useState<TomorrowAction | null>(null);

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

      // v0.8-1 내일 행동 지시 빌드
      if (regime) {
        const action = buildTomorrowAction({
          regime: regime.regime,
          conditionState: condition.state,
          topPickName: targets[0]?.name ?? null,
          hasHoldingOrReserved,
          strongCandidateCount: targets.length,
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
  }, [rows, priceByTicker, previousJudgementByTicker, regime?.mode, regime?.regime]);

  // v0.6.1: 1순위 종목명 — 양쪽에 동일 데이터로 전달되므로 절대 다르지 않음
  const topPickName = selectedNewTargets[0]?.name ?? null;

  return (
    <>
      {/* §0 오늘의 결론 — topPickName 동기화 */}
      <TodayConclusion regime={regime} topPickName={topPickName} />

      {/* §1~§4 영역 (page.tsx 에서 children 으로 전달) */}
      {middleBoxes}

      {/* v0.8-1 §3.5 내일 한눈에 보기 — 오늘 장 요약 / 내일 행동 / 금지 행동 */}
      {regime && marketStrength && capStyle && tomorrowAction && (
        <MarketFlowBox
          marketRegime={regime}
          marketStrength={marketStrength}
          capStyle={capStyle}
          tomorrowAction={tomorrowAction}
        />
      )}

      {/* §5 매매계획 기록하기 — 동일한 selectedNewTargets */}
      <MustSeeSection selectedNewTargets={selectedNewTargets} />
    </>
  );
}
