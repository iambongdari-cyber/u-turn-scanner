import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface IndexInfo {
  name: 'KOSPI' | 'KOSDAQ';
  date: string;
  close: number;
  change_pct: number | null;
  ma60: number;
  above_ma60: boolean;
}

async function loadIndex(name: 'KOSPI' | 'KOSDAQ'): Promise<IndexInfo | null> {
  const { data } = await supabase
    .from('market_indices')
    .select('date, close, change_pct')
    .eq('index_name', name)
    .order('date', { ascending: false })
    .limit(60);
  if (!data || data.length < 60) return null;
  const closes = data.map((d: any) => Number(d.close));
  const ma60 = closes.reduce((a, b) => a + b, 0) / 60;
  const latest = data[0] as any;
  return {
    name,
    date: latest.date,
    close: Number(latest.close),
    change_pct: latest.change_pct != null ? Number(latest.change_pct) : null,
    ma60,
    above_ma60: Number(latest.close) > ma60,
  };
}

export default async function MarketPage() {
  const [kospi, kosdaq] = await Promise.all([loadIndex('KOSPI'), loadIndex('KOSDAQ')]);

  const { data: latestDaily } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'daily')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: latestWeekly } = await supabase
    .from('reports')
    .select('id, base_date')
    .eq('report_type', 'weekly')
    .order('base_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let marketState: '강세 흐름' | '중립 흐름' | '약세 흐름' = '중립 흐름';
  if (kospi && kosdaq) {
    const above = (kospi.above_ma60 ? 1 : 0) + (kosdaq.above_ma60 ? 1 : 0);
    if (above === 2) marketState = '강세 흐름';
    else if (above === 0) marketState = '약세 흐름';
  }
  const stateCls =
    marketState === '강세 흐름' ? 'bg-green-100 text-green-800' :
    marketState === '약세 흐름' ? 'bg-red-100 text-red-800' :
                                   'bg-slate-200 text-slate-700';

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">오늘의 시장 지도</h1>
        <p className="mt-1 text-sm text-slate-600">
          KOSPI · KOSDAQ의 60일선 흐름과 최근 리포트를 한 화면에서 관찰합니다. 관찰·보조용 표시입니다.
        </p>
      </header>

      <section className="mb-6 rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-800">시장 흐름 요약</h2>
          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${stateCls}`}>
            전체 흐름: {marketState}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {kospi && <IndexCard info={kospi} />}
          {kosdaq && <IndexCard info={kosdaq} />}
          {!kospi && !kosdaq && (
            <p className="col-span-2 text-sm text-slate-500">시장 지수 데이터가 충분하지 않습니다.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          강세 흐름: 두 지수 모두 60일선 위 / 중립 흐름: 하나만 / 약세 흐름: 둘 다 60일선 아래.
        </p>
      </section>

      <section className="rounded-md border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-slate-800">최근 리포트 바로가기</h2>
        <ul className="space-y-2 text-sm">
          <li>
            {latestDaily ? (
              <Link href={`/reports/${(latestDaily as any).id}`} className="text-blue-600 hover:underline">
                ▶ 가장 최근 일일 리포트 ({(latestDaily as any).base_date})
              </Link>
            ) : (
              <span className="text-slate-500">일일 리포트가 없습니다.</span>
            )}
          </li>
          <li>
            {latestWeekly ? (
              <Link href={`/reports/${(latestWeekly as any).id}`} className="text-blue-600 hover:underline">
                ▶ 가장 최근 주간 리포트 ({(latestWeekly as any).base_date})
              </Link>
            ) : (
              <span className="text-slate-500">주간 리포트가 없습니다.</span>
            )}
          </li>
          <li>
            <Link href="/history" className="text-blue-600 hover:underline">📅 과거 리포트 전체 보기</Link>
          </li>
          <li>
            <Link href="/opportunities" className="text-blue-600 hover:underline">🎯 오늘의 기회 포착판</Link>
          </li>
        </ul>
      </section>

      <p className="mt-6 text-xs text-slate-500">
        이 화면은 시장의 상대적 위치를 관찰하기 위한 보조 표시입니다. 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다.
      </p>
    </main>
  );
}

function IndexCard({ info }: { info: IndexInfo }) {
  const changeColor =
    info.change_pct == null ? 'text-slate-500' :
    info.change_pct > 0 ? 'text-red-600' :
    info.change_pct < 0 ? 'text-blue-600' :
                          'text-slate-500';
  const ma60Cls = info.above_ma60 ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800';
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-800">{info.name}</span>
        <span className={`inline-flex rounded px-2 py-0.5 text-xs ${ma60Cls}`}>
          60일선 {info.above_ma60 ? '위' : '아래'}
        </span>
      </div>
      <div className="mt-2 text-sm tabular-nums text-slate-700">
        종가 {info.close.toLocaleString()}
        {info.change_pct != null && (
          <span className={`ml-2 ${changeColor}`}>
            {info.change_pct > 0 ? '+' : ''}{info.change_pct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-xs tabular-nums text-slate-500">
        60일선 추정 {Math.round(info.ma60).toLocaleString()} · 기준일 {info.date}
      </div>
    </div>
  );
}
