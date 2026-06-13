'use client';
// app/beginner/_components/CollapsibleCandidates.tsx
// v0.4-2 클라이언트 — 관심 후보 + 참고 후보 펼치기
// 변경 (사용자 명세 §5, §6):
//  - 숫자 강조 제거 — "관심 후보 (115)" → "관심 후보" (필요할 때만 펼치기)
//  - 숫자는 보조로 작게만 표시

import { useState } from 'react';
import { BeginnerRow } from '../../_lib/beginner';
import CategoryCard from './CategoryCard';

interface Section {
  title: string;
  subtitle: string;
  rows: BeginnerRow[];
}

interface Props {
  interestRows: BeginnerRow[];
  bottomRows: BeginnerRow[];
  leaderRows: BeginnerRow[];
  lateRows: BeginnerRow[];
}

export default function CollapsibleCandidates({
  interestRows, bottomRows, leaderRows, lateRows,
}: Props) {
  const [interestOpen, setInterestOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  const sections: Section[] = [
    { title: '🌱 바닥 U턴 후보', subtitle: '오랜 하락을 마치고 60일선 위로 회복 중인 종목', rows: bottomRows },
    { title: '🏆 현재 주도주', subtitle: '같은 섹터 안에서 거래대금과 가격 위치가 동시에 좋은 종목', rows: leaderRows },
    { title: '🥈 후발 강세 후보', subtitle: '주도주를 뒤따라가는 후발 강세 종목', rows: lateRows },
  ];

  return (
    <>
      {/* 관심 후보 — 숫자 강조 제거 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            🔍 관심 후보
            <span className="ml-2 text-xs font-normal text-slate-400">({interestRows.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => setInterestOpen(!interestOpen)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            {interestOpen ? '접기' : '필요할 때만 펼치기'}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          오늘 행동 대상은 아닙니다. 흐름 변화가 있는 종목입니다.
        </p>
        {interestOpen && (
          interestRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">관심 후보 없음.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {interestRows.map(r => (
                <CategoryCard key={r.ticker} row={r} />
              ))}
            </div>
          )
        )}
      </section>

      {/* 참고 후보 펼치기 — 숫자 강조 제거 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            📚 참고 후보
            <span className="ml-2 text-xs font-normal text-slate-400">
              ({bottomRows.length + leaderRows.length + lateRows.length})
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setReferenceOpen(!referenceOpen)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            {referenceOpen ? '접기' : '참고 후보 펼치기'}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          오늘 행동 대상은 아닙니다.
        </p>
        {referenceOpen && (
          <div className="mt-4 space-y-5">
            {sections.map((s, idx) => (
              <div key={idx}>
                <div className="border-b border-slate-200 pb-1">
                  <div className="font-semibold text-slate-800">
                    {s.title}
                    <span className="ml-2 text-xs font-normal text-slate-400">({s.rows.length})</span>
                  </div>
                  <div className="text-xs text-slate-500">{s.subtitle}</div>
                </div>
                {s.rows.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">해당 카테고리 후보 없음.</p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {s.rows.slice(0, 30).map(r => (
                      <CategoryCard key={r.ticker} row={r} />
                    ))}
                    {s.rows.length > 30 && (
                      <p className="col-span-full mt-2 text-xs text-slate-500">
                        ... 외 {s.rows.length - 30}건 (상위 30개만 표시)
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
