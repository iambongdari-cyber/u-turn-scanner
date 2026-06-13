'use client';
// app/beginner/_components/TodayTodoBox.tsx
// v0.4-2 클라이언트 — 오늘 할 일 체크리스트 (1순위 / 시간 있으면 분리)
// localStorage 키: beginner_today_todos_<YYYY-MM-DD>

import { useEffect, useState } from 'react';
import { TodayAction } from '../../_lib/today_brief';

interface Props {
  actions: TodayAction[];
  baseDate: string | null;
}

const KEY_PREFIX = 'beginner_today_todos_';

export default function TodayTodoBox({ actions, baseDate }: Props) {
  const today = baseDate ?? new Date().toISOString().slice(0, 10);
  const storageKey = `${KEY_PREFIX}${today}`;

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setChecked(parsed);
      }
    } catch {}
  }, [storageKey]);

  const fixedItems = ['후보 전체 훑지 않기', '손절가 없이 예약매수 넣지 않기'];

  const toggle = (text: string) => {
    const next = { ...checked, [text]: !checked[text] };
    setChecked(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  };

  const top1 = actions.filter(a => a.priority === 'top1');
  const secondary = actions.filter(a => a.priority === 'secondary');

  if (actions.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
        <h2 className="text-lg font-semibold text-slate-900">✅ 오늘 할 일</h2>
        <p className="mt-2 text-sm text-emerald-700">
          오늘 꼭 해야 할 매매 액션은 없습니다.
        </p>
        <ul className="mt-2 space-y-0.5">
          {fixedItems.map((t, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!checked[t]}
                onChange={() => toggle(t)}
                className="h-4 w-4"
                disabled={!mounted}
              />
              <span className={checked[t] ? 'line-through text-slate-400' : ''}>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">✅ 오늘 할 일</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        체크하면 저장됩니다 (기준일 {today} 기준).
      </p>

      {/* 오늘 1순위 */}
      {top1.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">오늘 1순위</div>
          <ul className="mt-1 space-y-1">
            {top1.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={!!checked[a.text]}
                  onChange={() => toggle(a.text)}
                  className="h-4 w-4"
                  disabled={!mounted}
                />
                <span className={checked[a.text] ? 'line-through text-slate-400' : ''}>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 시간 있으면 */}
      {secondary.length > 0 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">시간 있으면</div>
          <ul className="mt-1 space-y-1">
            {secondary.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={!!checked[a.text]}
                  onChange={() => toggle(a.text)}
                  className="h-4 w-4"
                  disabled={!mounted}
                />
                <span className={checked[a.text] ? 'line-through text-slate-400' : ''}>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 고정 — 항상 하지 말 것 */}
      <div className="mt-3 border-t border-slate-200 pt-2">
        <ul className="space-y-0.5">
          {fixedItems.map((t, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={!!checked[t]}
                onChange={() => toggle(t)}
                className="h-3.5 w-3.5"
                disabled={!mounted}
              />
              <span className={checked[t] ? 'line-through text-slate-400' : ''}>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
