// app/beginner/_components/DirectiveCard.tsx
// v0.4-1 서버 컴포넌트 — 지시형 카드 (왜 봐야 하나 / 이대로 하세요 / 기록하세요)
//
// 3 종류의 종목에 모두 같은 레이아웃 적용:
//  - NEW_CANDIDATE: 신규 후보 (기록 = TradePlanButton)
//  - RESERVED: 예약매수 대기 (기록 = StatusChangeButtons reserved)
//  - HOLDING: 보유종목 (기록 = [목표가 수정] [손절가 수정] [상태 변경])

import { ReactNode } from 'react';
import { ActionRecommend, AI_DISCLAIMER } from '../../_lib/trade_plan';
import { UrgencyResult } from '../../_lib/today_brief';
import { UrgencyBadge } from './UrgencyBadge';
import { ActionBadge } from './Badges';

interface Props {
  name: string;
  ticker: string;
  aiJudgement: ActionRecommend;
  urgency: UrgencyResult;
  whySee: string[];
  doNow: string[];
  recordButtons: ReactNode;            // 클라이언트 버튼들을 외부에서 주입
  extraInfo?: ReactNode;               // 현재가/수익률 등 추가 정보 (옵션)
}

export default function DirectiveCard({
  name, ticker, aiJudgement, urgency, whySee, doNow, recordButtons, extraInfo,
}: Props) {
  const borderClass =
    urgency.level === 'URGENT' ? 'border-red-300 bg-red-50/30' :
    urgency.level === 'TODAY'  ? 'border-amber-300 bg-amber-50/30' :
    urgency.level === 'INTEREST' ? 'border-sky-300 bg-sky-50/30' :
    'border-slate-200 bg-white';

  return (
    <div className={`rounded-md border p-3 ${borderClass}`}>
      {/* 상단: 종목명 + 뱃지 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">
            {name} <span className="text-xs text-slate-500">({ticker})</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-xs text-slate-500">AI 판단:</span>
            <ActionBadge action={aiJudgement} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <UrgencyBadge level={urgency.level} />
        </div>
      </div>

      {extraInfo && <div className="mt-2">{extraInfo}</div>}

      {/* 왜 봐야 하나 */}
      {whySee.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-700">왜 봐야 하나</div>
          <ul className="mt-1 space-y-0.5">
            {whySee.map((w, i) => (
              <li key={i} className="text-xs text-slate-700">· {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 이대로 하세요 */}
      {doNow.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-700">이대로 하세요</div>
          <ul className="mt-1 space-y-0.5">
            {doNow.map((d, i) => (
              <li key={i} className="text-xs text-slate-700">□ {d}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 기록하세요 */}
      <div className="mt-3 border-t border-slate-200 pt-2">
        <div className="text-xs font-semibold text-slate-700">기록하세요</div>
        <div className="mt-1.5">{recordButtons}</div>
      </div>

      <p className="mt-2 text-[10px] text-slate-500">※ {AI_DISCLAIMER}</p>
    </div>
  );
}
