// 通用 UI 小件：格式化、Modal、Toast — Bento × EVA-02 明日香

import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}¥${s}`;
}

export function fmtMoneyCompact(n: number): string {
  if (Math.abs(n) >= 10000) return `¥${(n / 10000).toFixed(1)}w`;
  return fmtMoney(n);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = (today - day) / 86400000;
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === -1) return '明天';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() === now.getFullYear() ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  cash: '现金', bank: '银行卡', credit_card: '信用卡', e_wallet: '电子钱包', other: '其他',
};

const TYPE_COLOR: Record<string, string> = { expense: 'var(--negative)', income: 'var(--positive)', transfer: 'var(--gray-500)' };

export function TypeBadge({ type }: { type: string }) {
  const label = type === 'expense' ? '支出' : type === 'income' ? '收入' : '转账';
  return (
    <span className="chip" style={{ color: TYPE_COLOR[type] || 'var(--text-secondary)', boxShadow: 'none', background: 'rgba(255,255,255,0.5)' }}>
      {label}
    </span>
  );
}

// ---- Modal ----
export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(16, 20, 43, 0.45)', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '6vh 16px',
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="swoosh-in"
        style={{
          background: 'rgba(255,255,255,0.82)',
          WebkitBackdropFilter: 'saturate(180%) blur(24px)',
          backdropFilter: 'saturate(180%) blur(24px)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid rgba(255,255,255,0.7)',
          width: '100%', maxWidth: wide ? 760 : 520, padding: 28,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 className="display-md" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.6)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer',
              width: 30, height: 30, fontSize: 13, fontWeight: 600, borderRadius: '50%',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.6)'; }}
            aria-label="关闭"
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Toast ----
export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
    background: ${kind === 'ok' ? 'rgba(31,41,55,0.92)' : 'rgba(220,38,38,0.92)'};
    color: #fff;
    font-family: var(--font-body); font-weight: 500; font-size: 13px;
    padding: 12px 22px; border-radius: 999px; z-index: 999;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    animation: swoosh-in 0.25s ease both;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.2);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
