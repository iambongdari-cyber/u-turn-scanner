import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SearchForm from './_components/SearchForm';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // 가장 최근 일일 리포트 1건
  const { data: latestDaily } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 안 읽은 알림 개수
  const { count: unreadCount } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  return (
    <main className="container mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">U턴 스캐너</h1>
        <p className="mt-1 text-sm text-slate-600">
          국내주식 U턴 종목 자동 스캐너 · 분석 보조 도구
        </p>
      </header>

      <SearchForm defaultDate={latestDaily?.base_date} />

      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        {latestDaily ? (
          <Link
            href={`/reports/${latestDaily.id}`}
            className="text-blue-600 hover:underline"
          >
            ▶ 가장 최근 일일 리포트 ({latestDaily.base_date}) 바로 보기
          </Link>
        ) : (
          <span className="text-slate-500">아직 일일 리포트가 없습니다.</span>
        )}
        <Link href="/history" className="text-blue-600 hover:underline">
          📅 과거 리포트 전체 보기
        </Link>
        <Link href="/backtest" className="text-blue-600 hover:underline">
          📊 백테스트 결과
        </Link>
        <Link href="/alerts" className="flex items-center gap-1.5 text-blue-600 hover:underline">
          🔔 알림
          {unreadCount != null && unreadCount > 0 && (
            <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-sm">
        <span className="text-xs text-slate-500">기회·위험 점검판 (v0.1)</span>
        <Link href="/market" className="text-emerald-700 hover:underline">🗺 오늘의 시장 지도</Link>
        <Link href="/opportunities" className="text-emerald-700 hover:underline">🎯 오늘의 기회 포착판</Link>
        <Link href="/kiwoom-helper" className="text-emerald-700 hover:underline">📋 키움 자동감시 참고표</Link>
        <Link href="/journal" className="text-emerald-700 hover:underline">📝 매매일지 초안</Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-slate-500">사이드카 분석 (v0.2)</span>
        <Link href="/bottom-watch" className="text-indigo-700 hover:underline">🌱 바닥 U턴 후보</Link>
      </div>
    </main>
  );
}