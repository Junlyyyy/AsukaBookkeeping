// 仪表盘 — Bento × EVA-02 明日香：模块 Hero + 大小块卡片 + KPI 三联 + EVA 机体系状态

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { AnalyticsSummary, Budget, LedgerStats } from '../types';
import { Donut, RankBars, TrendChart } from '../components/charts';
import { fmtDate, fmtMoney, toast, TypeBadge } from '../components/ui';
import VoiceRecorder from '../components/VoiceRecorder';

export default function Dashboard({ go }: { go: (page: 'transactions' | 'stats' | 'budgets') => void }) {
  const { ledger, tick, bump } = useApp();
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!ledger) return;
    api.ledgerStats(ledger.id).then(setStats).catch(() => {});
    api.analytics({ ledger_id: ledger.id, scope: 'month' }).then(setAnalytics).catch(() => {});
    api.budgets(ledger.id).then((r) => setBudgets(r.items)).catch(() => {});
  }, [ledger, tick]);

  if (!ledger) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>加载中…</div>;

  const income = analytics?.income ?? 0;
  const expense = analytics?.expense ?? 0;
  const net = (analytics?.balance ?? 0);
  const isPositive = net >= 0;

  return (
    <div className="nike-in" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* =============== HERO — EVA-02 明日香驾驶舱 =============== */}
      <section
        className="card card--plug-suit"
        style={{ padding: '30px 32px 34px' }}
      >
        <div className="hero-status-row">
          <div className="eyebrow eyebrow--black" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ledger.name} · {analytics?.month ?? ''}月 · 概览
          </div>
          <div className="row gap-3 hero-status-mid hide-mobile" style={{ flexWrap: 'nowrap' }}>
            <span className="eva-headband" aria-label="明日香发带" />
            <span className="eva-pilot-badge">EVA-02 PILOT · 惣流・アスカ・ラングレー</span>
          </div>
          <div className="hero-status-right">
            <span className="chip chip--volt">SYNC RATE</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div className="hero-num" style={{ color: isPositive ? 'var(--eva-red)' : 'var(--danger)' }}>
              {fmtMoney(net).replace('-', '')}
            </div>
            <div className="eyebrow" style={{ marginTop: 8 }}>本月结余 / NET BALANCE</div>
            {!isPositive && (
              <div className="chip chip--orange" style={{ marginTop: 8 }}>需要控制支出</div>
            )}
            {isPositive && (
              <div className="chip chip--volt" style={{ marginTop: 8 }}>保持节奏</div>
            )}
            <div className="eva-quote" style={{ marginTop: 10 }}>
              あんたバカ？ — 认真记账才是王道
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 8 }}>
              <span className="eyebrow">本月已记 {analytics?.tx_count ?? 0} 笔</span>
            </div>
            <button className="btn btn--primary btn--lg" onClick={() => setVoiceOpen(true)}>
              🎙️ 记一笔
            </button>
          </div>
        </div>
      </section>

      {/* =============== KPI 三联卡（明日香驾驶舱仪表） =============== */}
      <section className="grid-3">
        <KpiCard
          label="本月收入 / INCOME"
          amount={fmtMoney(income)}
          accent="positive"
          meta="全部账户汇总"
        />
        <KpiCard
          label="本月支出 / EXPENSE"
          amount={fmtMoney(expense)}
          accent="negative"
          meta="TOP 分类见下方"
        />
        <KpiCard
          label="累计笔数 / TOTAL"
          amount={String(stats?.tx_count ?? 0)}
          accent="black"
          meta={`分类 ${stats?.category_count ?? 0} · 账户 ${stats?.account_count ?? 0} · 预算 ${stats?.budget_count ?? 0}`}
        />
      </section>

      {/* =============== 趋势 + Top 分类（bento 大小块） =============== */}
      <section className="bento-grid">
        <div className="card card--hover bento-span-8">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">CHART / 趋势 · EVA-02</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>近 30 天</h3>
            </div>
            <div className="row gap-3" style={{ fontSize: 11, fontWeight: 600 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 14, height: 4, background: 'var(--negative)', display: 'inline-block', borderRadius: 2 }} />支出
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 14, height: 4, background: 'var(--positive)', display: 'inline-block', borderRadius: 2 }} />收入
              </span>
            </div>
          </div>
          {analytics && <TrendChart data={analytics.daily} />}
        </div>

        <div className="card card--hover bento-span-4">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">TOP / 分类</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>支出排行</h3>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => go('stats')}>更多 →</button>
          </div>
          {analytics && <RankBars items={analytics.top_expense} max={analytics.top_expense[0]?.amount ?? 1} color="var(--negative)" />}
        </div>
      </section>

      {/* =============== 预算进度 + 最近流水（bento 等分块） =============== */}
      <section className="bento-grid">
        <div className="card bento-span-6">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">BUDGETS / 预算</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>本月进度</h3>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => go('budgets')}>管理 →</button>
          </div>
          <div className="stack gap-3">
            {budgets.slice(0, 5).map((b) => {
              const p = b.progress ?? 0;
              const over = p >= 100;
              return (
                <div key={b.id} className="row gap-3">
                  <Donut
                    progress={p}
                    color={over ? 'var(--negative)' : p >= 80 ? 'var(--orange)' : 'var(--primary)'}
                  />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="row-between">
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {b.category_icon} {b.category_name}
                      </span>
                      <span className="num-medium" style={{ color: over ? 'var(--negative)' : 'var(--text)' }}>
                        {p}%
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 4 }}>
                      已用 {fmtMoney(b.spent ?? 0)} / {fmtMoney(b.amount)}
                    </div>
                  </div>
                </div>
              );
            })}
            {budgets.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                <span className="eva-quote" style={{ display: 'block', marginBottom: 4 }}>NERV 预算未设置</span>
                还没有预算，去设置一个 →
              </div>
            )}
          </div>
        </div>

        <div className="card bento-span-6">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="eyebrow">RECENT / 最近</div>
              <h3 className="section-title" style={{ marginTop: 4 }}>最近流水</h3>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => go('transactions')}>全部 →</button>
          </div>
          <RecentTransactions ledgerId={ledger.id} bumpKey={tick} onChanged={bump} />
        </div>
      </section>

      {voiceOpen && (
        <VoiceRecorder
          onClose={() => setVoiceOpen(false)}
          onSaved={bump}
        />
      )}
    </div>
  );
}

// =============== KPI 卡片组件 ===============
function KpiCard({ label, amount, accent, meta }: {
  label: string;
  amount: string;
  accent: 'positive' | 'negative' | 'black';
  meta: string;
}) {
  const accentColor =
    accent === 'positive' ? 'var(--positive)' :
    accent === 'negative' ? 'var(--negative)' :
    'var(--text)';
  return (
    <div className="card card--hover" style={{ padding: '20px 24px 22px' }}>
      <div className="eyebrow">{label}</div>
      <div className="num-display" style={{ marginTop: 10, color: accentColor }}>
        {amount}
      </div>
      <div className="eyebrow" style={{ marginTop: 12 }}>{meta}</div>
    </div>
  );
}

// =============== 最近流水子组件 ===============
function RecentTransactions({ ledgerId, bumpKey, onChanged }: { ledgerId: number; bumpKey: number; onChanged: () => void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.listTransactions>>['items']>([]);
  const [delArmed, setDelArmed] = useState<number | null>(null);

  useEffect(() => {
    api.listTransactions({ ledger_id: ledgerId, limit: 6 }).then((r) => setList(r.items)).catch(() => {});
  }, [ledgerId, bumpKey]);

  const onDelete = async (id: number) => {
    try {
      if (delArmed === id) {
        await api.deleteTransaction(id, true);
        toast('已删除');
        setDelArmed(null);
        onChanged();
      } else {
        const res = await api.deleteTransaction(id, false) as { status?: string };
        if (res.status === 'pending_confirmation') {
          setDelArmed(id);
          toast('再次点击确认删除', 'err');
          setTimeout(() => setDelArmed((v) => (v === id ? null : v)), 4000);
        }
      }
    } catch (e) {
      toast(String((e as Error).message), 'err');
    }
  };

  if (list.length === 0) {
    return (
      <div style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 24 }}>
        <span className="eva-quote eva-quote--jp" style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
          あんたバカ？
        </span>
        还没有流水 — 快用「自动抓取」导入消费记录吧 →
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 0 }}>
      {list.map((t, i) => (
        <div
          key={t.id}
          className="list__item"
          style={i === 0 ? { borderTop: 'none', paddingTop: 0 } : {}}
        >
          <div className="list__icon" style={{ background: t.type === 'income' ? 'rgba(7,202,107,0.14)' : 'rgba(255,255,255,0.55)' }}>
            {t.category?.icon ?? '▣'}
          </div>
          <div className="list__main">
            <div className="list__title">{t.note || t.category?.name || '未分类'}</div>
            <div className="list__meta">
              {fmtDate(t.occurred_at)} · {t.account?.name ?? '—'}
            </div>
          </div>
          <div
            className={`list__amount ${t.type === 'income' ? 'list__amount--income' : 'list__amount--expense'}`}
          >
            {t.type === 'expense' ? '-' : '+'}{fmtMoney(t.amount)}
          </div>
          <button
            className="btn btn--sm"
            style={
              delArmed === t.id
                ? { background: 'var(--danger)', color: '#fff' }
                : {}
            }
            onClick={() => onDelete(t.id)}
          >
            {delArmed === t.id ? '确认?' : '✕'}
          </button>
        </div>
      ))}
    </div>
  );
}
