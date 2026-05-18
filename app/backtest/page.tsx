import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type BTRow = {
  report_id: string;
  ticker: string;
  base_date: string;
  entry_date: string | null;
  entry_price: number | null;
  strategy_exit_date: string | null;
  strategy_exit_price: number | null;
  strategy_exit_reason: string | null;
  strategy_holding_days: number | null;
  strategy_return_pct: number | null;
  buyhold_return_pct: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
  stop_loss: number | null;
  target_price: number | null;
  is_open: boolean;
  reports: { report_type: string } | null;
  stocks: { name: string; market: string; sector: string | null } | null;
  // augmented
  score: number | null;
  final_grade: string | null;
};

const FEE_PCT = 0.5;

export default async function BacktestPage() {
  // backtest_results + reports + stocks
  const { data: btData, error: btErr } = await supabase
    .from('backtest_results')
    .select(
      `report_id, ticker, base_date,
       entry_date, entry_price,
       strategy_exit_date, strategy_exit_price, strategy_exit_reason,
       strategy_holding_days, strategy_return_pct,
       buyhold_return_pct, max_gain_pct, max_drawdown_pct,
       stop_loss, target_price, is_open,
       reports ( report_type ),
       stocks ( name, market, sector )`
    )
    .order('base_date', { ascending: false })
    .range(0, 9999);

  if (btErr) {
    return (
      <main className="container mx-auto max-w-5xl p-8">
        <p className="text-red-600">DB 조회 오류: {btErr.message}</p>
      </main>
    );
  }

  const baseRows = (btData ?? []) as any[];

  if (baseRows.length === 0) {
    return (
      <main className="container mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-bold text-slate-800">백테스트 결과</h1>
        <p className="mt-4 text-slate-600">
          백테스트 데이터가 없습니다. 먼저{' '}
          <code className="rounded bg-slate-100 px-1 text-sm">python scripts/run_backtest.py</code>{' '}
          실행 후 다시 와주세요.
        </p>
      </main>
    );
  }

  // scan_results에서 score, final_grade 가져와서 매핑 (composite key 조인 대용)
  const reportIds = Array.from(new Set(baseRows.map((r) => r.report_id)));
  const scanMap = new Map<string, { score: number; final_grade: string }>();

  // PostgREST IN 쿼리 URL 길이 제한 → 청크 처리
  const CHUNK = 50;
  for (let i = 0; i < reportIds.length; i += CHUNK) {
    const chunk = reportIds.slice(i, i + CHUNK);
    const { data: scans } = await supabase
      .from('scan_results')
      .select('report_id, ticker, score, final_grade')
      .in('report_id', chunk)
      .range(0, 9999);
    for (const s of scans ?? []) {
      scanMap.set(`${s.report_id}|${s.ticker}`, {
        score: s.score,
        final_grade: s.final_grade,
      });
    }
  }

  const rows: BTRow[] = baseRows.map((r) => {
    const sc = scanMap.get(`${r.report_id}|${r.ticker}`);
    return {
      ...r,
      score: sc?.score ?? null,
      final_grade: sc?.final_grade ?? null,
    } as BTRow;
  });

  // ── 통계 계산 ──
  const closed = rows.filter(
    (r) => !r.is_open && r.strategy_return_pct != null && r.buyhold_return_pct != null,
  );
  const open = rows.filter((r) => r.is_open);

  const meanStrategy = closed.length ? avg(closed.map((r) => r.strategy_return_pct!)) : null;
  const medianStrategy = closed.length ? median(closed.map((r) => r.strategy_return_pct!)) : null;
  const winsStrategy = closed.filter((r) => r.strategy_return_pct! > 0).length;
  const winRateStrategy = closed.length ? (winsStrategy / closed.length) * 100 : null;

  const meanBuyhold = closed.length ? avg(closed.map((r) => r.buyhold_return_pct!)) : null;
  const medianBuyhold = closed.length ? median(closed.map((r) => r.buyhold_return_pct!)) : null;
  const winsBuyhold = closed.filter((r) => r.buyhold_return_pct! > 0).length;
  const winRateBuyhold = closed.length ? (winsBuyhold / closed.length) * 100 : null;

  const meanOpenStrategy = open.length
    ? avg(open.filter((r) => r.strategy_return_pct != null).map((r) => r.strategy_return_pct!))
    : null;

  // 청산 사유
  const reasonCounts: Record<string, number> = {};
  for (const r of closed) {
    const key = r.strategy_exit_reason ?? 'UNKNOWN';
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  // 점수 구간별 (closed)
  const scoreBuckets = [
    { label: '90점 이상', min: 90, max: 999 },
    { label: '80-89점', min: 80, max: 90 },
    { label: '70-79점', min: 70, max: 80 },
    { label: '60-69점', min: 60, max: 70 },
    { label: '60점 미만', min: 0, max: 60 },
  ];
  const scoreStats = scoreBuckets.map((b) => {
    const subset = closed.filter(
      (r) => r.score != null && r.score >= b.min && r.score < b.max,
    );
    return {
      label: b.label,
      count: subset.length,
      meanStrategy: subset.length ? avg(subset.map((r) => r.strategy_return_pct!)) : null,
      meanBuyhold: subset.length ? avg(subset.map((r) => r.buyhold_return_pct!)) : null,
      winRate: subset.length
        ? (subset.filter((r) => r.strategy_return_pct! > 0).length / subset.length) * 100
        : null,
    };
  });

  // 판정별
  const grades = ['A', 'B', 'WATCH', 'CHASE_RISK'];
  const gradeStats = grades.map((g) => {
    const subset = closed.filter((r) => r.final_grade === g);
    return {
      grade: g,
      count: subset.length,
      meanStrategy: subset.length ? avg(subset.map((r) => r.strategy_return_pct!)) : null,
      meanBuyhold: subset.length ? avg(subset.map((r) => r.buyhold_return_pct!)) : null,
      winRate: subset.length
        ? (subset.filter((r) => r.strategy_return_pct! > 0).length / subset.length) * 100
        : null,
    };
  });

  // 시장별
  const marketStats = ['KOSPI', 'KOSDAQ'].map((m) => {
    const subset = closed.filter((r) => r.stocks?.market === m);
    return {
      market: m,
      count: subset.length,
      meanStrategy: subset.length ? avg(subset.map((r) => r.strategy_return_pct!)) : null,
      meanBuyhold: subset.length ? avg(subset.map((r) => r.buyhold_return_pct!)) : null,
    };
  });

  // 종목별 평균 (3건 이상)
  const tickerAgg = new Map<
    string,
    { count: number; sumStrategy: number; sumBuyhold: number; name: string }
  >();
  for (const r of closed) {
    const cur = tickerAgg.get(r.ticker) ?? {
      count: 0,
      sumStrategy: 0,
      sumBuyhold: 0,
      name: r.stocks?.name ?? '',
    };
    cur.count++;
    cur.sumStrategy += r.strategy_return_pct!;
    cur.sumBuyhold += r.buyhold_return_pct!;
    tickerAgg.set(r.ticker, cur);
  }
  const topTickers = Array.from(tickerAgg.entries())
    .map(([t, s]) => ({
      ticker: t,
      name: s.name,
      count: s.count,
      meanStrategy: s.sumStrategy / s.count,
      meanBuyhold: s.sumBuyhold / s.count,
    }))
    .filter((t) => t.count >= 3)
    .sort((a, b) => b.meanBuyhold - a.meanBuyhold)
    .slice(0, 15);

  // 기간
  const baseDates = rows.map((r) => r.base_date).sort();
  const periodFrom = baseDates[0];
  const periodTo = baseDates[baseDates.length - 1];

  return (
    <main className="container mx-auto max-w-6xl p-6">
      <div className="mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-slate-800">백테스트 결과</h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 홈
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          기간 {periodFrom} ~ {periodTo} · 청산 {closed.length}건 · 보유 중 {open.length}건
        </p>
      </div>

      {/* 핵심 요약 카드 */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          title="전략 시뮬 (손절/목표)"
          mean={meanStrategy}
          median={medianStrategy}
          subtitle={
            winRateStrategy != null
              ? `승률 ${winRateStrategy.toFixed(1)}% (${winsStrategy}/${closed.length})`
              : '-'
          }
          netHint={meanStrategy != null ? `net ${formatPct(meanStrategy - FEE_PCT)}` : null}
        />
        <SummaryCard
          title="단순 60일 보유"
          mean={meanBuyhold}
          median={medianBuyhold}
          subtitle={
            winRateBuyhold != null
              ? `승률 ${winRateBuyhold.toFixed(1)}% (${winsBuyhold}/${closed.length})`
              : '-'
          }
          netHint={meanBuyhold != null ? `net ${formatPct(meanBuyhold - FEE_PCT)}` : null}
        />
        <SummaryCard
          title="보유 중 (60일 미만)"
          mean={meanOpenStrategy}
          median={null}
          subtitle={`${open.length}건 현재 평가손익`}
          netHint={null}
        />
      </div>

      {/* 청산 사유 */}
      <Section title="청산 사유 분포">
        <ReasonBars reasonCounts={reasonCounts} total={closed.length} />
      </Section>

      {/* 점수 구간별 */}
      <Section title="점수 구간별 (청산 표본)">
        <StatTable
          headers={['점수', '표본', '전략 평균', '보유 평균', '승률']}
          rows={scoreStats.map((s) => [
            s.label,
            `${s.count}건`,
            s.meanStrategy != null ? <Pct v={s.meanStrategy} /> : '-',
            s.meanBuyhold != null ? <Pct v={s.meanBuyhold} /> : '-',
            s.winRate != null ? `${s.winRate.toFixed(1)}%` : '-',
          ])}
        />
        <p className="mt-2 text-xs text-slate-500">
          ※ 점수가 높을수록 평균 수익률이 높아야 점수 시스템이 변별력이 있는 것입니다.
        </p>
      </Section>

      {/* 판정별 */}
      <Section title="판정별 (청산 표본)">
        <StatTable
          headers={['판정', '표본', '전략 평균', '보유 평균', '승률']}
          rows={gradeStats.map((s) => [
            translateGrade(s.grade),
            `${s.count}건`,
            s.meanStrategy != null ? <Pct v={s.meanStrategy} /> : '-',
            s.meanBuyhold != null ? <Pct v={s.meanBuyhold} /> : '-',
            s.winRate != null ? `${s.winRate.toFixed(1)}%` : '-',
          ])}
        />
      </Section>

      {/* 시장별 */}
      <Section title="시장별">
        <StatTable
          headers={['시장', '표본', '전략 평균', '보유 평균']}
          rows={marketStats.map((s) => [
            s.market,
            `${s.count}건`,
            s.meanStrategy != null ? <Pct v={s.meanStrategy} /> : '-',
            s.meanBuyhold != null ? <Pct v={s.meanBuyhold} /> : '-',
          ])}
        />
      </Section>

      {/* 종목별 (단순 보유 기준 상위) */}
      <Section title={`자주 추천된 종목 (3회 이상, 단순 보유 수익률 상위 ${topTickers.length}개)`}>
        <StatTable
          headers={['종목', '코드', '추천수', '전략 평균', '보유 평균']}
          rows={topTickers.map((t) => [
            <Link
              key={`${t.ticker}-name`}
              href={`/stocks/${t.ticker}`}
              className="text-blue-600 hover:underline"
            >
              {t.name}
            </Link>,
            t.ticker,
            `${t.count}회`,
            <Pct key={`${t.ticker}-s`} v={t.meanStrategy} />,
            <Pct key={`${t.ticker}-b`} v={t.meanBuyhold} />,
          ])}
        />
      </Section>

      {/* 상세 표 */}
      <Section title={`최근 청산/보유 50건`}>
        <DetailTable rows={rows.slice(0, 50)} />
      </Section>

      <div className="mt-8 rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="font-semibold text-slate-700">백테스트 가정</p>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">
          <li>진입: 리포트 base_date 다음 거래일 시가</li>
          <li>전략 시뮬: 매일 저가 ≤ 손절가 → STOP / 고가 ≥ 목표가 → TARGET / 60거래일 도달 → TIMEOUT</li>
          <li>단순 60일 보유: 진입 60거래일 후 종가 청산</li>
          <li>수수료 차감(0.5%) 은 카드 net 표기에만 반영. 표의 수익률은 gross.</li>
          <li>OPEN: 아직 60거래일 미만이라 평가 진행 중. 매일 자동 갱신.</li>
        </ul>
      </div>
    </main>
  );
}

// ── 유틸 ────────────────────────────────────────────────────────
function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function formatPct(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function translateGrade(g: string): string {
  const map: Record<string, string> = {
    A: 'A급',
    B: 'B급',
    WATCH: '관망',
    CHASE_RISK: '추격주의',
    EXCLUDE: '제외',
  };
  return map[g] ?? g;
}

// ── 컴포넌트 ────────────────────────────────────────────────────
// 한국식: 양수=빨강, 음수=파랑
function Pct({ v }: { v: number }) {
  const color = v > 0 ? 'text-red-600' : v < 0 ? 'text-blue-600' : 'text-slate-500';
  return <span className={`tabular-nums ${color}`}>{formatPct(v)}</span>;
}

function SummaryCard({
  title,
  mean,
  median,
  subtitle,
  netHint,
}: {
  title: string;
  mean: number | null;
  median: number | null;
  subtitle: string;
  netHint: string | null;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">
        {mean != null ? <Pct v={mean} /> : '-'}
      </p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      {median != null && (
        <p className="mt-2 text-xs text-slate-500">중앙값 {formatPct(median)}</p>
      )}
      {netHint && <p className="text-xs text-slate-400">{netHint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

function StatTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {headers.map((h, i) => (
              <th
                key={i}
                className={`p-2 ${i === 0 ? 'text-left' : 'text-right'} font-medium text-slate-600`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`p-2 ${ci === 0 ? 'text-left' : 'text-right'} text-slate-700`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReasonBars({
  reasonCounts,
  total,
}: {
  reasonCounts: Record<string, number>;
  total: number;
}) {
  const labels: Record<string, { label: string; color: string }> = {
    TARGET: { label: '목표 익절', color: 'bg-red-500' },
    STOP: { label: '손절', color: 'bg-blue-500' },
    TIMEOUT: { label: '60일 만기', color: 'bg-slate-500' },
  };
  return (
    <div className="space-y-2 rounded border border-slate-200 bg-white p-4">
      {Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          const info = labels[reason] ?? { label: reason, color: 'bg-slate-400' };
          return (
            <div key={reason} className="flex items-center gap-3">
              <span className="w-24 text-sm text-slate-700">{info.label}</span>
              <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
                <div className={`h-full ${info.color}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-28 text-right text-sm tabular-nums text-slate-700">
                {count}건 ({pct.toFixed(1)}%)
              </span>
            </div>
          );
        })}
    </div>
  );
}

function DetailTable({ rows }: { rows: BTRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="p-2 text-left font-medium text-slate-600">기준일</th>
            <th className="p-2 text-left font-medium text-slate-600">종목</th>
            <th className="p-2 text-right font-medium text-slate-600">점수</th>
            <th className="p-2 text-center font-medium text-slate-600">판정</th>
            <th className="p-2 text-right font-medium text-slate-600">진입가</th>
            <th className="p-2 text-right font-medium text-slate-600">청산가</th>
            <th className="p-2 text-center font-medium text-slate-600">사유</th>
            <th className="p-2 text-right font-medium text-slate-600">보유</th>
            <th className="p-2 text-right font-medium text-slate-600">전략</th>
            <th className="p-2 text-right font-medium text-slate-600">단순보유</th>
            <th className="p-2 text-right font-medium text-slate-600">최고</th>
            <th className="p-2 text-right font-medium text-slate-600">최저</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.report_id}|${r.ticker}`}
              className="border-b border-slate-100 last:border-b-0"
            >
              <td className="p-2 text-slate-700">{r.base_date}</td>
              <td className="p-2">
                <Link
                  href={`/stocks/${r.ticker}?reportId=${r.report_id}`}
                  className="text-blue-600 hover:underline"
                >
                  {r.stocks?.name ?? r.ticker}
                </Link>
                <span className="ml-1 text-slate-400">{r.ticker}</span>
              </td>
              <td className="p-2 text-right tabular-nums">
                {r.score != null ? r.score.toFixed(1) : '-'}
              </td>
              <td className="p-2 text-center">{r.final_grade ? translateGrade(r.final_grade) : '-'}</td>
              <td className="p-2 text-right tabular-nums">
                {r.entry_price ? Math.round(Number(r.entry_price)).toLocaleString() : '-'}
              </td>
              <td className="p-2 text-right tabular-nums">
                {r.strategy_exit_price ? Math.round(Number(r.strategy_exit_price)).toLocaleString() : '-'}
              </td>
              <td className="p-2 text-center">
                <ReasonBadge reason={r.strategy_exit_reason} />
              </td>
              <td className="p-2 text-right tabular-nums">{r.strategy_holding_days ?? '-'}일</td>
              <td className="p-2 text-right">
                {r.strategy_return_pct != null ? <Pct v={Number(r.strategy_return_pct)} /> : '-'}
              </td>
              <td className="p-2 text-right">
                {r.buyhold_return_pct != null ? <Pct v={Number(r.buyhold_return_pct)} /> : '-'}
              </td>
              <td className="p-2 text-right">
                {r.max_gain_pct != null ? <Pct v={Number(r.max_gain_pct)} /> : '-'}
              </td>
              <td className="p-2 text-right">
                {r.max_drawdown_pct != null ? <Pct v={Number(r.max_drawdown_pct)} /> : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span>-</span>;
  const styles: Record<string, string> = {
    TARGET: 'bg-red-100 text-red-700',
    STOP: 'bg-blue-100 text-blue-700',
    TIMEOUT: 'bg-slate-100 text-slate-600',
    OPEN: 'bg-yellow-100 text-yellow-700',
  };
  const labels: Record<string, string> = {
    TARGET: '익절',
    STOP: '손절',
    TIMEOUT: '만기',
    OPEN: '보유중',
  };
  const cls = styles[reason] ?? 'bg-slate-100';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${cls}`}>
      {labels[reason] ?? reason}
    </span>
  );
}
