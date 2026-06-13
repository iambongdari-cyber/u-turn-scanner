'use client';
// app/beginner/_components/MissedReportsBox.tsx
// v0.4-4 클라이언트 — 지난 투자판단 (달력 + 최근 리스트)
//
// 사용자 명세 §2~§7:
//  - 월간 달력 그리드 (요일 헤더 + 날짜 칸)
//  - 칸 표시: 날짜 / 1순위 종목명 / 확인 상태
//  - 색상: 확인 완료=초록, 미확인=주황, 현재 보고 있음=파란 테두리, 데이터 없음=회색
//  - 이전달/다음달 이동
//  - 하단 최근 5개 리스트 (보조)

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MissedReportEntry } from '../../_lib/beginner_data';

const SEEN_DATES_KEY = 'beginner_seen_dates';
const LEGACY_LAST_SEEN_KEY = 'beginner_last_seen_date';

interface Props {
  reports: MissedReportEntry[];
  todayDate: string | null;          // 최신 daily 의 날짜 (= "오늘" 기준)
  effectiveDate?: string | null;     // 지금 보고 있는 화면의 날짜
}

export default function MissedReportsBox({ reports, todayDate, effectiveDate }: Props) {
  const [seenDates, setSeenDates] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  // 월 이동 상태 — 최신 보고서의 월을 초기값으로
  const initialMonth = useMemo(() => {
    const ref = reports[0]?.date ?? todayDate ?? new Date().toISOString().slice(0, 10);
    return ref.slice(0, 7); // YYYY-MM
  }, [reports, todayDate]);
  const [viewMonth, setViewMonth] = useState<string>(initialMonth);

  useEffect(() => {
    setMounted(true);
    try {
      let parsed: Record<string, boolean> = {};
      const raw = window.localStorage.getItem(SEEN_DATES_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') parsed = obj;
      }
      const legacy = window.localStorage.getItem(LEGACY_LAST_SEEN_KEY);
      if (legacy && !parsed[legacy]) {
        parsed = { ...parsed, [legacy]: true };
        try { window.localStorage.setItem(SEEN_DATES_KEY, JSON.stringify(parsed)); } catch {}
      }
      setSeenDates(parsed);
    } catch {}
  }, []);

  const markSeen = (date: string) => {
    const next = { ...seenDates, [date]: true };
    setSeenDates(next);
    try {
      window.localStorage.setItem(SEEN_DATES_KEY, JSON.stringify(next));
      window.localStorage.setItem(LEGACY_LAST_SEEN_KEY, date);
    } catch {}
  };

  const handleConfirmToday = () => {
    const target = effectiveDate ?? todayDate ?? new Date().toISOString().slice(0, 10);
    markSeen(target);
  };

  // 보고서 인덱스 (date → entry)
  const reportByDate = useMemo(() => {
    const m = new Map<string, MissedReportEntry>();
    for (const r of reports) m.set(r.date, r);
    return m;
  }, [reports]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">📂 지난 투자판단</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            못 본 날이나 어제의 투자판단을 다시 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleConfirmToday}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
        >
          {mounted && effectiveDate && todayDate && effectiveDate !== todayDate
            ? '이 날짜 확인 완료'
            : '오늘 확인 완료'}
        </button>
      </div>

      {/* 달력 */}
      <div className="mt-4">
        <CalendarMonth
          viewMonth={viewMonth}
          onChangeMonth={setViewMonth}
          reportByDate={reportByDate}
          seenDates={seenDates}
          effectiveDate={effectiveDate ?? null}
          mounted={mounted}
          onClickDate={markSeen}
        />
      </div>

      {/* 하단 최근 5개 리스트 */}
      <div className="mt-5 border-t border-slate-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-800">최근 투자판단</h3>
        {reports.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">지난 투자판단이 없습니다.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {reports.slice(0, 5).map(r => {
              const seen = mounted && !!seenDates[r.date];
              const isCurrent = mounted && effectiveDate === r.date;
              return (
                <li key={r.file} className={`flex items-center justify-between gap-3 py-1.5 ${isCurrent ? 'bg-amber-50/40 -mx-2 px-2 rounded' : ''}`}>
                  <div className="min-w-0 text-sm text-slate-800">
                    <span className="font-medium">{r.date}</span>
                    <span className="text-slate-400"> · </span>
                    <span>1순위 {r.topPickName ?? '없음'}</span>
                    <span className="text-slate-400"> · </span>
                    <span className={seen ? 'text-emerald-600' : 'text-amber-700'}>
                      {seen ? '확인완료' : '미확인'}
                    </span>
                    {isCurrent && <span className="ml-2 text-xs text-amber-700">· 현재 보고 있음</span>}
                  </div>
                  <Link
                    href={`/beginner?date=${r.date}`}
                    onClick={() => markSeen(r.date)}
                    className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    보기
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────
// 월간 달력 그리드
// ───────────────────────────────────────────────────────────────

const WEEKDAY_HEADERS = ['월', '화', '수', '목', '금', '토', '일'];

function CalendarMonth({
  viewMonth,                       // 'YYYY-MM'
  onChangeMonth,
  reportByDate,
  seenDates,
  effectiveDate,
  mounted,
  onClickDate,
}: {
  viewMonth: string;
  onChangeMonth: (m: string) => void;
  reportByDate: Map<string, MissedReportEntry>;
  seenDates: Record<string, boolean>;
  effectiveDate: string | null;
  mounted: boolean;
  onClickDate: (date: string) => void;
}) {
  const [yearStr, monthStr] = viewMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1~12

  // 1일의 요일 (월=0, ..., 일=6)
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDayKor = (first.getUTCDay() + 6) % 7; // 일=0 → 6, 월=1 → 0
  // 해당 월 마지막 날짜
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < firstDayKor; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= lastDate; d++) {
    const ds = `${yearStr}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date: ds, day: d });
  }
  // 6주 그리드로 정렬 (남는 칸 null 채움)
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });

  const prevMonth = () => {
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    onChangeMonth(`${y}-${String(m).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    onChangeMonth(`${y}-${String(m).padStart(2, '0')}`);
  };

  return (
    <div>
      {/* 월 헤더 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          ← 이전달
        </button>
        <div className="text-sm font-semibold text-slate-800">
          {year}년 {month}월
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          다음달 →
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-500">
        {WEEKDAY_HEADERS.map(w => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      {/* 날짜 칸 */}
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <CalendarCell
            key={i}
            date={c.date}
            day={c.day}
            report={c.date ? reportByDate.get(c.date) : undefined}
            seen={c.date ? !!seenDates[c.date] : false}
            isCurrent={mounted && c.date != null && c.date === effectiveDate}
            mounted={mounted}
            onClick={onClickDate}
          />
        ))}
      </div>

      {/* 범례 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
        <Legend cls="bg-emerald-100 text-emerald-800" label="확인 완료" />
        <Legend cls="bg-amber-100 text-amber-800" label="미확인" />
        <Legend cls="border-2 border-sky-400 bg-white" label="현재 보고 있음" />
        <Legend cls="bg-slate-50 text-slate-400" label="데이터 없음" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded ${cls}`} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

// 칸 — 데이터 있음/없음 × 확인 완료/미확인 × 현재 보고 있음
function CalendarCell({
  date, day, report, seen, isCurrent, mounted, onClick,
}: {
  date: string | null;
  day: number | null;
  report?: MissedReportEntry;
  seen: boolean;
  isCurrent: boolean;
  mounted: boolean;
  onClick: (date: string) => void;
}) {
  if (date == null || day == null) {
    return <div className="aspect-[5/4] min-h-[52px] rounded border border-transparent bg-slate-50/40" />;
  }

  const hasData = !!report;
  let cls = 'aspect-[5/4] min-h-[52px] rounded border p-1.5 text-left transition ';
  if (!hasData) {
    cls += 'border-slate-200 bg-slate-50 text-slate-400 ';
  } else if (seen) {
    cls += 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 ';
  } else {
    cls += 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 ';
  }
  if (isCurrent) {
    // 파란 강조 테두리 추가
    cls = cls.replace(/border\-(emerald|amber|slate)\-300/, 'border-sky-400') + 'ring-2 ring-sky-300 ';
  }

  const inner = (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold">{day}</span>
        {mounted && hasData && (
          <span className={`text-[9px] ${seen ? 'text-emerald-700' : 'text-amber-700'}`}>
            {seen ? '확인완료' : '미확인'}
          </span>
        )}
      </div>
      {hasData && (
        <div className="mt-0.5 truncate text-[10px] font-medium">
          {report.topPickName ?? <span className="text-slate-400">1순위 없음</span>}
        </div>
      )}
      {hasData && (
        <div className="mt-auto text-[9px] text-slate-400">
          후보 {report.candidatesCount}
        </div>
      )}
    </div>
  );

  if (hasData) {
    return (
      <Link
        href={`/beginner?date=${date}`}
        onClick={() => onClick(date)}
        className={cls}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
