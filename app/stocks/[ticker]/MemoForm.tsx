'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

interface MemoFormProps {
  reportId: string;
  ticker: string;
  initial: {
    interest_level: string | null;
    my_decision: string | null;
    target_buy: number | null;
    target_stop: number | null;
    target_sell: number | null;
    free_memo: string | null;
  } | null;
}

const interestOptions = [
  { value: 'HIGH', label: '높음' },
  { value: 'MID',  label: '보통' },
  { value: 'LOW',  label: '낮음' },
];

const decisionOptions = [
  { value: 'CONSIDER', label: '매수검토' },
  { value: 'WATCH',    label: '관망' },
  { value: 'EXCLUDE',  label: '제외' },
];

export default function MemoForm({ reportId, ticker, initial }: MemoFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [interest, setInterest]     = useState(initial?.interest_level ?? '');
  const [decision, setDecision]     = useState(initial?.my_decision ?? '');
  const [buyPrice, setBuyPrice]     = useState(initial?.target_buy?.toString() ?? '');
  const [stopPrice, setStopPrice]   = useState(initial?.target_stop?.toString() ?? '');
  const [sellPrice, setSellPrice]   = useState(initial?.target_sell?.toString() ?? '');
  const [memo, setMemo]             = useState(initial?.free_memo ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setErrorMsg('');

    const payload = {
      report_id: reportId,
      ticker,
      interest_level: interest || null,
      my_decision:    decision || null,
      target_buy:     buyPrice  ? Number(buyPrice)  : null,
      target_stop:    stopPrice ? Number(stopPrice) : null,
      target_sell:    sellPrice ? Number(sellPrice) : null,
      free_memo:      memo || null,
    };

    const { error } = await supabase
      .from('stock_notes')
      .upsert(payload, { onConflict: 'report_id,ticker' });

    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }

    setStatus('saved');
    startTransition(() => router.refresh());
    setTimeout(() => setStatus('idle'), 2000);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded border border-slate-200 p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-slate-700">내 메모</h2>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="text-slate-500">관심도</span>
          <select
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="">선택</option>
            {interestOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-slate-500">내 판단</span>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
          >
            <option value="">선택</option>
            {decisionOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">매수희망가</span>
        <input
          type="number"
          inputMode="numeric"
          value={buyPrice}
          onChange={(e) => setBuyPrice(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 tabular-nums"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">손절기준가</span>
        <input
          type="number"
          inputMode="numeric"
          value={stopPrice}
          onChange={(e) => setStopPrice(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 tabular-nums"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">목표가</span>
        <input
          type="number"
          inputMode="numeric"
          value={sellPrice}
          onChange={(e) => setSellPrice(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 tabular-nums"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-slate-500">자유 메모</span>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={4}
          className="w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>

      <div className="flex items-center justify-between pt-1">
        <Button type="submit" disabled={status === 'saving' || isPending}>
          {status === 'saving' ? '저장 중...' : '저장'}
        </Button>
        {status === 'saved' && (
          <span className="text-xs text-green-600">✓ 저장됨</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-600">⚠ {errorMsg}</span>
        )}
      </div>
    </form>
  );
}