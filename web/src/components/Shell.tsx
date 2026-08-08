// 顶部导航 + 应用外壳 — Bento × EVA-02 明日香：机体感悬浮条 + NERV 斜纹

import { useState, useEffect, useRef } from 'react';
import Swoosh from './Swoosh';
import NERVBadge from './NERVBadge';
import { useApp } from '../store';
import type { ReactNode } from 'react';

export type NavKey = 'dashboard' | 'transactions' | 'stats' | 'budgets' | 'categories' | 'accounts' | 'settings';

const NAV: { key: NavKey; label: string }[] = [
  { key: 'dashboard', label: '概览' },
  { key: 'transactions', label: '流水' },
  { key: 'stats', label: '分析' },
  { key: 'budgets', label: '预算' },
  { key: 'categories', label: '分类' },
  { key: 'accounts', label: '账户' },
  { key: 'settings', label: '设置' },
];

export function Shell({ page, setPage, children }: {
  page: NavKey;
  setPage: (k: NavKey) => void;
  children: ReactNode;
}) {
  const { ledger, ledgers, setLedger } = useApp();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledgerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭账本下拉
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ledgerOpen && ledgerRef.current && !ledgerRef.current.contains(e.target as Node)) {
        setLedgerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [ledgerOpen]);

  return (
    <div className="layout">
      {/* 顶部玻璃导航条 */}
      <header
        className="glass"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '10px 0',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          {/* Logo */}
          <button
            onClick={() => setPage('dashboard')}
            className="hide-mobile"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 0',
              color: 'var(--text)',
              flexShrink: 0,
            }}
          >
            <Swoosh size={36} />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em', color: 'var(--text)' }}>
                Asuka记账
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--eva-orange)' }}>
                EVA-02 · 明日香
              </span>
            </span>
          </button>

          {/* 移动端 Logo */}
          <button
            onClick={() => setPage('dashboard')}
            className="hide-desktop"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <Swoosh size={32} />
          </button>

          {/* 导航 */}
          <nav className="nav-wrap" style={{ display: 'flex', flex: 1, overflowX: 'auto', justifyContent: 'center' }}>
            {NAV.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setPage(n.key)}
                  className="nav-btn"
                  data-active={page === n.key ? 'true' : 'false'}
                >
                  {n.label}
                </button>
              ))}
          </nav>

          {/* 账本切换 */}
          <div style={{ position: 'relative', flexShrink: 0 }} ref={ledgerRef}>
            <button
              onClick={() => setLedgerOpen(!ledgerOpen)}
              className="ledger-btn hide-mobile"
            >
              <span style={{ fontSize: 14 }}>📓</span>
              <span className="truncate" style={{ maxWidth: 120 }}>{ledger?.name ?? '加载中'}</span>
              <span style={{ fontSize: 9 }}>▼</span>
            </button>            {/* 移动端 */}
            <button
              onClick={() => setLedgerOpen(!ledgerOpen)}
              className="ledger-btn hide-desktop"
              style={{ padding: '9px 13px' }}
            >
              <span style={{ fontSize: 12 }}>📓</span>
              <span style={{ fontSize: 9 }}>▼</span>
            </button>
            {ledgerOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 10px)',
                  background: 'rgba(255,255,255,0.88)',
                  WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                  backdropFilter: 'saturate(180%) blur(20px)',
                  color: 'var(--text)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)',
                  minWidth: 220,
                  zIndex: 60,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
                  <div className="eyebrow">账本切换</div>
                </div>
                {ledgers.map((l) => (
                  <button
                    key={l.id}
                    onClick={async () => { await setLedger(l.id); setLedgerOpen(false); }}
                    className="ledger-item"
                    data-active={l.id === ledger?.id ? 'true' : 'false'}
                  >
                    <span className="truncate">{l.name}</span>
                    {l.id === ledger?.id && <span className="text-volt">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* NERV 警示斜纹 */}
        <div className="eva-stripe" />
      </header>

      <main className="container container--wide nike-in" style={{ flex: 1, paddingTop: 26, paddingBottom: 60 }}>
        {children}
      </main>

      {/* 页脚 */}
      <footer style={{ background: 'transparent', color: 'var(--text-tertiary)', padding: '22px 0', marginTop: 36 }}>
        <div
          className="container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Swoosh size={26} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text)' }}>
              Asuka记账
            </span>
          </div>
          <div className="eyebrow" style={{ fontWeight: 400, fontSize: 11, color: 'var(--eva-red)' }}>
            EVA-02 · 惣流・アスカ・ラングレー · 离线本地记账
          </div>
          <NERVBadge size={36} />
        </div>
      </footer>

      {/* Shell 内部样式（基础外观；padding/font-size 由 global.css 响应式断点提供） */}
      <style>{`
        .nav-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--text-secondary);
          font-family: var(--font-body);
          font-weight: 500;
          letter-spacing: 0;
          border-radius: 999px;
          transition: color 0.15s ease, background 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .nav-btn[data-active='true'] {
          background: var(--eva-red-tint);
          color: var(--eva-red);
          font-weight: 700;
        }
        .nav-btn:hover[data-active='false'] { color: var(--eva-red); background: rgba(211,41,15,0.06); }
        .ledger-btn {
          background: rgba(255,255,255,0.75);
          border: 1px solid rgba(255,255,255,0.7);
          color: var(--text);
          cursor: pointer;
          font-family: var(--font-body);
          font-weight: 500;
          font-size: 13px;
          padding: 9px 15px;
          border-radius: 999px;
          box-shadow: var(--shadow-xs);
          display: flex;
          align-items: center;
          gap: 8px;
          transition: box-shadow 0.15s ease, transform 0.12s ease;
        }
        .ledger-btn:hover { box-shadow: var(--shadow-sm); }
        .ledger-btn:active { transform: scale(0.97); }
        .ledger-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          text-align: left;
          padding: 12px 16px;
          border: none;
          border-bottom: 1px solid rgba(255,255,255,0.6);
          cursor: pointer;
          background: transparent;
          color: var(--text);
          font-family: var(--font-body);
          font-weight: 500;
          font-size: 14px;
          transition: background 0.12s ease;
        }
        .ledger-item:hover { background: rgba(211,41,15,0.08); }
        .ledger-item[data-active='true'] {
          background: var(--eva-red-tint);
          color: var(--eva-red);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
