// 账户页 — Bento × EVA-02 明日香：深色模块卡 + 账户卡片网格 + 新建

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Account } from '../types';
import { Modal, toast, fmtMoney, ACCOUNT_TYPE_LABEL } from '../components/ui';

const TYPE_ICON: Record<string, string> = {
  cash: '💵', bank: '🏦', credit_card: '💳', e_wallet: '📱', other: '🏷️',
};

export default function Accounts() {
  const { ledger, tick, bump } = useApp();
  const [accts, setAccts] = useState<Account[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!ledger) return;
    api.accounts({ ledger_id: ledger.id }).then(setAccts).catch(() => {});
  }, [ledger, tick]);

  if (!ledger) return null;
  const total = accts.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="nike-in stack gap-6">

      <header className="card card--black" style={{ padding: '28px 32px' }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow eyebrow--white">ACCOUNTS / 账户总余额 · EVA-02</div>
            <h1 className="hero-num" style={{ color: 'var(--success)', marginTop: 6, fontSize: 'clamp(1.8rem, 4.5vw, 3.2rem)' }}>
              {fmtMoney(total)}
            </h1>
            <div className="row gap-3" style={{ marginTop: 10, fontSize: 12, fontWeight: 500 }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>{accts.length} 个账户</span>
            </div>
          </div>
          <button
            className="btn"
            style={{ background: 'var(--primary)', color: '#fff', boxShadow: '0 4px 14px rgba(0,122,255,0.35)' }}
            onClick={() => setAdding(true)}
          >
            + 新建账户
          </button>
        </div>
      </header>

      {accts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 40 }}>暂无账户</div>
      ) : (
        <div className="stack gap-3">
          {accts.map((a) => (
            <div
              key={a.id}
              className="card card--hover"
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 20px',
              }}
            >
              {/* 图标方块 */}
              <div
                style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface)', boxShadow: 'var(--shadow-xs)',
                  fontSize: 24,
                }}
                aria-hidden="true"
              >
                {TYPE_ICON[a.type] ?? '🏷️'}
              </div>
              {/* 中间：账户名 + 类型 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700, fontSize: 16, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {a.name}
                </div>
                <div
                  style={{
                    marginTop: 3, fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.06em', color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                  }}
                >
                  {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
                </div>
              </div>
              {/* 右：余额 */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="num-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                  {fmtMoney(a.balance)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <AccountForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); bump(); }} />}
    </div>
  );
}

function AccountForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { ledger } = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState('bank');
  const [balance, setBalance] = useState('');

  const save = async () => {
    if (!name.trim()) return toast('请输入账户名', 'err');
    if (!ledger) return;
    try {
      await api.createAccount({
        ledger_id: ledger.id, name: name.trim(), type,
        balance: Number(balance) || 0,
      });
      toast('已创建账户');
      onSaved();
    } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  return (
    <Modal title="+ 新建账户 · EVA-02" onClose={onClose}>
      <div className="stack gap-3">
        <div>
          <label className="label">账户名</label>
          <input className="input" autoFocus placeholder="例如：工商银行" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">类型</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{TYPE_ICON[k]} {v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">初始余额（元）</label>
          <input
            className="input num-display"
            style={{ fontWeight: 700 }}
            inputMode="decimal"
            placeholder="0.00"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={save}>创建</button>
        </div>
      </div>
    </Modal>
  );
}
