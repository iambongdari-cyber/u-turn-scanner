import Link from 'next/link';
import { readFile } from 'fs/promises';
import path from 'path';
import { getClassificationDisplay } from '@/app/_lib/sidecar';

export const dynamic = 'force-dynamic';

interface SectorMember {
  ticker: string;
  name: string;
  label: string;
  return_20d: number | null;
  value_20d_eok: number | null;
  near_high_pct: number | null;
  disparity_pct: number | null;
  above_ma60: boolean | null;
  evidence?: string[];
}

interface SectorBlock {
  sector: string;
  n_stocks: number;
  sector_20d_return: number;
  market_relative_strength: number;
  leaders: SectorMember[];
  followers: SectorMember[];
  opportunities: SectorMember[];
  chase_risk: SectorMember[];
  holders_response_count?: number;
  insufficient_count?: number;
}

interface DumpData {
  generated_at?: string;
  market_flow?: string;
  kospi_20d_return?: number | null;
  kosdaq_20d_return?: number | null;
  market_avg_20d_return?: number | null;
  params?: Record<string, unknown>;
  sectors_strong?: SectorBlock[];
  sectors_weak?: SectorBlock[];
  summary?: {
    n_sectors_considered?: number;
    n_sectors_strong?: number;
    n_sectors_weak?: number;
    n_stocks_with_metrics?: number;
  };
}

type LoadResult =
  | { status: 'ok'; data: DumpData }
  | { status: 'missing' }
  | { status: 'parse_error'; message: string };

async function loadDump(): Promise<LoadResult> {
  const filePath = path.join(process.cwd(), 'logs', 'sidecar', 'sector_dump_latest.json');
  let buf: string;
  try {
    buf = await readFile(filePath, 'utf-8');
  } catch {
    return { status: 'missing' };
  }
  try {
    const data = JSON.parse(buf) as DumpData;
    return { status: 'ok', data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { status: 'parse_error', message };
  }
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null) return '-';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtPctPlain(n: number | null | undefined, digits = 1): string {
  if (n == null) return '-';
  return `${Number(n).toFixed(digits)}%`;
}

function fmtEok(n: number | null | undefined): string {
  if (n == null) return '-';
  return `${Number(n).toFixed(1)}억`;
}

const LABEL_META: Record<string, { icon: string; cls: string }> = {
  '진짜 주도주 후보': { icon: '🥇', cls: 'bg-amber-100 text-amber-900' },
  '후발주 관찰': { icon: '🥈', cls: 'bg-sky-100 text-sky-800' },
  '기회 후보': { icon: '🎯', cls: 'bg-emerald-100 text-emerald-800' },
  '추격 위험': { icon: '⚠️', cls: 'bg-orange-100 text-orange-800' },
};

const SECTION_DESC: Record<string, string> = {
  '진짜 주도주 후보': '같은 섹터 안에서 60일선 위 + 전고점 근접 + 거래대금 임계 충족 + 이격 한계 내 종목',
  '후발주 관찰': '같은 섹터 강세에서 위를 따라가는 종목(전고점 70~90% 부근)',
  '기회 후보': '60일선 위에서 거래대금 임계는 충족하지만 주도주·후발주 기준에는 미달',
  '추격 위험': '이격 +20% 이상 — 추가 진입은 추격 위험 영역',
};

export default async function LeadersPage() {
  const r = await loadDump();

  if (r.status === 'missing') {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <header className="mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">주도주·후발주</h1>
          <p className="mt-1 text-sm text-slate-600">
            강한 섹터 안에서 진짜 주도주 후보와 후발주 관찰 종목을 구분합니다. 관찰·복기 보조용이며 매매 권유가 아닙니다.
          </p>
        </header>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-6 text-amber-900">
          아직 주도주·후발주 데이터가 없습니다. 먼저 <code className="rounded bg-amber-100 px-1">scripts/sector_dump.py</code>를 실행해 사이드카 JSON을 생성해 주세요.
        </div>
      </main>
    );
  }

  if (r.status === 'parse_error') {
    return (
      <main className="container mx-auto max-w-5xl p-6 sm:p-8">
        <header className="mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-800">주도주·후발주</h1>
        </header>
        <div className="rounded-md border border-red-300 bg-red-50 p-6 text-red-900">
          주도주·후발주 데이터를 읽는 중 문제가 발생했습니다. <code className="rounded bg-red-100 px-1">sector_dump_latest.json</code> 파일을 다시 생성해 주세요.
        </div>
      </main>
    );
  }

  const d = r.data;
  const strong: SectorBlock[] = d.sectors_strong ?? [];
  const weak: SectorBlock[] = d.sectors_weak ?? [];
  const summary = d.summary ?? {};

  // 전체 섹터(강+약) 합산 4분류 통합 카운트 — 상단 요약용
  const allBlocks = [...strong, ...weak];
  const totals = {
    leaders: allBlocks.reduce((s, b) => s + (b.leaders?.length ?? 0), 0),
    followers: allBlocks.reduce((s, b) => s + (b.followers?.length ?? 0), 0),
    opportunities: allBlocks.reduce((s, b) => s + (b.opportunities?.length ?? 0), 0),
    chase_risk: allBlocks.reduce((s, b) => s + (b.chase_risk?.length ?? 0), 0),
  };

  const flow = d.market_flow ?? '중립 흐름';
  const flowCls =
    flow === '강세 흐름' ? 'bg-green-100 text-green-800' :
    flow === '약세 흐름' ? 'bg-red-100 text-red-800' :
                            'bg-slate-200 text-slate-700';

  return (
    <main className="container mx-auto max-w-5xl p-6 sm:p-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-800">주도주·후발주</h1>
        <p className="mt-1 text-sm text-slate-600">
          강한 섹터 안에서 진짜 주도주 후보와 후발주 관찰 종목을 구분합니다. 관찰·복기 보조용이며 매매 권유가 아닙니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            시장 흐름 <span className={`rounded px-2 py-0.5 ${flowCls}`}>{flow}</span>
          </span>
          {d.kospi_20d_return != null && <span>KOSPI 20일 {fmtPct(d.kospi_20d_return)}</span>}
          {d.kosdaq_20d_return != null && <span>KOSDAQ 20일 {fmtPct(d.kosdaq_20d_return)}</span>}
          {d.market_avg_20d_return != null && <span>시장 평균 {fmtPct(d.market_avg_20d_return)}</span>}
          {d.generated_at && <span>생성 {d.generated_at}</span>}
        </div>
      </header>

      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        🥇 <strong>진짜 주도주 후보</strong>는 돈의 흐름과 가격 위치를 함께 본 분류입니다.
        <strong> 매수 권유가 아니며</strong>, 가격 진입 여부는 사용자 본인이 <strong>추격 위험</strong>과 함께 판단해야 합니다.
        기본 노출은 거래대금·전고점 근접도·상대강도 기준 상위 종목 위주이며, 나머지는 "더 보기"로 펼치세요.
      </div>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard label="강한 섹터" value={summary.n_sectors_strong ?? strong.length} />
        <SummaryCard label="약한 섹터" value={summary.n_sectors_weak ?? weak.length} />
        <SummaryCard label="전체 산출 종목" value={summary.n_stocks_with_metrics ?? 0} />
        <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">시장 흐름</div>
          <div className="mt-1">
            <span className={`inline-flex rounded px-2 py-0.5 text-sm ${flowCls}`}>{flow}</span>
          </div>
        </div>
      </section>

      {/* v0.3-3: 4분류 통합 요약 — 추격 위험은 경고 톤으로 강조 */}
      <section className="mb-6 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-xs font-medium text-slate-600">
          전 섹터 합산 라벨 요약
          <span className="ml-1 text-[11px] font-normal text-slate-400">— 관찰·복기 보조용 카운트이며 매매 권유가 아닙니다</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TotalCountCard
            label="진짜 주도주 후보"
            value={totals.leaders}
            cls="bg-amber-100 text-amber-900"
            icon="🥇"
            hint={getClassificationDisplay('진짜 주도주 후보').short}
          />
          <TotalCountCard
            label="후발주 관찰"
            value={totals.followers}
            cls="bg-sky-100 text-sky-800"
            icon="🥈"
            hint={getClassificationDisplay('후발주 관찰').short}
          />
          <TotalCountCard
            label="기회 후보"
            value={totals.opportunities}
            cls="bg-emerald-100 text-emerald-800"
            icon="🎯"
            hint={getClassificationDisplay('기회 후보').short}
          />
          <TotalCountCard
            label="추격 위험"
            value={totals.chase_risk}
            cls="bg-orange-100 text-orange-900 ring-2 ring-orange-300"
            icon="⚠️"
            hint="신규 진입 위험 — 매수/매도 지시 아님"
            warn
          />
        </div>
        {totals.chase_risk > 0 && (
          <p className="mt-2 rounded border border-orange-200 bg-orange-50 p-2 text-[11px] text-orange-900">
            ⚠️ <strong>추격 위험 {totals.chase_risk}개</strong> 종목이 표시되어 있습니다.
            이격이 +20% 이상 벌어진 영역으로, <strong>신규 진입 시 추격 위험이 큽니다</strong>.
            이는 <strong>매수/매도 지시가 아닌 경고 라벨</strong>이며, 보유 중일 때의 대응은 본인의 원칙을 따르세요.
          </p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-slate-800">
          강한 섹터 <span className="ml-2 text-xs text-slate-500">{strong.length}개</span>
        </h2>
        {strong.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            오늘 강한 섹터로 분류된 항목이 없습니다.
          </div>
        ) : (
          <ul className="space-y-4">
            {strong.map((s) => <SectorCard key={s.sector} block={s} />)}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <details className="rounded border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm text-slate-700">
            약한 섹터 보조 보기
            <span className="ml-2 text-xs text-slate-500">{weak.length}개 — 조건 부족 / 보유자 대응 참고용</span>
          </summary>
          {weak.length === 0 ? (
            <div className="mt-3 text-xs text-slate-500">약한 섹터로 분류된 항목이 없습니다.</div>
          ) : (
            <ul className="mt-3 space-y-3">
              {weak.map((s) => (
                <li key={s.sector} className="rounded border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-700">{s.sector}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      섹터 20일 {fmtPct(s.sector_20d_return)} ·
                      상대강도 {fmtPct(s.market_relative_strength)} ·
                      종목 {s.n_stocks}개
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    조건 부족 {s.insufficient_count ?? 0} · 보유자 대응 {s.holders_response_count ?? 0}
                    {s.chase_risk?.length > 0 && <> · 추격 위험 {s.chase_risk.length}</>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>

      <div className="mt-6 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          본 화면은 "오늘 살 종목"을 추천하는 화면이 아닙니다.
          <strong> 강한 섹터 안에서 돈의 흐름을 확인하고, 주도주와 후발주를 구분</strong>하기 위한 <strong>관찰·복기 보조</strong> 화면입니다.
        </p>
        <p className="mt-1 text-slate-500">
          어떤 표시도 매매 권유가 아니며, 최종 판단은 사용자 본인이 합니다.
        </p>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function TotalCountCard({
  label, value, cls, icon, hint, warn,
}: { label: string; value: number; cls: string; icon: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`rounded border p-2 ${warn ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
          <span>{icon}</span>
          {label}
        </span>
        <span className={`text-lg font-semibold tabular-nums ${warn ? 'text-orange-900' : 'text-slate-800'}`}>{value}</span>
      </div>
      {hint && (
        <div className={`mt-1 text-[11px] ${warn ? 'text-orange-700' : 'text-slate-500'}`}>{hint}</div>
      )}
    </div>
  );
}

function SectorCard({ block }: { block: SectorBlock }) {
  const sections: Array<{ key: keyof Pick<SectorBlock, 'leaders' | 'followers' | 'opportunities' | 'chase_risk'>; label: string }> = [
    { key: 'leaders', label: '진짜 주도주 후보' },
    { key: 'followers', label: '후발주 관찰' },
    { key: 'opportunities', label: '기회 후보' },
    { key: 'chase_risk', label: '추격 위험' },
  ];

  const counts = {
    leaders: block.leaders?.length ?? 0,
    followers: block.followers?.length ?? 0,
    opportunities: block.opportunities?.length ?? 0,
    chase_risk: block.chase_risk?.length ?? 0,
  };

  return (
    <li className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="inline text-lg font-semibold text-slate-800">{block.sector}</h3>
          <span className="ml-2 text-xs text-slate-500">종목 {block.n_stocks}개</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs tabular-nums">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
            섹터 20일 {fmtPct(block.sector_20d_return)}
          </span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-indigo-800">
            시장 대비 {fmtPct(block.market_relative_strength)}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">🥇 진짜 주도주 후보 {counts.leaders}</span>
        <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-800">🥈 후발주 관찰 {counts.followers}</span>
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">🎯 기회 후보 {counts.opportunities}</span>
        <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-800">⚠️ 추격 위험 {counts.chase_risk}</span>
        {block.holders_response_count != null && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">보유자 대응 {block.holders_response_count}</span>
        )}
        {block.insufficient_count != null && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">조건 부족 {block.insufficient_count}</span>
        )}
      </div>

      <div className="space-y-3">
        {sections.map(({ key, label }) => (
          <SubSection
            key={key}
            label={label}
            items={(block[key] as SectorMember[] | undefined) ?? []}
          />
        ))}
      </div>
    </li>
  );
}

const SECTOR_MEMBER_LIMIT = 5;

function SubSection({ label, items }: { label: string; items: SectorMember[] }) {
  const meta = LABEL_META[label] ?? { icon: '·', cls: 'bg-slate-100 text-slate-700' };
  const desc = SECTION_DESC[label] ?? '';
  const head = items.slice(0, SECTOR_MEMBER_LIMIT);
  const rest = items.slice(SECTOR_MEMBER_LIMIT);
  const display = getClassificationDisplay(label);
  const isChaseRisk = label === '추격 위험';
  const wrapCls = isChaseRisk && items.length > 0
    ? 'rounded border border-orange-200 bg-orange-50 p-2'
    : '';
  return (
    <section className={wrapCls}>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span
          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${meta.cls} ${isChaseRisk && items.length > 0 ? 'ring-1 ring-orange-300' : ''}`}
        >
          {meta.icon} {label}
        </span>
        <span className="text-xs text-slate-500">{items.length}개</span>
        {display.short && (
          <span className={`text-[11px] ${isChaseRisk ? 'text-orange-700' : 'text-slate-500'}`}>
            — {display.short}
          </span>
        )}
      </div>
      {desc && <p className="mb-1 text-xs text-slate-500">{desc}</p>}
      {isChaseRisk && items.length > 0 && (
        <p className="mb-1 text-[11px] font-medium text-orange-800">
          ⚠️ 이 영역의 신규 진입은 추격 위험이 큽니다. 매수/매도 지시가 아닌 경고 라벨입니다.
        </p>
      )}
      {items.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
          이 분류에 해당하는 종목이 없습니다.
        </div>
      ) : (
        <>
          <ul className="space-y-1.5">
            {head.map((m) => <MemberRow key={m.ticker} m={m} />)}
          </ul>
          {rest.length > 0 && (
            <details className="mt-1.5">
              <summary className="inline-flex cursor-pointer items-center rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">
                나머지 {rest.length}개 더 보기
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {rest.map((m) => <MemberRow key={m.ticker} m={m} />)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function MemberRow({ m }: { m: SectorMember }) {
  return (
    <li className="rounded border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/stocks/${m.ticker}`} className="font-medium text-slate-800 hover:underline">
          {m.name}
          <span className="ml-2 text-xs text-slate-400">{m.ticker}</span>
        </Link>
        <div className="flex flex-wrap gap-1 text-xs tabular-nums">
          {m.return_20d != null && (
            <span className="rounded bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">
              20일 {fmtPct(m.return_20d, 1)}
            </span>
          )}
          {m.near_high_pct != null && (
            <span className="rounded bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">
              전고점 {fmtPctPlain(m.near_high_pct)}
            </span>
          )}
          {m.value_20d_eok != null && (
            <span className="rounded bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">
              평균 거래대금 {fmtEok(m.value_20d_eok)}
            </span>
          )}
          {m.disparity_pct != null && (
            <span className="rounded bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">
              이격 {fmtPct(m.disparity_pct, 1)}
            </span>
          )}
          {m.above_ma60 != null && (
            <span className={`rounded px-2 py-0.5 ${
              m.above_ma60 ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
            }`}>
              60일선 {m.above_ma60 ? '위' : '아래'}
            </span>
          )}
        </div>
      </div>

      {m.evidence && m.evidence.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.evidence.map((ev, i) => (
            <span key={i} className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
              {ev}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1 text-right">
        <Link href={`/stocks/${m.ticker}`} className="text-[11px] text-blue-600 hover:underline">
          종목 상세 →
        </Link>
      </div>
    </li>
  );
}
