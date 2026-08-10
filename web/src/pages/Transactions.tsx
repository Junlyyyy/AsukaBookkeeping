// 流水页 — Bento × EVA-02 明日香：模块 Header + 筛选面板 + 列表 + 自动抓取/记账

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Account, Category, Tag, Transaction } from '../types';
import { Modal, toast, fmtDate, fmtMoney } from '../components/ui';
import AutoCapture from '../components/AutoCapture';

export default function Transactions() {
  const { ledger, tick, bump } = useApp();
  const [items, setItems] = useState<Transaction[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [accts, setAccts] = useState<Account[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [fType, setFType] = useState('');
  const [fCat, setFCat] = useState('');
  const [fAcct, setFAcc] = useState('');
  const [fTag, setFTag] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fQ, setFQ] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');

  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [delArmed, setDelArmed] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fetchOpen, setFetchOpen] = useState(false);

  const load = useCallback(() => {
    if (!ledger) return;
    api.listTransactions({
      ledger_id: ledger.id, limit: 200,
      type: fType, category_id: fCat, account_id: fAcct, tag_id: fTag,
      date_from: fFrom, date_to: fTo, q: fQ, amount_min: fMin, amount_max: fMax,
    }).then((r) => setItems(r.items)).catch((e) => toast(String((e as Error).message), 'err'));
  }, [ledger, fType, fCat, fAcct, fTag, fFrom, fTo, fQ, fMin, fMax]);

  useEffect(() => { load(); }, [load, tick]);

  useEffect(() => {
    if (!ledger) return;
    api.categories({ ledger_id: ledger.id }).then(setCats).catch(() => {});
    api.accounts({ ledger_id: ledger.id }).then(setAccts).catch(() => {});
    api.tags(ledger.id).then(setTags).catch(() => {});
  }, [ledger, tick]);

  if (!ledger) return null;

  const onDelete = async (id: number) => {
    try {
      if (delArmed === id) {
        await api.deleteTransaction(id, true);
        toast('已永久删除');
        setDelArmed(null);
        bump();
      } else {
        const res = await api.deleteTransaction(id, false) as { status?: string };
        if (res.status === 'pending_confirmation') {
          setDelArmed(id);
          toast('再次点击确认永久删除', 'err');
          setTimeout(() => setDelArmed((v) => (v === id ? null : v)), 4000);
        }
      }
    } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  // 统计金额
  const totalIncome = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  // 生效筛选条件数
  const activeFilterCount = [fType, fCat, fAcct, fTag, fFrom, fTo, fQ, fMin, fMax].filter(Boolean).length;

  return (
    <div className="nike-in stack gap-6">

      {/* =============== HEADER =============== */}
      <header className="card card--plug-suit" style={{ padding: '26px 30px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="row gap-3" style={{ alignItems: 'center' }}>
              <span className="eva-headband" aria-label="明日香发带" />
              <div className="eyebrow eyebrow--black">TRANSACTIONS / 流水 · EVA-02</div>
            </div>
            <h1 className="hero-title" style={{ marginTop: 6, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
              {items.length}<span style={{ color: 'var(--text-tertiary)' }}> 笔</span>
            </h1>
            <div className="row gap-3" style={{ marginTop: 10, fontSize: 12, fontWeight: 600 }}>
              <span className="chip chip--volt">收入 {fmtMoney(totalIncome)}</span>
              <span className="chip">支出 {fmtMoney(totalExpense)}</span>
            </div>
          </div>
          <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn--ghost" onClick={() => setFetchOpen(true)}>
              📥 自动抓取
            </button>
          </div>
        </div>
      </header>

      {/* =============== 筛选条（紧凑：按钮 + 生效条件 chips，完整表单在二级 Modal） =============== */}
      <div className="panel-inset">
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row gap-3" style={{ flexWrap: 'wrap', minWidth: 0 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setFilterOpen(true)}>
              ⚙ 筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
            {activeFilterCount === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>无筛选条件 — 显示全部流水</span>
            )}
            {fType && <span className="chip">{fType === 'expense' ? '支出' : '收入'}</span>}
            {fCat && <span className="chip">{(cats.find((c) => c.id === Number(fCat))?.name) || '分类'}</span>}
            {fAcct && <span className="chip">{(accts.find((a) => a.id === Number(fAcct))?.name) || '账户'}</span>}
            {fTag && <span className="chip">#{tags.find((t) => t.id === Number(fTag))?.name || ''}</span>}
            {(fFrom || fTo) && (
              <span className="chip">{fFrom || '…'} ~ {fTo || '…'}</span>
            )}
            {(fMin || fMax) && <span className="chip">¥{fMin || '0'} ~ ¥{fMax || '∞'}</span>}
            {fQ && <span className="chip truncate" style={{ maxWidth: 140 }}>🔍 {fQ}</span>}
          </div>
          {activeFilterCount > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setFType(''); setFCat(''); setFAcc(''); setFTag('');
                setFFrom(''); setFTo(''); setFQ(''); setFMin(''); setFMax('');
              }}
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* =============== 流水列表 =============== */}
      <div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="eyebrow eyebrow--black">RESULTS / 结果</div>
          <div className="eyebrow">{items.length} 笔</div>
        </div>

        {items.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>
            <span className="eva-quote eva-quote--jp" style={{ display: 'block', fontSize: 18, marginBottom: 8 }}>
              あんたバカ？一条流水都没有！
            </span>
            换个筛选条件，或用「📥 自动抓取」导入
          </div>
        ) : (
          <div className="list">
            {items.map((t) => (
              <div key={t.id} className="list__item" style={{ paddingLeft: 18, paddingRight: 14 }}>
                <div className="list__main" style={{ minWidth: 0, flex: 1 }}>
                  <div className="list__title">
                    {t.note || t.category?.name || '未分类'}
                  </div>
                  <div className="list__meta">
                    {fmtDate(t.occurred_at)}
                  </div>
                </div>
                <div
                  className={`list__amount ${t.type === 'income' ? 'list__amount--income' : 'list__amount--expense'}`}
                  style={{ fontSize: 18, marginRight: 8 }}
                >
                  {t.type === 'expense' ? '-' : '+'}{fmtMoney(t.amount)}
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => setEditing(t)}>改</button>
                <button
                  className="btn btn--sm"
                  style={delArmed === t.id
                    ? { background: 'var(--danger)', color: '#fff' }
                    : {}}
                  onClick={() => onDelete(t.id)}
                >
                  {delArmed === t.id ? '确认?' : '✕'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && editing !== 'new' && (
        <TxForm
          tx={editing}
          cats={cats} accts={accts} tags={tags} ledgerId={ledger.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); bump(); }}
        />
      )}

      {fetchOpen && (
        <AutoCapture
          onClose={() => setFetchOpen(false)}
          onImported={(n) => { bump(); toast(`已导入 ${n} 笔`); }}
        />
      )}

      {/* =============== 筛选二级页面（Modal） =============== */}
      {filterOpen && (
        <Modal title="⚙ 筛选流水 · EVA-02" onClose={() => setFilterOpen(false)} wide>
          <div className="grid-3">
            <Field label="类型">
              <select className="select" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="">全部</option>
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
            </Field>
            <Field label="分类">
              <select className="select" value={fCat} onChange={(e) => setFCat(e.target.value)}>
                <option value="">全部</option>
                {cats.filter((c) => c.type === fType || !fType).map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="账户">
              <select className="select" value={fAcct} onChange={(e) => setFAcc(e.target.value)}>
                <option value="">全部</option>
                {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="标签">
              <select className="select" value={fTag} onChange={(e) => setFTag(e.target.value)}>
                <option value="">全部</option>
                {tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
              </select>
            </Field>
            <Field label="起">
              <input type="date" className="input" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
            </Field>
            <Field label="止">
              <input type="date" className="input" value={fTo} onChange={(e) => setFTo(e.target.value)} />
            </Field>
            <Field label="金额区间">
              <div className="row gap-2">
                <input type="number" className="input" placeholder="最小" value={fMin} onChange={(e) => setFMin(e.target.value)} />
                <input type="number" className="input" placeholder="最大" value={fMax} onChange={(e) => setFMax(e.target.value)} />
              </div>
            </Field>
            <Field label="关键词">
              <input
                className="input"
                placeholder="搜索备注/分类/账户…"
                value={fQ}
                onChange={(e) => setFQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (load(), setFilterOpen(false))}
              />
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button className="btn btn--primary" onClick={() => { load(); setFilterOpen(false); }}>应用筛选</button>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setFType(''); setFCat(''); setFAcc(''); setFTag('');
                setFFrom(''); setFTo(''); setFQ(''); setFMin(''); setFMax('');
              }}
            >
              清空全部条件
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>当前生效 {activeFilterCount} 个条件</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Field 表单字段包装
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// =============== 交易表单 ===============
function TxForm({ tx, cats, accts, tags, ledgerId, onClose, onSaved }: {
  tx: Transaction | null;
  cats: Category[]; accts: Account[]; tags: Tag[]; ledgerId: number;
  onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<'expense' | 'income'>(tx?.type === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [categoryId, setCategoryId] = useState(tx?.category?.id ? String(tx.category.id) : '');
  const [accountId, setAccountId] = useState(tx?.account?.id ? String(tx.account.id) : '');
  const [note, setNote] = useState(tx?.note ?? '');
  const [date, setDate] = useState(tx ? tx.occurred_at.slice(0, 10) : (() => {
    // 本地日期（不能用 toISOString 的 UTC 日期，否则凌晨记账跨天）
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })());
  const [time, setTime] = useState(tx ? tx.occurred_at.slice(11, 16) : new Date().toTimeString().slice(0, 5));
  const [tagIds, setTagIds] = useState<number[]>(tx?.tags.map((t) => t.id) ?? []);
  const [saving, setSaving] = useState(false);

  const shownCats = cats.filter((c) => c.type === type);

  const save = async () => {
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) return toast('请输入有效金额', 'err');
    if (type === 'expense' && !categoryId) return toast('请选择分类', 'err');
    const body = {
      ledger_id: ledgerId,
      type,
      amount: amt,
      category_id: categoryId ? Number(categoryId) : null,
      account_id: accountId ? Number(accountId) : null,
      note,
      occurred_at: `${date} ${time}:00`,
      tag_ids: tagIds,
    };
    setSaving(true);
    try {
      if (tx) { await api.updateTransaction(tx.id, body); toast('已更新'); }
      else { await api.createTransaction(body); toast('已记账'); }
      onSaved();
    } catch (e) { toast(String((e as Error).message), 'err'); }
    setSaving(false);
  };

  return (
    <Modal title={tx ? '编辑交易 · EVA-02' : '+ 记一笔 · EVA-02'} onClose={onClose}>
      {/* 类型切换 — 内凹轨道 */}
      <div style={{ display: 'flex', marginBottom: 16, gap: 8, background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)', padding: 5 }}>
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setType(t); setCategoryId(''); }}
            className="btn"
            style={{
              flex: 1,
              background: type === t ? (t === 'expense' ? 'var(--primary)' : 'var(--success)') : 'transparent',
              color: type === t ? '#fff' : 'var(--text-secondary)',
              boxShadow: type === t ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {t === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>

      <div className="stack gap-3">
        <div>
          <label className="label">金额（元）</label>
          <input
            className="input num-display"
            style={{ fontSize: 22, fontWeight: 700 }}
            autoFocus inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <Field label="分类">
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">选择分类…</option>
            {shownCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label="账户">
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">选择账户…</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="备注">
          <input className="input" placeholder="写点什么…" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="日期">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="时间">
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div>
          <label className="label">标签</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() => setTagIds((prev) => prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                className={`chip ${tagIds.includes(t.id) ? 'chip--volt' : ''}`}
              >
                #{t.name}
              </button>
            ))}
            {tags.length === 0 && <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>暂无标签</span>}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
