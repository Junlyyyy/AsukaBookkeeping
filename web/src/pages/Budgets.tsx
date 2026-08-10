// 预算页 — Bento × EVA-02 明日香：模块总览卡 + 进度条 + 新增/编辑

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Budget, Category } from '../types';
import { Donut } from '../components/charts';
import { Modal, toast, fmtMoney } from '../components/ui';

export default function Budgets({ embedded = false }: { embedded?: boolean }) {
  const { ledger, tick, bump } = useApp();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [monthLabel, setMonthLabel] = useState('');
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);

  const load = () => {
    if (!ledger) return;
    api.budgets(ledger.id).then((r) => {
      setBudgets(r.items);
      setMonthLabel(`${r.year} 年 ${r.month} 月`);
    }).catch(() => {});
    api.categories({ ledger_id: ledger.id, type: 'expense' }).then(setCats).catch(() => {});
  };

  useEffect(() => { load(); }, [ledger, tick]);

  if (!ledger) return null;

  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + (b.spent ?? 0), 0);
  const totalProgress = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 999) : 0;

  const onDelete = async (id: number) => {
    try { await api.deleteBudget(id); toast('已删除预算'); bump(); } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  return (
    <div className="nike-in stack gap-6">

      {/* HEADER */}
      <header className="card" style={{ padding: embedded ? '18px 22px' : '26px 30px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="eyebrow eyebrow--black">BUDGETS / 预算 · EVA-02 · {monthLabel}</div>
            <h1 className="hero-title" style={{ marginTop: 6, fontSize: embedded ? '1.5rem' : 'clamp(1.6rem, 3vw, 2.4rem)' }}>
              {fmtMoney(totalBudget)}
            </h1>
            <div className="row gap-3" style={{ marginTop: 8, fontSize: 12, fontWeight: 600 }}>
              <span className="chip">已用 {fmtMoney(totalSpent)}</span>
              <span className={`chip ${totalProgress >= 100 ? 'chip--orange' : 'chip--volt'}`}>{Math.round(totalProgress)}%</span>
            </div>
          </div>
          <button className="btn btn--primary" onClick={() => setEditing('new')}>
            + 新建预算
          </button>
        </div>
        {/* 总进度条 */}
        <div className="bar" style={{ marginTop: 14 }}>
          <div
            className={`bar__fill ${totalProgress >= 100 ? 'bar__fill--orange' : 'bar__fill--volt'}`}
            style={{ width: `${Math.min(totalProgress, 100)}%` }}
          />
        </div>
      </header>

      {/* 预算卡片网格 */}
      {budgets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 60 }}>
          还没有预算 — 点击「+ 新建预算」为支出分类设定月度额度
        </div>
      ) : (
        <div className="grid-3">
          {budgets.map((b) => {
            const p = b.progress ?? 0;
            const over = p >= 100;
            const warning = p >= 80 && !over;
            return (
              <div
                key={b.id}
                className="card card--hover"
                style={over ? { boxShadow: '0 0 0 2px rgba(234,33,67,0.4)' } : {}}
              >
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {b.category_icon} {b.category_name}
                    </div>
                    <div className="eyebrow" style={{ marginTop: 4 }}>{monthLabel}</div>
                  </div>
                  <Donut
                    progress={p}
                    color={over ? 'var(--orange)' : warning ? 'var(--orange)' : 'var(--primary)'}
                  />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                  已用{' '}
                  <span className="num-medium" style={{ color: over ? 'var(--orange)' : 'var(--text)' }}>
                    {fmtMoney(b.spent ?? 0)}
                  </span>
                  {' / '}{fmtMoney(b.amount)}
                </div>
                <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditing(b)}>编辑</button>
                  <button className="btn btn--danger btn--sm" onClick={() => onDelete(b.id)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <BudgetForm
          budget={editing === 'new' ? null : editing}
          cats={cats}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); bump(); }}
        />
      )}
    </div>
  );
}

function BudgetForm({ budget, cats, onClose, onSaved }: {
  budget: Budget | null; cats: Category[]; onClose: () => void; onSaved: () => void;
}) {
  const { ledger } = useApp();
  const [categoryId, setCategoryId] = useState(budget ? String(budget.category_id) : '');
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [pickOpen, setPickOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  // 点字段外部任意处（含 Modal 其他区域/输入框）→ 收起选项面板；不再用全屏遮罩（会盖住输入框/误关 Modal）
  useEffect(() => {
    if (!pickOpen) return;
    const h = (e: MouseEvent) => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [pickOpen]);

  const save = async () => {
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) return toast('请输入有效金额', 'err');
    if (!categoryId) return toast('请选择分类', 'err');
    if (!ledger) return;
    try {
      if (budget) {
        await api.updateBudget(budget.id, { amount: amt });
        toast('已更新预算');
      } else {
        await api.createBudget({ ledger_id: ledger.id, category_id: Number(categoryId), amount: amt });
        toast('已创建预算');
      }
      onSaved();
    } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  // 「全部支出」固定置顶 + 支出分类；选中的展示值
  const options: { id: number; name: string; icon?: string }[] = [
    { id: 0, name: '全部支出', icon: '📊' },
    ...cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
  ];
  const current = options.find((o) => String(o.id) === categoryId);

  return (
    <Modal title={budget ? '编辑预算 · EVA-02' : '+ 新建预算 · EVA-02'} onClose={onClose} grow={pickOpen}>
      <div className="stack gap-3">
        <div>
          <label className="label">分类</label>
          {/* App 风格分类选择器（替代原生 select）：点击展开，面板为正常文档流 → 撑开页面整页显示 */}
          <div ref={pickRef} style={{ position: 'relative', zIndex: 100 }}>
            <button
              type="button"
              className="select"
              style={{
                display: 'flex', alignItems: 'center',
                textAlign: 'left', cursor: 'pointer', width: '100%',
              }}
              onClick={() => setPickOpen((o) => !o)}
            >
              <span style={{ fontWeight: current ? 600 : 400, color: current ? 'var(--text)' : 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {current ? `${current.icon ?? ''} ${current.name}` : '选择支出分类…'}
              </span>
            </button>
            {pickOpen && (
              <div
                className="panel-inset"
                style={{
                  marginTop: 8,
                  borderRadius: 'var(--radius-md)', padding: 6,
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                {options.map((o) => {
                  const active = String(o.id) === categoryId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className="btn"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        justifyContent: 'flex-start', padding: '9px 10px', fontSize: 13,
                        borderRadius: 'var(--radius-sm)',
                        background: active ? 'var(--eva-red-tint)' : 'transparent',
                        color: active ? 'var(--primary)' : 'var(--text)',
                        fontWeight: active ? 700 : 500,
                        boxShadow: 'none',
                      }}
                      onClick={() => { setCategoryId(String(o.id)); setPickOpen(false); }}
                    >
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{o.icon ?? '▣'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                      {active && <span style={{ marginLeft: 'auto', color: 'var(--primary)', fontSize: 12 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">月度预算（元）</label>
          <input
            className="input num-display"
            style={{ fontWeight: 700 }}
            autoFocus inputMode="decimal"
            placeholder="2000.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  );
}
