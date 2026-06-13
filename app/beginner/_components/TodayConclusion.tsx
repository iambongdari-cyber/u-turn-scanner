// app/beginner/_components/TodayConclusion.tsx
// v0.4-2 서버 컴포넌트 — 오늘 결론 (1순위 / 추가 확인 분리)

import { TodayBrief } from '../../_lib/today_brief';
import { AI_DISCLAIMER } from '../../_lib/trade_plan';

interface Props {
  brief: TodayBrief;
}

export default function TodayConclusion({ brief }: Props) {
  const top1 = brief.todoActions.filter(a => a.priority === 'top1');
  const secondary = brief.todoActions.filter(a => a.priority === 'secondary');
  const isEmpty = brief.headlineTodoCount === 0;

  return (
    <section className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <h2 className="text-lg font-semibold text-indigo-900">📌 오늘 결론</h2>

      {/* 헤드라인 — "오늘 1순위 할 일은 이것입니다." */}
      <p className="mt-1 text-base font-semibold text-indigo-900">
        {isEmpty
          ? '오늘은 꼭 해야 할 일이 없습니다.'
          : '오늘 1순위 할 일은 이것입니다.'}
      </p>

      {/* 1순위 */}
      {top1.length > 0 && (
        <div className="mt-3 rounded-md border border-indigo-300 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">1순위</div>
          <p className="mt-1 text-sm font-semibold text-slate-900">{top1[0].text}</p>
        </div>
      )}

      {/* 시간 있으면 추가 확인 */}
      {secondary.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">시간 있으면 추가 확인</div>
          <ol start={2} className="mt-1.5 space-y-1 text-sm text-slate-800">
            {secondary.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-slate-600">{i + 2}.</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 보조 한 줄 */}
      {brief.briefLines.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-indigo-700">
          {brief.briefLines.map((b, i) => (
            <li key={i}>· {b}</li>
          ))}
        </ul>
      )}

      {/* 오늘 하지 말아야 할 행동 */}
      <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
        <div className="text-sm font-semibold text-red-900">🚫 오늘 하지 말 것</div>
        <ul className="mt-1 space-y-0.5">
          {brief.dontDo.map((d, i) => (
            <li key={i} className="text-xs text-red-800">· {d}</li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[10px] text-indigo-600">※ {AI_DISCLAIMER}</p>
    </section>
  );
}
