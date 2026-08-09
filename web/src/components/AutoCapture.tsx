// 自动抓取消费记录 — 三种来源共用一个候选入账面板
//
// 1. 立即扫描短信：通过 AsukaCapture.readRecentSms() 拿最近 24h 收件箱
// 2. 通知监听：通过系统「通知使用权」拿到微信支付/支付宝/各银行 App 的实时通知
// 3. 手动粘贴：现有 text→rule→候选 入账流程
//
// 三路产物统一映射为 { amount, category, type, occurred_at, note, source, raw } 候选，
// 一次性入账到本地 SQLite。

import { useEffect, useState } from 'react';
import AsukaCapture from '../lib/asuka-capture';
import type { NotificationPayload } from '../lib/asuka-capture';
import {
  parseSms, parseNotification, parseSmsBatch, parseNotificationBatch,
  type ParsedTx,
} from '../lib/autoParse';
import { Modal, toast, fmtMoney } from './ui';
import { api } from '../api';
import { useApp } from '../store';

type Tab = 'sms' | 'notification' | 'paste';

interface CandidateItem extends ParsedTx {
  raw: string;          // 用于 UI 展示的原文
  source: 'sms' | 'notification' | 'paste';
}

export default function AutoCapture({ onClose, onImported }: {
  onClose: () => void;
  onImported?: (count: number) => void;
}) {
  const { ledger } = useApp();
  const [tab, setTab] = useState<Tab>('sms');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [notifAccessGranted, setNotifAccessGranted] = useState<boolean | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [removing, setRemoving] = useState<Set<number>>(new Set());

  // 启动时查询通知权限现状
  useEffect(() => {
    let alive = true;
    AsukaCapture.isNotificationAccessGranted()
      .then((r) => { if (alive) setNotifAccessGranted(r.granted); })
      .catch(() => { if (alive) setNotifAccessGranted(false); });
    return () => { alive = false; };
  }, []);

  // 订阅通知监听事件（实时追加到候选）
  useEffect(() => {
    let detach: (() => Promise<void>) | null = null;
    let alive = true;
    AsukaCapture.addListener('notification_captured', (payload: NotificationPayload) => {
      if (!alive) return;
      const r = parseNotification(payload.packageName, payload.title, payload.text, payload.postedAt);
      if (r && r.amount) {
        setCandidates((prev) => [
          {
            ...r,
            raw: payload.body,
            source: 'notification',
          } as CandidateItem,
          ...prev,
        ]);
      }
    }).then((h) => { if (alive) detach = h.remove; }).catch(() => {});
    return () => { alive = false; if (detach) void detach(); };
  }, []);

  /* =============== 扫描短信 =============== */
  const onScanSms = async () => {
    if (!ledger) return;
    setScanState('scanning');
    try {
      const r = await AsukaCapture.readRecentSms({
        sinceMs: Date.now() - 24 * 3600 * 1000,
      });
      const items = parseSmsBatch(r.items);
      const next: CandidateItem[] = items.map((it, i) => ({
        ...it,
        raw: `${r.items[i]?.sender || ''} ${r.items[i]?.body || ''}`.slice(0, 80),
        source: 'sms',
      }));
      setCandidates((prev) => [...next, ...prev]);
      toast(`扫描到 ${r.count} 条短信，识别出 ${items.length} 条消费`);
      setScanState('done');
    } catch (e) {
      toast(String((e as Error).message || '扫描失败'), 'err');
      setScanState('idle');
    }
  };

  /* =============== 通知监听设置 =============== */
  const onOpenNotificationSettings = async () => {
    try {
      await AsukaCapture.openNotificationAccessSettings();
      toast('已打开「通知使用权」设置，勾选 Asuka记账 后返回', 'ok');
      // 用户返回后 1.5s 再查一次
      setTimeout(async () => {
        const r = await AsukaCapture.isNotificationAccessGranted();
        setNotifAccessGranted(r.granted);
        if (r.granted) toast('通知监听已启用 ✓');
      }, 1500);
    } catch (e) { toast(String((e as Error).message || '跳转失败'), 'err'); }
  };

  /* =============== 解析粘贴文本 =============== */
  const onParsePaste = () => {
    if (!pasteText.trim()) return toast('请粘贴消费短信或交易详情', 'err');
    // 复用 parseSms 规则（短信和粘文本结构相似）
    const it = parseSms('', pasteText);
    if (!it || !it.amount) return toast('未能识别出金额，请检查文本格式', 'err');
    setCandidates((prev) => [{
      ...it,
      raw: pasteText.slice(0, 80),
      source: 'paste',
    } as CandidateItem, ...prev]);
    setPasteText('');
    toast('已加入候选');
  };

  /* =============== 入账 =============== */
  const onConfirm = async () => {
    if (!ledger) return;
    const valid = candidates.filter((c) => !removing.has(candidates.indexOf(c)) && c.amount);
    if (valid.length === 0) return toast('没有可入账的候选', 'err');
    // 兼容 api.createTransactions 接受的 TxCandidate 格式
    const body = valid.map((c) => ({
      ledger_id: ledger.id,
      type: c.type || 'expense',
      amount: c.amount as number,
      note: c.merchant || c.note || c.raw,
      category_id: null as number | null,
      account_id: null as number | null,
      occurred_at: c.occurred_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
    }));
    try {
      const r = await api.createTransactions(body);
      toast(`已导入 ${r.created} 笔`);
      onImported?.(r.created);
      onClose();
    } catch (e) { toast(String((e as Error).message || '入账失败'), 'err'); }
  };

  const removeAt = (idx: number) => {
    setRemoving((prev) => new Set(prev).add(idx));
    setTimeout(() => {
      setCandidates((prev) => prev.filter((_, i) => i !== idx));
      setRemoving(new Set());
    }, 200);
  };

  return (
    <Modal title="" onClose={onClose} wide>
      {/* 紧凑头部：单行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, paddingRight: 44 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📡</span>
          <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
            MAGI 自动抓取 · 三种来源离线解析
          </h2>
        </div>
      </div>

      {/* 三模式切换 tab */}
      <div className="row gap-2" style={{ marginBottom: 10, background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)', padding: 4 }}>
        <TabBtn active={tab === 'sms'} onClick={() => setTab('sms')} icon="📨">扫短信</TabBtn>
        <TabBtn active={tab === 'notification'} onClick={() => setTab('notification')} icon="🔔">通知监听</TabBtn>
        <TabBtn active={tab === 'paste'} onClick={() => setTab('paste')} icon="📋">粘文本</TabBtn>
      </div>

      {/* tab 内容 — 紧凑 */}
      <div style={{ marginBottom: 12 }}>
        {tab === 'sms' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
              读取系统短信收件箱最近 24 小时，自动按规则识别金额、商家、时间、分类。
              <span style={{ color: 'var(--text-tertiary)' }}> · 权限 READ_SMS · 仅首次需要，仅本地解析不联网</span>
            </p>
            <button className="btn btn--primary btn--sm" onClick={onScanSms} disabled={scanState === 'scanning'}>
              {scanState === 'scanning' ? '扫描中…' : scanState === 'done' ? '再次扫描' : '立即扫描'}
            </button>
          </div>
        )}

        {tab === 'notification' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
              启用后实时捕获微信支付、支付宝、各银行 App 的付款/收款通知，零点击入账。
              <span style={{ color: 'var(--text-tertiary)' }}> · 需在「通知使用权」里勾选一次</span>
            </p>
            <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn--primary btn--sm" onClick={onOpenNotificationSettings}>
                打开系统设置
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: notifAccessGranted ? 'var(--success)' : 'var(--text-tertiary)' }}>
                {notifAccessGranted === null
                  ? '检测中…'
                  : notifAccessGranted
                    ? '● 已授权'
                    : '○ 未授权'}
              </span>
            </div>
          </div>
        )}

        {tab === 'paste' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
              粘贴支付短信、微信分享文本、银行对账单，规则解析为多条候选。
            </p>
            <textarea
              className="textarea"
              rows={3}
              placeholder="粘贴消费短信 / 分享文本 / 对账单文本…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              style={{ marginBottom: 8, fontSize: 13, padding: 10 }}
            />
            <button className="btn btn--primary btn--sm" onClick={onParsePaste}>解析</button>
          </div>
        )}
      </div>

      {/* 候选列表 — 自适应高度 */}
      {candidates.length > 0 && (
        <div className="panel-inset" style={{ padding: '10px 12px' }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <div className="eyebrow eyebrow--black">识别到 {candidates.length} 条候选</div>
            <button className="btn btn--ghost btn--sm" onClick={() => setCandidates([])}>清空</button>
          </div>
          <div className="stack gap-2" style={{ maxHeight: 'clamp(180px, 38dvh, 340px)', overflowY: 'auto', paddingRight: 2 }}>
            {candidates.map((c, i) => {
              if (removing.has(i)) return null;
              return (
                <div
                  key={i}
                  className="list__item"
                  style={{
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    boxShadow: 'var(--shadow-xs)',
                    opacity: removing.has(i) ? 0 : 1,
                    transition: 'opacity 0.2s',
                    background: 'rgba(255,255,255,0.9)',
                    padding: '8px 10px',
                    minHeight: 44,
                  }}
                >
                  <div
                    className="list__icon"
                    style={{
                      background: c.type === 'income' ? 'rgba(7,202,107,0.14)' : 'rgba(255,255,255,0.55)',
                      fontSize: 16,
                      width: 32, height: 32,
                    }}
                  >
                    {c.source === 'sms' ? '✉️' : c.source === 'notification' ? '🔔' : '📋'}
                  </div>
                  <div className="list__main" style={{ minWidth: 0 }}>
                    <div className="list__title" style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.merchant || c.note || c.raw.slice(0, 12)}</span>
                      {c.category && (
                        <span className="chip chip--volt" style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }}>{c.category}</span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, flexShrink: 0 }}>
                        {(c.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="list__meta" style={{ fontSize: 11 }}>
                      {(c.occurred_at || '').slice(0, 16)} · {c.source === 'sms' ? '短信' : c.source === 'notification' ? '通知' : '粘贴'}
                    </div>
                  </div>
                  <div className={`list__amount ${c.type === 'income' ? 'list__amount--income' : 'list__amount--expense'}`} style={{ fontSize: 13 }}>
                    {c.type === 'expense' ? '-' : '+'}{fmtMoney((c.amount || 0) / 100)}
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => removeAt(i)} style={{ padding: '2px 6px', minWidth: 28 }}>✕</button>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button className="btn btn--primary btn--sm" onClick={onConfirm}>
              全部确认入账
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TabBtn({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="btn"
      style={{
        flex: 1,
        background: active ? '#fff' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-secondary)',
        fontWeight: active ? 700 : 500,
        boxShadow: active ? 'var(--shadow-sm)' : 'none',
        padding: '6px 8px',
        fontSize: 13,
      }}
    >
      <span style={{ marginRight: 4 }}>{icon}</span>{children}
    </button>
  );
}
