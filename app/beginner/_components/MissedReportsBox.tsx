'use client';
// app/beginner/_components/MissedReportsBox.tsx
// v0.4 클라이언트 — 놓친 리포트 + 확인 완료 버튼 (localStorage 키: beginner_last_seen_date)

import { useEffect, useState } from 'react';
import { MissedReportEntry } from '../../_lib/beginner_data';

const LAST_SEEN_KEY = 'beginner_last_seen_date';

interface Props {
  reports: MissedReportEntry[];
  todayDate: string | null;
}

export default function MissedReportsBox({ reports, todayDate }: Props) {
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const v = window.localStorage.getItem(LAST_SEEN_KEY);
      if (v) setLastSeen(v);
    } catch {}
  }, []);

  const handleConfirm = () => {
    const target = todayDate ?? new Date().toISOString().slice(0, 10);
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, target);
      setLastSeen(target);
    } catch {}
  };

  // 마지막 본 날짜보다 뒤 날짜 리포트 = 놓친 것
  const missed = mounted && lastSeen
    ? reports.filter(r => r.date > lastSeen)
    : reports;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">📂 놓친 리포트</h2>
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
        >
          오늘 확인 완료
        </button>
      </div>
      {mounted && lastSeen && (
        <p className="mt-0.5 text-xs text-slate-500">마지막 확인: {lastSeen}</p>
      )}
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">최근 리포트가 없습니다.</p>
      ) : (
        <div className="mt-3 space-y-1 text-sm">
          {reports.slice(0, 10).map(r => {
            const isMissed = mounted && lastSeen && r.date > lastSeen;
            return (
              <div key={r.file} className={`flex items-center justify-between rounded-md px-2 py-1 ${isMissed ? 'bg-amber-50' : ''}`}>
                <div>
                  {isMissed && <span className="mr-1 text-amber-600">●</span>}
                  <span className="text-slate-700">{r.date}</span>
                  <span className="ml-2 text-xs text-slate-500">후보 {r.candidatesCount}개</span>
                </div>
              </div>
            );
          })}
          {mounted && lastSeen && missed.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">놓친 리포트 {missed.length}건 — 위에서 확인 후 [오늘 확인 완료] 클릭.</p>
          )}
        </div>
      )}
    </section>
  );
}
