import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SearchForm from './_components/SearchForm';
import { getSidecarFileStatuses, summarizeSidecarFreshness, type SidecarFileStatus, type SidecarFreshness } from '@/app/_lib/sidecar';

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

  // v0.3-4: 사이드카 파일 최신 상태 (홈 상단 안내 박스용)
  const { scan: scanStatus, sector: sectorStatus } = await getSidecarFileStatuses();
  const freshness = summarizeSidecarFreshness(scanStatus, sectorStatus);

  return (
    <main className="container mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-800">U턴 스캐너</h1>
        <p className="mt-1 text-sm text-slate-600">
          국내주식 U턴 종목 자동 스캐너 · 분석 보조 도구
        </p>
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          오늘은 시장 흐름을 먼저 보고, 바닥 U턴 후보와 주도주·후발주를 나눠 확인한 뒤, 키움 참고표와 매매일지로 정리합니다.
        </p>
      </header>

      <SidecarFreshnessBox freshness={freshness} />

      <SearchForm defaultDate={latestDaily?.base_date} />

      <div className="mt-6 space-y-4">
        <FlowSection title="1) 오늘 시작" desc="아침에 시장 흐름과 오늘의 후보 등급을 먼저 본다.">
          <FlowLink href="/market" emoji="🗺" label="오늘의 시장 지도" />
          <FlowLink href="/opportunities" emoji="🎯" label="오늘의 기회 포착판" />
        </FlowSection>

        <FlowSection title="2) 후보 점검" desc="바닥 U턴 후보와 주도주·후발주를 나눠 본다.">
          <FlowLink href="/bottom-watch" emoji="🌱" label="바닥 U턴 후보" />
          <FlowLink href="/leaders" emoji="🏆" label="주도주·후발주" />
        </FlowSection>

        <FlowSection title="3) 입력 참고" desc="키움 자동감시주문에 직접 입력하기 전 참고용 표.">
          <FlowLink href="/kiwoom-helper" emoji="📋" label="키움 자동감시 참고표" />
        </FlowSection>

        <FlowSection title="4) 복기" desc="관찰·복기 보조용 일지 초안.">
          <FlowLink href="/journal" emoji="📝" label="매매일지 초안" />
        </FlowSection>

        <FlowSection title="5) 기존 기능" desc="리포트 · 백테스트 · 알림 · 과거 자료.">
          {latestDaily ? (
            <FlowLink
              href={`/reports/${latestDaily.id}`}
              emoji="▶"
              label={`가장 최근 일일 리포트 (${latestDaily.base_date})`}
            />
          ) : (
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">
              아직 일일 리포트가 없습니다.
            </span>
          )}
          <FlowLink href="/history" emoji="📅" label="과거 리포트 전체 보기" />
          <FlowLink href="/backtest" emoji="📊" label="백테스트 결과" />
          <AlertLink unreadCount={unreadCount} />
        </FlowSection>
      </div>
    </main>
  );
}

function FlowSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-slate-500">{desc}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function FlowLink({
  href,
  emoji,
  label,
}: {
  href: string;
  emoji: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </Link>
  );
}

function AlertLink({ unreadCount }: { unreadCount: number | null | undefined }) {
  return (
    <Link
      href="/alerts"
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    >
      <span aria-hidden>🔔</span>
      <span>알림</span>
      {unreadCount != null && unreadCount > 0 && (
        <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

// v0.3-4: 사이드카 최신 상태 안내 박스
function SidecarFreshnessBox({ freshness }: { freshness: SidecarFreshness }) {
  const { bannerLevel, headline, detail, scan, sector, needsRerun } = freshness;
  const wrapCls =
    bannerLevel === 'error'
      ? 'border-red-300 bg-red-50'
      : bannerLevel === 'warn'
      ? 'border-amber-300 bg-amber-50'
      : 'border-emerald-200 bg-emerald-50';
  const headCls =
    bannerLevel === 'error'
      ? 'text-red-900'
      : bannerLevel === 'warn'
      ? 'text-amber-900'
      : 'text-emerald-900';
  const iconText = bannerLevel === 'error' ? '❌' : bannerLevel === 'warn' ? '⚠️' : '✅';

  return (
    <section className={`mb-4 rounded-md border p-3 shadow-sm ${wrapCls}`}>
      <div className={`flex flex-wrap items-baseline gap-2 ${headCls}`}>
        <span className="text-sm font-semibold">
          {iconText} 사이드카 최신 상태
        </span>
        <span className="text-xs font-normal">— {headline}</span>
      </div>
      <p className={`mt-1 text-[11px] ${headCls.replace('900', '800')}`}>
        {detail}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SidecarStatusRow s={scan} />
        <SidecarStatusRow s={sector} />
      </div>
      {needsRerun && (
        <p className={`mt-2 rounded border px-2 py-1 text-[11px] ${
          bannerLevel === 'error'
            ? 'border-red-200 bg-white text-red-800'
            : 'border-amber-200 bg-white text-amber-800'
        }`}>
          👉 <strong>run_daily.bat</strong> 재실행 후 다시 확인하세요. (사이드카 단독 재생성은 <strong>run_sidecar.bat</strong>도 가능)
        </p>
      )}
      <p className={`mt-1 text-[10px] ${headCls.replace('900', '700')}`}>
        이 박스는 분석 결과가 아니라 데이터 최신성 확인용입니다.
      </p>
    </section>
  );
}

function SidecarStatusRow({ s }: { s: SidecarFileStatus }) {
  const kindLabel = s.kind === 'scan' ? '바닥 후보 사이드카' : '섹터 사이드카';
  const tone =
    s.status === 'ok'
      ? 'border-emerald-200 bg-white text-emerald-900'
      : s.status === 'stale'
      ? 'border-amber-200 bg-white text-amber-900'
      : 'border-red-200 bg-white text-red-900';
  const badge =
    s.status === 'ok'
      ? { text: '오늘 최신', cls: 'bg-emerald-100 text-emerald-800' }
      : s.status === 'stale'
      ? { text: '오래된 파일', cls: 'bg-amber-100 text-amber-800' }
      : s.status === 'error'
      ? { text: '읽기 실패', cls: 'bg-red-100 text-red-800' }
      : { text: '파일 없음', cls: 'bg-red-100 text-red-800' };
  return (
    <div className={`rounded border p-2 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span className="font-medium">{kindLabel}</span>
        <span className={`inline-flex rounded px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="mt-0.5 text-slate-600">
        <code className="rounded bg-slate-100 px-1 text-[10px] text-slate-700">{s.pathLabel}</code>
      </div>
      {s.modifiedAtIso && (
        <div className="mt-0.5 text-slate-600">생성 {s.modifiedAtIso}{s.ageHours != null && <> · {s.ageHours}시간 경과</>}</div>
      )}
      {(s.status === 'missing' || s.status === 'error' || s.status === 'stale') && (
        <div className="mt-1 text-slate-700">{s.message}</div>
      )}
    </div>
  );
}
