// app/beginner/_components/MustSeeSection.tsx
// v0.4-2 서버 컴포넌트 — "매매계획 기록하기"
//
// 레이아웃 규칙 (사용자 요청):
// - 1개: 가로형 압축 카드 1개
// - 2개: 세로형 카드 2개 나란히 (sm:grid-cols-2)
// - 3개: 1순위 가로형 + 2~3위 세로형 2개 나란히
//
// 1순위 가로형:
//   한 줄에 종목/AI/U턴/위험/현재가 + 핵심 이유 1줄 + 이대로 1줄 + [기록 버튼]
// 2~3위 세로형:
//   종목/AI/현재가/U턴/위험 + 핵심 이유 2~3개 + [기록 버튼]

import { TodayBriefItem } from '../../_lib/today_brief';
import { judgeRow, BeginnerRow } from '../../_lib/beginner';
import {
  ActionRecommend,
  ACTION_LABEL,
  ACTION_BADGE_CLASS,
  RiskLevel,
  RISK_LABEL,
  RISK_BADGE_CLASS,
  AI_DISCLAIMER,
} from '../../_lib/trade_plan';
import TradePlanButton from './TradePlanButton';

interface Props {
  /** 사전에 selectTradePlanTargets() 로 선정된 신규 매매계획 대상 (1~3개) */
  selectedNewTargets: TodayBriefItem[];
}

export default function MustSeeSection({ selectedNewTargets }: Props) {
  if (selectedNewTargets.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">📝 매매계획 기록하기</h2>
        <p className="mt-2 text-sm text-emerald-700">
          오늘 새로 기록할 매매계획은 없습니다.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          예약매수 대기 / 보유종목은 아래에서 확인하세요.
        </p>
      </section>
    );
  }

  const n = selectedNewTargets.length;
  const top1 = selectedNewTargets[0];

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50/30 p-4">
      <h2 className="text-lg font-semibold text-slate-900">📝 매매계획 기록하기</h2>
      <p className="mt-0.5 text-xs text-slate-600">
        위 <strong className="text-slate-800">오늘 할 일</strong>에 나온 종목을 여기서 기록합니다.
      </p>

      {/* === 1개 — 가로형 압축 카드만 === */}
      {n === 1 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
            오늘 1순위
          </div>
          <HorizontalCard item={top1} />
        </div>
      )}

      {/* === 2개 — 세로형 2개 나란히 === */}
      {n === 2 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
            오늘 매매계획 대상
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <VerticalCard item={selectedNewTargets[0]} rank={1} />
            <VerticalCard item={selectedNewTargets[1]} rank={2} />
          </div>
        </div>
      )}

      {/* === 3개 — 1순위 가로형 + 2~3위 세로형 2개 === */}
      {n >= 3 && (
        <>
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
              오늘 1순위
            </div>
            <HorizontalCard item={top1} />
          </div>
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              시간 있으면
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedNewTargets.slice(1, 3).map((it, i) => (
                <VerticalCard key={it.ticker} item={it} rank={i + 2} />
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-3 text-[10px] text-slate-500">※ {AI_DISCLAIMER}</p>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────
// 1순위 가로형 압축 카드 — 세로 길이 최소화
// ───────────────────────────────────────────────────────────────
function HorizontalCard({ item }: { item: TodayBriefItem }) {
  if (!item.row) return null;
  const row = item.row;
  const v = judgeRow(row);
  const why = buildCoreReason(row, v);

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-white p-3">
      {/* 1줄 — 종목 + 메타 정보 */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-semibold text-slate-900">
          {item.name} <span className="text-xs text-slate-500">({item.ticker})</span>
        </div>
        <MetaInline label="AI 판단" badge={<ActionInline action={v.ai_judgement} />} />
        <MetaInline label="U턴" value={`${v.uturn_passed}/5`} />
        <MetaInline label="위험" badge={<RiskInline risk={v.risk} />} />
        {row.close != null && (
          <MetaInline label="현재가" value={`${row.close.toLocaleString()}원`} />
        )}
      </div>

      {/* 2줄 — 핵심 이유 한 줄 */}
      {why.length > 0 && (
        <div className="mt-1.5 text-xs text-slate-700">
          <span className="text-slate-500">핵심 이유:</span> {why.join(' · ')}
        </div>
      )}

      {/* 3줄 — 이대로 한 줄 (화살표 연결) */}
      <div className="mt-1 text-xs text-slate-700">
        <span className="text-slate-500">이대로:</span> 매매계획 기록 → 1차 예약가/손절가 확인 → 키움 예약매수 직접 입력
      </div>

      {/* 버튼 */}
      <div className="mt-2 flex justify-end">
        <TradePlanButton row={row} />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 2~3위 세로형 작은 카드 — 간결
// ───────────────────────────────────────────────────────────────
function VerticalCard({ item, rank }: { item: TodayBriefItem; rank: number }) {
  if (!item.row) return null;
  const row = item.row;
  const v = judgeRow(row);
  const why = buildCoreReason(row, v).slice(0, 3);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      {/* 헤더 — 종목명 + 순위 + AI 뱃지 */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {rank}순위
          </div>
          <div className="font-semibold text-slate-900">
            {item.name} <span className="text-xs text-slate-500">({item.ticker})</span>
          </div>
        </div>
        <ActionInline action={v.ai_judgement} />
      </div>

      {/* 메타 한 줄 */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-slate-700">
        {row.close != null && (
          <span>
            <span className="text-slate-500">현재가</span>{' '}
            <strong className="text-slate-800">{row.close.toLocaleString()}원</strong>
          </span>
        )}
        <span>
          <span className="text-slate-500">U턴</span>{' '}
          <strong className="text-slate-800">{v.uturn_passed}/5</strong>
        </span>
        <RiskInline risk={v.risk} />
      </div>

      {/* 핵심 이유 — 2~3개 bullet */}
      {why.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {why.map((w, i) => (
            <li key={i} className="text-xs text-slate-700">· {w}</li>
          ))}
        </ul>
      )}

      {/* 기록 버튼 */}
      <div className="mt-3 flex justify-end">
        <TradePlanButton row={row} />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────────────────
function buildCoreReason(row: BeginnerRow, v: ReturnType<typeof judgeRow>): string[] {
  const out: string[] = [];
  if (v.uturn_passed >= 4) out.push(`U턴 신호 ${v.uturn_passed}/5`);
  if (row.checks?.value_recovering) out.push('거래대금 회복');
  else if (row.checks?.value_ok) out.push('거래대금 임계 충족');
  if (row.checks?.above_ma60) out.push('60일선 회복');
  if (v.risk === 'LOW') out.push('위험 낮음');
  else if (v.risk === 'MED') out.push('위험 보통');
  return out;
}

function MetaInline({ label, value, badge }: { label: string; value?: string; badge?: React.ReactNode }) {
  return (
    <span className="text-xs text-slate-700">
      <span className="text-slate-500">{label}</span>{' '}
      {badge ?? <strong className="text-slate-800">{value}</strong>}
    </span>
  );
}

function ActionInline({ action }: { action: ActionRecommend }) {
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_BADGE_CLASS[action]}`}>
      {ACTION_LABEL[action]}
    </span>
  );
}

function RiskInline({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_BADGE_CLASS[risk]}`}>
      위험 {RISK_LABEL[risk]}
    </span>
  );
}
