// 自绘 SVG 图表 — Bento × EVA-02 明日香：圆角折线、红橙轨道

import { useMemo } from 'react';

const W = 720;
const H = 240;
const PAD = { l: 10, r: 10, t: 18, b: 26 };

/** 双系列趋势面积/折线图（支出红/收入绿） */
export function TrendChart({ data }: { data: { date: string; income: number; expense: number }[] }) {
  const { pathExpense, pathIncome, areaExpense, areaIncome, max, xAt, yAt } = useMemo(() => {
    const values = data.flatMap((d) => [d.income, d.expense]);
    const max = Math.max(...values, 1);
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const xAt = (i: number) => PAD.l + (i / Math.max(data.length - 1, 1)) * iw;
    const yAt = (v: number) => PAD.t + ih - (v / max) * ih;

    const line = (get: (d: { date: string; income: number; expense: number }) => number) =>
      data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(get(d)).toFixed(1)}`).join(' ');
    const area = (get: (d: { date: string; income: number; expense: number }) => number) =>
      `${line(get)} L${xAt(data.length - 1).toFixed(1)},${(H - PAD.b).toFixed(1)} L${xAt(0).toFixed(1)},${(H - PAD.b).toFixed(1)} Z`;

    return {
      pathExpense: line((d) => d.expense),
      pathIncome: line((d) => d.income),
      areaExpense: area((d) => d.expense),
      areaIncome: area((d) => d.income),
      max, xAt, yAt,
    };
  }, [data]);

  const gridColor = 'rgba(255,255,255,0.4)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* 网格线 */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * (1 - f)} y2={PAD.t + (H - PAD.t - PAD.b) * (1 - f)} stroke={gridColor} strokeWidth="1" />
      ))}
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke={gridColor} strokeWidth="1" />

      {/* 面积 */}
      <path d={areaExpense} fill="#DC2626" opacity="0.08" />
      <path d={areaIncome} fill="#16A34A" opacity="0.08" />

      {/* 折线 */}
      <path d={pathIncome} fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={pathExpense} fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* 日期刻度（每 5 天一个） */}
      {data.map((d, i) =>
        i % Math.max(1, Math.ceil(data.length / 6)) === 0 ? (
          <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#8E8EA8" fontFamily="var(--font-num)">
            {d.date.slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** 横向排名条（Top 分类）— 内凹轨道 */
export function RankBars({ items, max, color = '#c42710' }: {
  items: { name: string; icon: string; amount: number; count?: number }[];
  max: number; color?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {items.map((it, i) => {
        const pct = max > 0 ? (it.amount / max) * 100 : 0;
        return (
          <div key={it.name} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{
                fontWeight: 600, fontSize: 13, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ color: 'var(--text-tertiary)', marginRight: 8, fontFamily: 'var(--font-num)' }}>0{i + 1}</span>
                {it.name}
              </span>
              <span
                className="num-xl"
                style={{
                  fontSize: 14, flexShrink: 0, whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ¥{it.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{
              background: 'var(--gray-100)',
              height: 12,
              borderRadius: 999,
              overflow: 'hidden',
            }}>
              <div
                style={{
                  height: '100%', background: color, width: `${pct}%`,
                  borderRadius: 999,
                  transition: 'width .5s cubic-bezier(.2,.8,.2,1)',
                }}
              />
            </div>
          </div>
        );
      })}
      {items.length === 0 && <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 12, textAlign: 'center' }}>暂无数据</div>}
    </div>
  );
}

/** 预算进度环 */
export function Donut({ progress, color }: { progress: number; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const filled = Math.min(progress / 100, 1) * c;
  return (
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="10" />
      <circle
        cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${filled} ${c - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="46" textAnchor="middle" fontSize="15" fontWeight="600" fontFamily="var(--font-num)" fill="#1A1A2E">
        {Math.min(Math.round(progress), 999)}%
      </text>
    </svg>
  );
}
