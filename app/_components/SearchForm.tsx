'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface SearchFormProps {
  defaultType?: 'daily' | 'weekly';
  defaultDate?: string;     // 'YYYY-MM-DD'
}

export default function SearchForm({
  defaultType = 'daily',
  defaultDate,
}: SearchFormProps) {
  const router = useRouter();
  const [type, setType] = useState<'daily' | 'weekly'>(defaultType);
  const [date, setDate] = useState<string>(
    defaultDate ?? new Date().toISOString().split('T')[0],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?type=${type}&date=${date}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-md border border-slate-300 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-slate-500">리포트 유형</span>
        <div className="flex gap-3">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="report_type"
              value="daily"
              checked={type === 'daily'}
              onChange={() => setType('daily')}
            />
            <span>일일</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="report_type"
              value="weekly"
              checked={type === 'weekly'}
              onChange={() => setType('weekly')}
            />
            <span>주간</span>
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-slate-500">기준일</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      <Button type="submit">검색</Button>
    </form>
  );
}