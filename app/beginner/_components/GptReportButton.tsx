'use client';
// app/beginner/_components/GptReportButton.tsx
// v0.4-2 클라이언트 — 행동 중심 GPT 리포트 생성/복사

import { useState } from 'react';
import { loadAllPlans } from '../../_lib/trade_storage';
import { buildGptReport, buildAll } from '../../_lib/gpt_report';
import { BeginnerRow } from '../../_lib/beginner';
import { ActionRecommend } from '../../_lib/trade_plan';
import { MarketRegimeResult, buildConclusionText } from '../../_lib/market_regime';

interface Props {
  base_date: string | null;
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  /** v0.5 시장 상태 결과 — 리포트 §0 + §1 헤드라인 톤에 반영 */
  marketRegime?: MarketRegimeResult | null;
}

export default function GptReportButton({ base_date, rows, priceByTicker, previousJudgementByTicker, marketRegime }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [markdown, setMarkdown] = useState('');

  const generate = () => {
    const priceMap = new Map<string, number>(Object.entries(priceByTicker));
    const prevMap = previousJudgementByTicker
      ? new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker))
      : undefined;
    const plans = loadAllPlans();

    const { briefItems, selectedNewTargets } = buildAll({
      rows,
      plans,
      priceMap,
      previousJudgementMap: prevMap,
      regimeMode: marketRegime?.mode,
    });

    // v0.6.1: 매매계획 기록 대상 1순위 종목명으로 marketRegime 의 conclusionText 동기화
    let regimeForReport = marketRegime ?? null;
    if (regimeForReport) {
      const topPickName = selectedNewTargets[0]?.name ?? null;
      const syncedConclusion = buildConclusionText(regimeForReport.regime, regimeForReport.mode, topPickName);
      regimeForReport = { ...regimeForReport, conclusionText: syncedConclusion };
    }

    const md = buildGptReport({
      base_date,
      rows,
      plans,
      currentPriceByTicker: priceMap,
      previousJudgementByTicker: prevMap,
      briefItems,
      selectedNewTargets,
      marketRegime: regimeForReport,
    });
    setMarkdown(md);
    setOpen(true);
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={generate}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
      >
        💬 GPT 상담용 리포트 복사
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">GPT 상담용 리포트 (행동 중심)</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    {copied ? '✓ 복사됨' : '클립보드에 복사'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
                  >
                    닫기
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">아래 내용을 그대로 ChatGPT 에 붙여넣어 상담받을 수 있습니다.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-800">
                {markdown}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
