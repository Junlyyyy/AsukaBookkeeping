// 数据分析页 — Bento × EVA-02 明日香：scope 切换 + 趋势图 + Top 排行 + 洞察卡片

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { AnalyticsSummary } from '../types';
import { RankBars, TrendChart } from '../components/charts';
import { fmtMoney } from '../components/ui';

type Scope = 'month' | 'year' | 'all';

export default function Stats() {
  const { ledger, tick } = useApp();
  const [scope, setScope] = useState<Scope>('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    if (!ledger) return;
    api.analytics({
      ledger_id: ledger.id, scope, year,
      month: scope === 'month' ? new Date().getMonth() + 1 : undefined,
    }).then(setData).catch(() => {});
  }, [ledger, scope, year, tick]);

  if (!ledger) return null;

  const yearSel = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <div className="nike-in stack gap-6">

      {/* HEADER */}
      <header className="card" style={{ padding: '26px 30px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="row gap-3" style={{ alignItems: 'center' }}>
              <span className="eva-headband" aria-label="明日香发带" />
              <div className="eyebrow eyebrow--black">ANALYTICS / 数据分析 · EVA-02</div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 6, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
              {scope === 'month' ? `${year} 月度` : scope === 'year' ? `${year} 年度` : '全部数据'}
            </h1>
            {data && (
              <div className="row gap-3" style={{ marginTop: 10, fontSize: 12, fontWeight: 600 }}>
                <span className="chip chip--volt">收入 {fmtMoney(data.income)}</span>
                <span className="chip">支出 {fmtMoney(data.expense)}</span>
                <span className="chip chip--black">结余 {fmtMoney(data.balance)}</span>
              </div>
            )}
          </div>
          {/* scope 切换 — 内凹轨道 */}
          <div className="row gap-2" style={{ flexWrap: 'wrap', background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)', padding: 5 }}>
            {(['month', 'year', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                className="btn"
                style={scope !== s ? {
                  background: 'transparent', color: 'var(--text-secondary)',
                  boxShadow: 'none',
                } : {}}
                onClick={() => setScope(s)}
              >
                {s === 'month' ? '月' : s === 'year' ? '年' : '全部'}
              </button>
            ))}
          </div>
        </div>
        {scope !== 'all' && (
          <div className="row gap-2" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            <span className="eyebrow">年份:</span>
            {yearSel.map((y) => (
              <button
                key={y}
                className={`chip ${year === y ? 'chip--volt' : ''}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* 三大数字 */}
      <section className="grid-3">
        <BigStat label="收入 / INCOME" value={fmtMoney(data?.income ?? 0)} accent="positive" />
        <BigStat label="支出 / EXPENSE" value={fmtMoney(data?.expense ?? 0)} accent="negative" />
        <BigStat
          label="结余 / NET"
          value={fmtMoney(data?.balance ?? 0)}
          accent={(data?.balance ?? 0) >= 0 ? 'black' : 'negative'}
        />
      </section>

      {/* 趋势 + 排行 */}
      <section className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div className="card card--hover">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">CHART / 趋势</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>近 30 天</h3>
            </div>
          </div>
          {data && <TrendChart data={data.daily} />}
        </div>
        <div className="card card--hover">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">TOP / 支出分类</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>排行</h3>
            </div>
          </div>
          {data && <RankBars items={data.top_expense} max={data.top_expense[0]?.amount ?? 1} color="var(--negative)" />}
        </div>
      </section>

      <section className="grid-2">
        <div className="card card--hover">
          <div className="eyebrow" style={{ marginBottom: 12 }}>INCOME / 收入来源</div>
          <h3 className="section-title" style={{ marginBottom: 14 }}>TOP 排行</h3>
          {data && <RankBars items={data.top_income} max={data.top_income[0]?.amount ?? 1} color="var(--positive)" />}
        </div>
        <div className="card card--black card--hover">
          <div className="row gap-2" style={{ marginBottom: 12, alignItems: 'center' }}>
            <span className="eva-headband" style={{ filter: 'brightness(0.9)' }} aria-label="明日香发带" />
            <div className="eyebrow eyebrow--white">INSIGHT / 洞察 · EVA-02</div>
          </div>
          <h3 className="section-title" style={{ marginBottom: 14 }}>本月建议</h3>
          {data && (
            <div className="stack gap-2" style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
              <Insight>共 {data.tx_count} 笔交易</Insight>
              <Insight>支出最高：{data.top_expense[0] ? `${data.top_expense[0].icon} ${data.top_expense[0].name}（${fmtMoney(data.top_expense[0].amount)}）` : '—'}</Insight>
              <Insight>支出占收入比：{data.income > 0 ? Math.round((data.expense / data.income) * 100) : 0}%</Insight>
              <Insight bold color={data.balance >= 0 ? 'var(--success)' : 'var(--warning)'}>
                {data.balance >= 0 ? '结余为正，继续保持 ✓' : '结余为负，注意控制支出 ⚠'}
              </Insight>
              <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 700, color: '#ffb3a3', letterSpacing: '0.02em' }}>
                「あんたバカ？花钱之前先看看预算呀！」 — 明日香
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent: 'positive' | 'negative' | 'black' }) {
  const color =
    accent === 'positive' ? 'var(--positive)' :
    accent === 'negative' ? 'var(--negative)' :
    'var(--text)';
  return (
    <div className="card">
      <div className="eyebrow">{label}</div>
      <div className="num-display" style={{ marginTop: 10, color }}>{value}</div>
    </div>
  );
}

function Insight({ children, bold, color }: { children: React.ReactNode; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0' }}>
      <span style={{ width: 8, height: 8, background: color || 'var(--primary)', display: 'inline-block', flexShrink: 0, borderRadius: '50%' }} />
      <span style={{ flex: 1, fontWeight: bold ? 700 : 500, color: color || 'inherit' }}>{children}</span>
    </div>
  );
}
