'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Props {
  /** 단일 알림 읽음 처리. 없으면 전체 읽음 버튼 모드. */
  singleId?: number;
  /** 전체 읽음 버튼 모드일 때 안 읽은 알림 존재 여부 */
  hasUnread?: boolean;
}

export default function AlertActions({ singleId, hasUnread }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function markRead(id: number | null) {
    let query = supabase.from('alerts').update({ is_read: true });
    if (id != null) {
      query = query.eq('id', id);
    } else {
      query = query.eq('is_read', false);
    }
    const { error } = await query;
    if (error) {
      alert(`읽음 처리 실패: ${error.message}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  if (singleId != null) {
    return (
      <button
        onClick={() => markRead(singleId)}
        disabled={pending}
        className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        읽음
      </button>
    );
  }

  // 전체 읽음 버튼
  if (!hasUnread) return null;
  return (
    <div className="mb-3 flex justify-end">
      <button
        onClick={() => markRead(null)}
        disabled={pending}
        className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? '처리 중…' : '전체 읽음 처리'}
      </button>
    </div>
  );
}
