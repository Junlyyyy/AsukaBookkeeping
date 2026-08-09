// 自动抓取消费记录 — 两种来源共用一个候选入账面板
//
// 1. 通知监听（统一一个 tab）：
//    - NotificationListenerService：实时捕获微信支付/支付宝/各银行 App 的付款收款通知
//    - readRecentSms：一次性扫描所有短信收件箱，识别消费短信
// 2. 导入账单：选择微信（.xlsx / .json）/ 支付宝（.csv）账单文件 → 解析为多条候选
//
// 三路产物统一映射为 { amount, category, type, occurred_at, note, source, raw } 候选，
// 一次性入账到本地 SQLite。

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import AsukaCapture from '../lib/asuka-capture';
import type { NotificationPayload } from '../lib/asuka-capture';
import {
  parseSmsBatch, parseNotification, parseNotificationBatch,
  type ParsedTx,
} from '../lib/autoParse';
import { Modal, toast, fmtMoney } from './ui';
import { api } from '../api';
import { useApp } from '../store';

type Tab = 'notification' | 'paste';

interface CandidateItem extends ParsedTx {
  raw: string;          // 用于 UI 展示的原文
  source: 'sms' | 'notification' | 'paste';
  /** 导入账单时区分来源（仅 UI 展示用） */
  billSrc?: 'wechat' | 'alipay' | 'paste';
}

export default function AutoCapture({ onClose, onImported }: {
  onClose: () => void;
  onImported?: (count: number) => void;
}) {
  const { ledger } = useApp();
  const [tab, setTab] = useState<Tab>('notification');
  const [smsState, setSmsState] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [notifAccessGranted, setNotifAccessGranted] = useState<boolean | null>(null);
  const [billFile, setBillFile] = useState<{ name: string; count: number; skipped: number } | null>(null);
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
      const arr = parseNotificationBatch([payload]);
      const r = arr[0];
      if (r && r.amount) {
        setCandidates((prev) => [
          { ...r, raw: payload.body, source: 'notification' } as CandidateItem,
          ...prev,
        ]);
      }
    }).then((h) => { if (alive) detach = h.remove; }).catch(() => {});
    return () => { alive = false; if (detach) void detach(); };
  }, []);

  /* =============== 一次性扫描所有短信 =============== */
  const onScanSms = async () => {
    if (!ledger) return;
    setSmsState('scanning');
    try {
      // sinceMs = 0：让 native 从 epoch 开始查询（扫描收件箱里所有短信）
      const r = await AsukaCapture.readRecentSms({ sinceMs: 0 });
      const items = parseSmsBatch(r.items);
      const next: CandidateItem[] = items.map((it, i) => ({
        ...it,
        raw: `${r.items[i]?.sender || ''} ${r.items[i]?.body || ''}`.slice(0, 80),
        source: 'sms',
      }));
      setCandidates((prev) => [...next, ...prev]);
      toast(`扫描到 ${r.count} 条短信，识别出 ${items.length} 条消费`);
      setSmsState('done');
    } catch (e) {
      toast(String((e as Error).message || '扫描失败'), 'err');
      setSmsState('idle');
    }
  };

  /* =============== 通知监听设置 =============== */
  const onOpenNotificationSettings = async () => {
    try {
      await AsukaCapture.openNotificationAccessSettings();
      toast('已打开「通知使用权」设置，勾选 Asuka记账 后返回', 'ok');
      setTimeout(async () => {
        const r = await AsukaCapture.isNotificationAccessGranted();
        setNotifAccessGranted(r.granted);
        if (r.granted) toast('通知监听已启用 ✓');
      }, 1500);
    } catch (e) { toast(String((e as Error).message || '跳转失败'), 'err'); }
  };

  /* =============== 导入账单文件 =============== */
  const onImportFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.xlsx')) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) return toast('xlsx 无可读 sheet', 'err');
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
        addWechatXlsxBatch(rows, file.name);
      } else if (lower.endsWith('.json')) {
        const text = await file.text();
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('根节点不是数组');
        addWechatBatch(arr, file.name);
      } else if (lower.endsWith('.csv')) {
        const text = await file.text();
        addAlipayBatch(text, file.name);
      } else {
        toast('暂不支持此格式，请用 .xlsx/.json（微信账单）或 .csv（支付宝账单）', 'err');
      }
    } catch (e) {
      toast(`解析失败: ${(e as Error).message}`, 'err');
    }
  };

  /* 微信（xlsx）— 形如：
     [ [标题行...], [交易类型|交易对方|商品|收/支|金额...],
       ['','微信支付-xxx','xx','支出','-128.00',...],
       ...
     ]
     自动找含「交易时间」+「收/支」+「金额」三列的行当表头 */
  const addWechatXlsxBatch = (rows: any[][], srcName: string) => {
    // 1) 找表头
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const cells = (rows[i] || []).map((c) => String(c || '').trim());
      if (cells.includes('交易时间') && cells.includes('收/支') && cells.some((c) => /金额/.test(c))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return toast('找不到微信表头（需含"交易时间/收/支/金额"）', 'err');

    const header = (rows[headerIdx] || []).map((c) => String(c || '').trim());
    const COL: Record<string, number> = {};
    header.forEach((h, i) => { if (h) COL[h] = i; });

    // 微信 xlsx 实际列：交易时间 / 交易类型 / 交易对方 / 商品 / 收/支 / 金额(元) / 支付方式 / 当前状态 / 交易单号 / 商户单号 / 备注
    const pickCol = (...names: string[]): number | undefined => {
      for (const n of names) {
        for (const k of Object.keys(COL)) {
          if (k === n || k.replace(/\(元\)$/, '').trim() === n.replace(/\(元\)$/, '').trim()) return COL[k];
        }
      }
      return undefined;
    };
    const COL_TIME = pickCol('交易时间');
    const COL_FLAG = pickCol('收/支');
    const COL_AMT = pickCol('金额(元)', '金额');
    const COL_CPARTY = pickCol('交易对方');
    const COL_GOODS = pickCol('商品');
    const COL_TYPE = pickCol('交易类型');
    const COL_REMARK = pickCol('备注');
    if (COL_TIME == null || COL_FLAG == null || COL_AMT == null) {
      return toast('缺关键列（交易时间/收/支/金额）', 'err');
    }

    // 时间归一化：xlsx cell 可能是 Date / 数字（Excel serial） / 字符串
    const excelSerialToDate = (n: number): Date => {
      // 1900-based, 跳过 1900-02-29 假日期
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + n * 86400 * 1000);
    };
    const normTime = (v: any): string => {
      if (v == null || v === '') return '';
      if (v instanceof Date) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        const hh = String(v.getHours()).padStart(2, '0');
        const mm = String(v.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}:00`;
      }
      if (typeof v === 'number') {
        const d = excelSerialToDate(v);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `${y}-${m}-${dd} ${hh}:${mm}:00`;
      }
      const s = String(v).trim();
      // 已经是 YYYY-MM-DD HH:MM[:SS]
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return s.length === 16 ? s + ':00' : s;
      return s;
    };
    const normAmount = (v: any): number => {
      if (v == null || v === '') return NaN;
      if (typeof v === 'number') return v;
      const s = String(v).replace(/[¥￥,，\s]/g, '');
      if (s === '' || s === '/') return NaN;
      return parseFloat(s);
    };
    const mapType = (flag: string): 'income' | 'expense' | null => {
      const f = String(flag || '').trim();
      if (f === '支出') return 'expense';
      if (f === '收入') return 'income';
      if (f === '/' || f === '') return null; // 中性 / 未知
      return 'expense';
    };

    const items: CandidateItem[] = [];
    let skipped = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const flag = String(row[COL_FLAG] || '').trim();
      const type = mapType(flag);
      if (type == null) { skipped++; continue; }
      const amt = Math.abs(normAmount(row[COL_AMT]));
      if (!Number.isFinite(amt) || amt <= 0) { skipped++; continue; }
      const occurred_at = normTime(row[COL_TIME]);
      const parts: string[] = [];
      const cparty = String(row[COL_CPARTY ?? -1] || '').trim();
      const goods = String(row[COL_GOODS ?? -1] || '').trim();
      const txType = String(row[COL_TYPE ?? -1] || '').trim();
      const remark = String(row[COL_REMARK ?? -1] || '').trim();
      if (cparty && cparty !== '/') parts.push(cparty);
      if (goods && goods !== '/') parts.push(goods);
      if (txType && txType !== '/') parts.push(txType);
      if (remark && remark !== '/') parts.push(remark);
      const note = parts.join(' / ') || '微信';
      items.push({
        amount: Math.round(amt * 100),
        type,
        occurred_at: occurred_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        merchant: cparty !== '/' ? cparty : undefined,
        category: undefined,
        note,
        confidence: 0.95,
        source: 'paste',
        billSrc: 'wechat',
        raw: `${(occurred_at || '').slice(0, 10)} ${note}`.slice(0, 80),
      } as CandidateItem);
    }
    if (items.length === 0) return toast('未识别出任何有效交易', 'err');
    setCandidates((prev) => [...items, ...prev]);
    setBillFile({ name: srcName, count: items.length, skipped });
    toast(`已从「${srcName}」识别 ${items.length} 条候选`);
  };

  /* 微信（JSON）— 形如 [{ ledger_id, type, amount, note, occurred_at }, ...] */
  const addWechatBatch = (arr: any[], srcName: string) => {
    let skipped = 0;
    const items: CandidateItem[] = [];
    for (const t of arr) {
      const amt = Number(t.amount);
      if (!Number.isFinite(amt) || amt <= 0) { skipped++; continue; }
      items.push({
        amount: Math.round(amt * 100),
        type: t.type === 'income' ? 'income' : t.type === 'transfer' ? 'expense' : 'expense',
        occurred_at: t.occurred_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        merchant: undefined,
        category: undefined,
        note: t.note,
        confidence: 1.0,
        source: 'paste',
        billSrc: 'wechat',
        raw: (t.note || '').slice(0, 80) || srcName,
      } as CandidateItem);
    }
    if (items.length === 0) return toast('文件无有效交易', 'err');
    setCandidates((prev) => [...items, ...prev]);
    setBillFile({ name: srcName, count: items.length, skipped });
    toast(`已从「${srcName}」识别 ${items.length} 条候选`);
  };

  /* 支付宝（CSV）— 顶部 23 行为元数据，从含「交易时间,交易分类」的行开始是表头 */
  const addAlipayBatch = (text: string, srcName: string) => {
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      if (/交易时间/.test(lines[i]) && /交易分类/.test(lines[i])) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return toast('找不到支付宝表头（交易时间,交易分类）', 'err');

    const parseRow = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuote && c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
        if (c === '"') { inQuote = !inQuote; continue; }
        if (c === ',' && !inQuote) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push(cur);
      return out;
    };

    const header = parseRow(lines[headerIdx]).map((s) => s.trim());
    const COL: Record<string, number> = {};
    header.forEach((h, i) => { COL[h] = i; });

    const need = ['交易时间', '交易对方', '商品说明', '交易分类', '收/支', '金额', '交易状态'];
    for (const k of need) if (!(k in COL)) return toast(`缺字段: ${k}`, 'err');

    const mapType = (s: string): 'income' | 'expense' => s === '收入' ? 'income' : 'expense';

    const items: CandidateItem[] = [];
    let skipped = 0;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const row = parseRow(line);
      if (row.length < Object.keys(COL).length) { skipped++; continue; }
      const status = (row[COL['交易状态']] || '').trim();
      if (status && status !== '交易成功') { skipped++; continue; }
      const amountRaw = (row[COL['金额']] || '').trim();
      const amt = parseFloat(amountRaw);
      if (!Number.isFinite(amt) || amt <= 0) { skipped++; continue; }
      const occurred_at = (row[COL['交易时间']] || '').trim();
      const typeRaw = (row[COL['收/支']] || '').trim();
      const parts: string[] = [];
      ['交易对方', '商品说明', '交易分类', '备注'].forEach((k) => {
        const v = (row[COL[k]] || '').trim();
        if (v && !parts.includes(v)) parts.push(v);
      });
      const note = parts.join(' / ') || '支付宝';
      items.push({
        amount: Math.round(amt * 100),
        type: mapType(typeRaw),
        occurred_at: occurred_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        merchant: (row[COL['交易对方']] || '').trim() || undefined,
        category: undefined,
        note,
        confidence: 0.95,
        source: 'paste',
        billSrc: 'alipay',
        raw: `${occurred_at.slice(0, 10)} ${note}`.slice(0, 80),
      } as CandidateItem);
    }
    if (items.length === 0) return toast('未识别出任何有效交易', 'err');
    setCandidates((prev) => [...items, ...prev]);
    setBillFile({ name: srcName, count: items.length, skipped });
    toast(`已从「${srcName}」识别 ${items.length} 条候选`);
  };

  /* =============== 入账 =============== */
  const onConfirm = async () => {
    if (!ledger) return;
    const valid = candidates.filter((c) => !removing.has(candidates.indexOf(c)) && c.amount);
    if (valid.length === 0) return toast('没有可入账的候选', 'err');
    const body = valid.map((c) => ({
      ledger_id: ledger.id,
      type: c.type || 'expense',
      amount: c.amount as number,
      note: c.note || c.merchant || c.raw,
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
            MAGI 自动抓取 · 通知 + 短信实时解析
          </h2>
        </div>
      </div>

      {/* 两模式切换 tab */}
      <div className="row gap-2" style={{ marginBottom: 10, background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xs)', padding: 4 }}>
        <TabBtn active={tab === 'notification'} onClick={() => setTab('notification')} icon="🔔">通知监听</TabBtn>
        <TabBtn active={tab === 'paste'} onClick={() => setTab('paste')} icon="📥">导入账单</TabBtn>
      </div>

      {/* tab 内容 — 紧凑 */}
      <div style={{ marginBottom: 12 }}>
        {tab === 'notification' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.5 }}>
              自动监听来自微信支付、支付宝、各银行 App 的付款/收款通知，并可一次性扫描收件箱里所有短信的消费信息。
            </p>

            {/* 通知使用权 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className="btn btn--primary btn--sm" onClick={onOpenNotificationSettings}>
                打开「通知使用权」
              </button>
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: notifAccessGranted ? 'var(--success)' : 'var(--text-tertiary)',
              }}>
                {notifAccessGranted === null
                  ? '检测中…'
                  : notifAccessGranted
                    ? '● 通知监听已启用'
                    : '○ 通知未授权'}
              </span>
            </div>

            {/* 一次性扫描 SMS */}
            <div style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 10,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <button
                className="btn btn--primary btn--sm"
                onClick={onScanSms}
                disabled={smsState === 'scanning'}
              >
                {smsState === 'scanning' ? '扫描中…' : smsState === 'done' ? '再次扫描短信' : '扫描所有短信'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                · 权限 READ_SMS · 仅首次需要 · 仅本地解析不联网
              </span>
            </div>
          </div>
        )}

        {tab === 'paste' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
              选择微信（.xlsx / .json）或支付宝（.csv）账单文件，系统解析为候选。
            </p>
            <div style={{ marginBottom: 6 }}>
              <label className="btn btn--primary btn--sm" style={{ display: 'inline-block', cursor: 'pointer' }}>
                ⤴ 选择账单文件 (.xlsx / .csv / .json)
                <input
                  type="file"
                  accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {billFile && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
                  ✓ {billFile.name} · 识别 <b>{billFile.count}</b> 条{billFile.skipped > 0 && `（跳过 ${billFile.skipped}）`}
                </span>
              )}
            </div>
            {!billFile && (
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0', lineHeight: 1.5 }}>
                支持微信支付账单（.xlsx / .json）和支付宝账单（.csv 导出）；单文件最多识别 1000 笔。
              </p>
            )}
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
                    {c.source === 'sms' ? '✉️' : c.source === 'notification' ? '🔔'
                      : c.billSrc === 'wechat' ? '💚'
                      : c.billSrc === 'alipay' ? '💙'
                      : '📋'}
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
                      {(c.occurred_at || '').slice(0, 16)}
                      {' · '}
                      {c.source === 'sms' ? '短信' : c.source === 'notification' ? '通知'
                        : c.billSrc === 'wechat' ? '微信账单'
                        : c.billSrc === 'alipay' ? '支付宝账单'
                        : '粘贴'}
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
