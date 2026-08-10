// 通用 UI 小件：格式化、Modal、Toast — Bento × EVA-02 明日香

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
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
export function Modal({ title, onClose, children, wide, grow = false }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; grow?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(43, 17, 9, 0.5)', zIndex: 100,
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
          width: '100%', maxWidth: wide ? 760 : 520, padding: 24, position: 'relative',
          /* grow：面板高度不受限，由外层 overlay 滚动（页面向下加长）；默认高于视口时内部可滚，X 按钮固定不动 */
          maxHeight: grow ? 'none' : 'calc(100dvh - 24px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* X 按钮固定右上，不随内容滚动 */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            background: 'rgba(255,255,255,0.9)', color: 'var(--text-secondary)', border: '1px solid rgba(60,25,10,0.10)',
            cursor: 'pointer', padding: 0, flexShrink: 0,
            width: 32, height: 32, fontSize: 14, fontWeight: 600, lineHeight: 1,
            borderRadius: '50%', boxShadow: '0 2px 6px rgba(40,12,4,0.08)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease',
          }}
          aria-label="关闭"
        >✕</button>
        <div style={{ overflowY: grow ? 'visible' : 'auto', flex: 1, minHeight: 0, paddingRight: 4 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---- Toast ----
export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
    background: ${kind === 'ok' ? 'rgba(255,252,249,0.97)' : 'rgba(255,238,232,0.97)'};
    color: ${kind === 'ok' ? '#3a2418' : 'var(--danger)'};
    border: 1px solid ${kind === 'ok' ? 'rgba(211,41,15,0.22)' : 'rgba(220,38,38,0.35)'};
    font-family: var(--font-body); font-weight: 500; font-size: 13px;
    padding: 12px 22px; border-radius: 999px; z-index: 999;
    box-shadow: 0 8px 24px rgba(60,25,10,0.22);
    animation: swoosh-in 0.25s ease both;
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
