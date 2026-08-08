// 分类管理页 — Bento × EVA-02 明日香：卡片网格 + 类型分组

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Category } from '../types';
import { Modal, toast } from '../components/ui';

const ICONS = ['🍜', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '🎁', '📱', '💰', '🎉', '📈', '✈️', '🏨', '☕', '🎬', '📦', '💄', '🐱', '🏋️', '▣'];

export default function Categories() {
  const { ledger, tick, bump } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!ledger) return;
    api.categories({ ledger_id: ledger.id }).then(setCats).catch(() => {});
  }, [ledger, tick]);

  if (!ledger) return null;

  const expense = cats.filter((c) => c.type === 'expense');
  const income = cats.filter((c) => c.type === 'income');

  return (
    <div className="nike-in stack gap-6">

      <header className="card" style={{ padding: '26px 30px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow eyebrow--black">CATEGORIES / 分类 · EVA-02</div>
            <h1 className="hero-title" style={{ marginTop: 6, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
              {cats.length}<span style={{ color: 'var(--text-tertiary)' }}> / 全部</span>
            </h1>
            <div className="row gap-3" style={{ marginTop: 10, fontSize: 12, fontWeight: 600 }}>
              <span className="chip chip--black">支出 {expense.length}</span>
              <span className="chip chip--volt">收入 {income.length}</span>
            </div>
          </div>
          <button className="btn btn--primary" onClick={() => setAdding(true)}>+ 新建分类</button>
        </div>
      </header>

      <div className="grid-2">
        <CategorySection
          title="支出分类 / EXPENSE"
          accent="orange"
          items={expense}
        />
        <CategorySection
          title="收入分类 / INCOME"
          accent="volt"
          items={income}
        />
      </div>

      {adding && (
        <CategoryForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); bump(); }} />
      )}
    </div>
  );
}

function CategorySection({ title, accent, items }: { title: string; accent: 'orange' | 'volt'; items: Category[] }) {
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow eyebrow--black">{title}</div>
          <h3 className="section-title" style={{ marginTop: 4 }}>{items.length} 项</h3>
        </div>
        <span className={`chip chip--${accent}`}>{accent === 'volt' ? 'IN' : 'OUT'}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 30 }}>暂无</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {items.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface)',
                boxShadow: 'var(--shadow-xs)',
              }}
            >
              <span style={{ fontSize: 22 }}>{c.icon}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { ledger } = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [icon, setIcon] = useState('▣');

  const save = async () => {
    if (!name.trim()) return toast('请输入分类名', 'err');
    if (!ledger) return;
    try {
      await api.createCategory({ ledger_id: ledger.id, name: name.trim(), type, icon });
      toast('已创建分类');
      onSaved();
    } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  return (
    <Modal title="+ 新建分类 · EVA-02" onClose={onClose}>
      <div className="stack gap-3">
        <div>
          <label className="label">类型</label>
          <div style={{ display: 'flex', gap: 8, background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)', padding: 5 }}>
            {(['expense', 'income'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className="btn"
                style={{
                  flex: 1,
                  background: type === t ? (t === 'expense' ? 'var(--primary)' : 'var(--success)') : 'transparent',
                  color: type === t ? '#fff' : 'var(--text-secondary)',
                  boxShadow: type === t ? 'var(--shadow-sm)' : 'none',
                }}
              >{t === 'expense' ? '支出' : '收入'}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">名称</label>
          <input className="input" autoFocus placeholder="例如：宠物" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">图标</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                style={{
                  width: 40, height: 40, fontSize: 20, cursor: 'pointer',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: icon === ic ? 'var(--primary)' : 'var(--surface)',
                  boxShadow: icon === ic ? 'var(--shadow-xs)' : 'var(--shadow-xs)',
                }}
              >{ic}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save}>创建</button>
        </div>
      </div>
    </Modal>
  );
}
