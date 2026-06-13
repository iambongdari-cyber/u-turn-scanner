'use client';
// app/beginner/_components/GptReportButton.tsx
// v0.7.3 인라인 펼침 방식 (모달 제거)
//
// 변경 (v0.7.2 → v0.7.3):
//  - 모달 UX 완전 제거 — fixed/portal/dialog 미사용
//  - 버튼 클릭 시 같은 카드 안에서 리포트 영역을 바로 펼침
//  - 본문은 실제 화면에 inline 렌더 (display:none / opacity:0 / position:fixed 모두 금지)
//  - try/catch 로 리포트 생성 오류 화면에 표시
//  - 버튼 라벨 유지: "GPT 상담용 리포트 보기/복사"

import { useRef, useState } from 'react';
import { loadAllPlans } from '../../_lib/trade_storage';
import { buildGptReport, buildAll } from '../../_lib/gpt_report';
import { BeginnerRow } from '../../_lib/beginner';
import { ActionRecommend } from '../../_lib/trade_plan';
import { MarketRegimeResult, buildConclusionText } from '../../_lib/market_regime';
import { evaluateStrategyCondition } from '../../_lib/strategy_condition';

interface Props {
  base_date: string | null;
  rows: BeginnerRow[];
  priceByTicker: Record<string, number>;
  previousJudgementByTicker?: Record<string, ActionRecommend>;
  marketRegime?: MarketRegimeResult | null;
}

type Phase = 'closed' | 'generating' | 'ready' | 'error';
type CopyStatus = 'idle' | 'success' | 'fail';

export default function GptReportButton({
  base_date, rows, priceByTicker, previousJudgementByTicker, marketRegime,
}: Props) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [markdown, setMarkdown] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [selectedHint, setSelectedHint] = useState<string | null>(null);
  // v0.7.6.3: PC 인라인 펼침에서 본문을 <textarea readOnly> 로 표시 → ref 타입 변경
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ─────────────────────────────────────
  // 버튼 클릭 → 펼침 영역 표시 + 리포트 생성 (try/catch)
  // ─────────────────────────────────────
  const handleOpen = () => {
    setPhase('generating');
    setMarkdown('');
    setErrorMsg(null);
    setCopyStatus('idle');
    setSelectedHint(null);

    try {
      const priceMap = new Map<string, number>(Object.entries(priceByTicker));
      const prevMap = previousJudgementByTicker
        ? new Map<string, ActionRecommend>(Object.entries(previousJudgementByTicker))
        : undefined;
      const plans = loadAllPlans();

      const condition = evaluateStrategyCondition(plans);
      const { briefItems, selectedNewTargets } = buildAll({
        rows,
        plans,
        priceMap,
        previousJudgementMap: prevMap,
        regimeMode: marketRegime?.mode,
        conditionState: condition.state,
      });

      // v0.6.1 동기화
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

      if (!md || md.trim().length === 0) {
        throw new Error('리포트 본문이 비어 있습니다.');
      }

      setMarkdown(md);
      setPhase('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setPhase('error');
    }
  };

  const handleClose = () => {
    setPhase('closed');
    setMarkdown('');
    setErrorMsg(null);
    setCopyStatus('idle');
    setSelectedHint(null);
  };

  // ─────────────────────────────────────
  // [자동 복사 시도]
  // ─────────────────────────────────────
  const handleAutoCopy = async () => {
    setSelectedHint(null);

    // 1) navigator.clipboard
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
        setCopyStatus('success');
        setTimeout(() => setCopyStatus('idle'), 3500);
        return;
      }
    } catch {
      // → fallback
    }

    // 2) textarea fallback (iOS Safari 호환)
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);

      ta.focus();
      ta.select();
      try {
        const range = document.createRange();
        range.selectNodeContents(ta);
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        ta.setSelectionRange(0, ta.value.length);
      } catch {}

      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    } catch {
      ok = false;
    }

    if (ok) {
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 3500);
    } else {
      setCopyStatus('fail');
      selectAllReportText();
    }
  };

  // ─────────────────────────────────────
  // [전체 선택] — v0.7.6.3 textarea 기준
  // ─────────────────────────────────────
  const selectAllReportText = () => {
    try {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.select();
        try {
          ta.setSelectionRange(0, ta.value.length);
        } catch {
          // 일부 환경 미지원 — select() 만 사용
        }
        ta.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const ua = navigator?.userAgent ?? '';
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        setSelectedHint(
          isMobile
            ? '✋ 텍스트가 선택되었습니다. 길게 눌러 복사를 선택하세요.'
            : '⌨ 텍스트가 선택되었습니다. Ctrl+C (Mac: ⌘+C) 로 복사하세요.'
        );
        setTimeout(() => setSelectedHint(null), 6000);
      }
    } catch {
      setSelectedHint('선택에 실패했습니다. 본문을 직접 길게 눌러 복사해주세요.');
    }
  };

  // ─────────────────────────────────────
  // 렌더 — 컴포넌트가 한 행을 차지 (부모 flex-wrap 호환)
  // ─────────────────────────────────────
  return (
    // v0.7.6.2: 부모 flex 컨테이너 안에서 본문이 가로로 확장되는 것 방지
    //   - min-w-0: flex item 의 기본 min-width:auto 차단
    //   - max-w-full + overflow-hidden: wrapper 자체가 부모 너비를 넘지 않음
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      {/* 버튼 — 항상 표시 */}
      {phase === 'closed' && (
        <button
          type="button"
          onClick={handleOpen}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
        >
          💬 GPT 상담용 리포트 보기/복사
        </button>
      )}

      {/* 생성 중 */}
      {phase === 'generating' && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          ⏳ 리포트 생성 중...
        </div>
      )}

      {/* 오류 */}
      {phase === 'error' && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">⚠ 리포트 생성 실패</div>
          <div className="mt-1 text-xs">{errorMsg ?? '알 수 없는 오류'}</div>
          <button
            type="button"
            onClick={handleOpen}
            className="mt-2 rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            다시 시도
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      )}

      {/* 펼침 영역 — 리포트 본문 */}
      {phase === 'ready' && (
        // v0.7.6.2: 펼침 영역도 가로 확장 방지
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-emerald-200 bg-white">
          {/* 헤더 */}
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">GPT 상담용 리포트</h3>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              아래 내용을 복사해서 ChatGPT 에 붙여넣으세요.
            </p>

            {/* 액션 버튼 */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAutoCopy}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                {copyStatus === 'success' ? '✓ 복사됨' : copyStatus === 'fail' ? '↻ 다시 시도' : '자동 복사 시도'}
              </button>
              <button
                type="button"
                onClick={selectAllReportText}
                className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                전체 선택
              </button>
            </div>

            {/* 상태 메시지 */}
            {copyStatus === 'success' && (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                ✓ GPT 상담용 리포트를 복사했습니다.
              </div>
            )}
            {copyStatus === 'fail' && (
              <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                ⚠ 자동 복사에 실패했습니다. 아래 본문을 길게 눌러 직접 복사해주세요.
              </div>
            )}
            {selectedHint && (
              <div className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                {selectedHint}
              </div>
            )}
          </div>

          {/* 본문 — v0.7.6.3 textarea readOnly 사용 (PC 가로 확장 근본 차단) */}
          <div className="box-border w-full min-w-0 max-w-full overflow-hidden px-4 py-3">
            <textarea
              ref={textareaRef}
              readOnly
              value={markdown}
              className="block w-full min-w-0 max-w-full box-border resize-y rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[13px] leading-relaxed text-slate-800 sm:text-[14px]"
              style={{
                height: '520px',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                overflowX: 'auto',
                overflowY: 'auto',
                userSelect: 'text',
                WebkitUserSelect: 'text',
              }}
            />
            <p className="mt-2 text-[11px] text-slate-500">
              💡 본문 textarea 안에서 Ctrl+A 로 전체 선택 후 Ctrl+C (Mac: ⌘+C) 로 복사하거나, 위 [전체 선택] / [자동 복사 시도] 버튼을 사용하세요.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
