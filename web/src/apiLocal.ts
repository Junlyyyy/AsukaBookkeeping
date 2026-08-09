// 本地离线数据层 — localStorage 实现与后端完全相同的接口签名与数据模型
// 当 API（localhost:3001）不可达时自动切换（APK/离线场景），数据保存在本机 localStorage
// 金额以「分」存储（与后端一致），API 输入输出为「元」

import type {
  Account, AnalyticsSummary, Budget, Category, Ledger, LedgerStats,
  Tag, Transaction, TxCandidate, TxListResponse,
} from './types';

const DB_KEY = 'asuka_db_v1';

interface DB {
  ledgers: any[];
  accounts: any[];
  categories: any[];
  tags: any[];
  transactions: any[];
  transaction_tags: { transaction_id: number; tag_id: number }[];
  budgets: any[];
  seq: number;
}

let _db: DB | null = null;
// 本地时间字符串（YYYY-MM-DD HH:mm:ss）—— 与后端 SQLite datetime('now','localtime') 一致；
// 不能用 toISOString()（UTC），否则时间显示差 8 小时、凌晨记账跨天
const now = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
};

function load(): DB {
  if (_db) return _db;
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try { _db = JSON.parse(raw); return _db!; } catch { /* fallthrough */ }
  }
  // 正式版：不写任何示例数据。首次打开 app 数据完全为空，
  // 由用户主动创建第一个账本 + 分类 + 账户。
  _db = { ledgers: [], accounts: [], categories: [], tags: [], transactions: [], transaction_tags: [], budgets: [], seq: 1 };
  save();
  return _db;
}

function save() { if (_db) localStorage.setItem(DB_KEY, JSON.stringify(_db)); }
function nextId(db: DB): number { return db.seq++; }
const yuan = (cents: number) => Number((cents / 100).toFixed(2));
const cents = (y: number) => Math.round(Number(y) * 100);
const txSqlDate = (d: string) => d.replace('T', ' ');

// ---- 内部工具 ----
function serializeTx(db: DB, t: any) {
  const acct = db.accounts.find((a) => a.id === t.account_id);
  const cat = db.categories.find((c) => c.id === t.category_id);
  const tags = db.transaction_tags
    .filter((tt) => tt.transaction_id === t.id)
    .map((tt) => db.tags.find((tg) => tg.id === tt.tag_id))
    .filter(Boolean)
    .map((tg: any) => ({ id: tg.id, name: tg.name }));
  return {
    id: t.id, ledger_id: t.ledger_id, type: t.type, amount: yuan(t.amount),
    note: t.note, occurred_at: t.occurred_at, status: t.status,
    account: acct ? { id: acct.id, name: acct.name, type: acct.type } : null,
    category: cat ? { id: cat.id, name: cat.name, icon: cat.icon, type: cat.type } : null,
    tags, created_at: t.created_at, updated_at: t.updated_at,
  };
}

function activeLedgerId(db: DB): number | null {
  const l = db.ledgers.find((x) => x.is_active === 1);
  return l ? l.id : (db.ledgers[0]?.id ?? null);
}

// ---- 本地实现（签名与 web/src/api.ts 完全一致）----
export const localApi = {
  // 账本
  ledgers: (): Promise<Ledger[]> => {
    const db = load();
    return Promise.resolve(db.ledgers.map((l) => ({
      ...l,
      tx_count: db.transactions.filter((t) => t.ledger_id === l.id && t.status === 'active').length,
      account_count: db.accounts.filter((a) => a.ledger_id === l.id).length,
      category_count: db.categories.filter((c) => c.ledger_id === l.id).length,
    })));
  },
  activeLedger: (): Promise<Ledger> => {
    const db = load();
    const id = activeLedgerId(db);
    const l = db.ledgers.find((x) => x.id === id);
    if (!l) return Promise.reject(new Error('no active ledger'));
    return Promise.resolve({ ...l });
  },
  createLedger: (name: string, currency = 'CNY'): Promise<Ledger> => {
    const db = load();
    const l = { id: nextId(db), name, currency, is_active: 0, created_at: now(), updated_at: now() };
    db.ledgers.push(l); save();
    return Promise.resolve(l);
  },
  setActiveLedger: (id: number): Promise<{ ok: boolean }> => {
    const db = load();
    db.ledgers.forEach((l) => { l.is_active = l.id === id ? 1 : 0; l.updated_at = now(); });
    save();
    return Promise.resolve({ ok: true });
  },
  ledgerStats: (id: number): Promise<LedgerStats> => {
    const db = load();
    const txs = db.transactions.filter((t) => t.ledger_id === id && t.status === 'active');
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    return Promise.resolve({
      ledger_id: id,
      tx_count: txs.length,
      expense: yuan(expense), income: yuan(income),
      category_count: db.categories.filter((c) => c.ledger_id === id).length,
      account_count: db.accounts.filter((a) => a.ledger_id === id).length,
      tag_count: db.tags.filter((t) => t.ledger_id === id).length,
      budget_count: db.budgets.filter((b) => b.ledger_id === id).length,
    });
  },

  // 交易
  listTransactions: (params: Record<string, string | number | undefined>): Promise<TxListResponse> => {
    const db = load();
    const {
      ledger_id, date_from, date_to, category_id, account_id,
      q, amount_min, amount_max, type, tag_id, limit = 200,
    } = params;
    let items = db.transactions.filter((t) => t.status !== 'deleted');
    if (ledger_id) items = items.filter((t) => t.ledger_id === Number(ledger_id));
    if (date_from) items = items.filter((t) => t.occurred_at >= `${date_from} 00:00:00`);
    if (date_to) items = items.filter((t) => t.occurred_at <= `${date_to} 23:59:59`);
    if (category_id) items = items.filter((t) => t.category_id === Number(category_id));
    if (account_id) items = items.filter((t) => t.account_id === Number(account_id));
    if (type) items = items.filter((t) => t.type === type);
    if (amount_min) items = items.filter((t) => t.amount >= cents(Number(amount_min)));
    if (amount_max) items = items.filter((t) => t.amount <= cents(Number(amount_max)));
    if (q) {
      const s = String(q).toLowerCase();
      items = items.filter((t) => {
        const cat = db.categories.find((c) => c.id === t.category_id);
        const acct = db.accounts.find((a) => a.id === t.account_id);
        return (t.note || '').toLowerCase().includes(s)
          || (cat?.name || '').toLowerCase().includes(s)
          || (acct?.name || '').toLowerCase().includes(s);
      });
    }
    if (tag_id) items = items.filter((t) => db.transaction_tags.some((tt) => tt.transaction_id === t.id && tt.tag_id === Number(tag_id)));
    items = [...items].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    const sliced = items.slice(0, Math.min(Number(limit) || 200, 1000));
    const expense = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const income = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    return Promise.resolve({
      items: sliced.map((t) => serializeTx(db, t)),
      total: { expense: yuan(expense), income: yuan(income) },
      limit: Math.min(Number(limit) || 200, 1000), offset: 0,
    });
  },
  getTransaction: (id: number): Promise<Transaction> => {
    const db = load();
    const t = db.transactions.find((x) => x.id === id);
    if (!t) return Promise.reject(new Error('transaction not found'));
    return Promise.resolve(serializeTx(db, t));
  },
  createTransaction: (body: Record<string, unknown>): Promise<Transaction> => {
    const db = load();
    const t: any = {
      id: nextId(db),
      ledger_id: Number(body.ledger_id),
      account_id: body.account_id ? Number(body.account_id) : null,
      category_id: body.category_id ? Number(body.category_id) : null,
      type: body.type || 'expense',
      amount: cents(Number(body.amount)),
      note: String(body.note || '').trim(),
      occurred_at: txSqlDate(String(body.occurred_at || now())),
      status: 'active', created_at: now(), updated_at: now(),
    };
    db.transactions.push(t);
    (body.tag_ids as number[] || []).forEach((tid) => db.transaction_tags.push({ transaction_id: t.id, tag_id: Number(tid) }));
    save();
    return Promise.resolve(serializeTx(db, t));
  },
  createTransactions: (items: Record<string, unknown>[]): Promise<{ created: number; items: Transaction[] }> => {
    const db = load();
    const created: Transaction[] = [];
    items.forEach((it) => {
      const t: any = {
        id: nextId(db),
        ledger_id: Number(it.ledger_id),
        account_id: it.account_id ? Number(it.account_id) : null,
        category_id: it.category_id ? Number(it.category_id) : null,
        type: it.type || 'expense',
        amount: cents(Number(it.amount)),
        note: String(it.note || '').trim(),
        occurred_at: txSqlDate(String(it.occurred_at || now())),
        status: 'active', created_at: now(), updated_at: now(),
      };
      db.transactions.push(t);
      (it.tag_ids as number[] || []).forEach((tid) => db.transaction_tags.push({ transaction_id: t.id, tag_id: Number(tid) }));
      created.push(serializeTx(db, t));
    });
    save();
    return Promise.resolve({ created: created.length, items: created });
  },
  updateTransaction: (id: number, body: Record<string, unknown>): Promise<Transaction> => {
    const db = load();
    const t = db.transactions.find((x) => x.id === id);
    if (!t) return Promise.reject(new Error('transaction not found'));
    const upd: Record<string, (v: any) => void> = {
      ledger_id: (v) => (t.ledger_id = Number(v)),
      account_id: (v) => (t.account_id = v === null || v === undefined ? null : Number(v)),
      category_id: (v) => (t.category_id = v === null || v === undefined ? null : Number(v)),
      type: (v) => (t.type = v),
      amount: (v) => (t.amount = cents(Number(v))),
      note: (v) => (t.note = String(v).trim()),
      occurred_at: (v) => (t.occurred_at = txSqlDate(String(v))),
    };
    Object.entries(upd).forEach(([k, fn]) => { if (k in body) fn(body[k]); });
    if ('tag_ids' in body) {
      db.transaction_tags = db.transaction_tags.filter((tt) => tt.transaction_id !== id);
      (body.tag_ids as number[] || []).forEach((tid) => db.transaction_tags.push({ transaction_id: id, tag_id: Number(tid) }));
    }
    t.updated_at = now();
    save();
    return Promise.resolve(serializeTx(db, t));
  },
  deleteTransaction: (id: number, confirm = false): Promise<unknown> => {
    const db = load();
    const t = db.transactions.find((x) => x.id === id);
    if (!t) return Promise.reject(new Error('transaction not found'));
    if (!confirm) {
      if (t.status === 'pending_delete') return Promise.resolve({ status: 'pending_delete', message: '已待删除', transaction_id: id });
      t.status = 'pending_delete'; save();
      return Promise.resolve({ status: 'pending_confirmation', message: '删除需要二次确认', transaction_id: id });
    }
    db.transactions = db.transactions.filter((x) => x.id !== id);
    db.transaction_tags = db.transaction_tags.filter((tt) => tt.transaction_id !== id);
    save();
    return Promise.resolve({ ok: true, deleted: id });
  },
  parseTransaction: (text: string, ledger_id: number): Promise<Transaction & { parsed?: unknown }> => {
    const db = load();
    const s = String(text).trim();
    let amountYuan: number | null = null;
    const m1 = s.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱|¥|￥)/);
    const m2 = s.match(/(\d+)\s*块\s*(\d+)\s*(?:毛|角)?/);
    const m3 = s.match(/(\d+(?:\.\d+)?)\s*$/);
    if (m2) amountYuan = Number(m2[1]) + Number(m2[2]) / 10;
    else if (m1) amountYuan = Number(m1[1]);
    else if (m3) amountYuan = Number(m3[1]);
    if (amountYuan === null || amountYuan <= 0) return Promise.reject(new Error('未识别到金额'));
    const kw: [string, string[]][] = [
      ['餐饮', ['餐', '饭', '咖啡', '奶茶', '外卖', '吃', '面', '火锅', '星巴克']],
      ['交通', ['车', '地铁', '打车', '公交', '油', '停车']],
      ['购物', ['买', '购', '超市', '衣服', '鞋', '数码']],
      ['娱乐', ['电影', '游戏', 'KTV']],
      ['医疗', ['药', '医院', '挂号', '体检']],
      ['通讯', ['话费', '流量', '宽带']],
      ['人情', ['红包', '礼物', '请客']],
    ];
    let catName: string | null = null;
    for (const [cn, words] of kw) if (words.some((w) => s.includes(w))) { catName = cn; break; }
    const cat = catName ? db.categories.find((c) => c.ledger_id === ledger_id && c.name === catName) : undefined;
    const defCat = db.categories.find((c) => c.ledger_id === ledger_id && c.type === 'expense');
    const t: any = {
      id: nextId(db), ledger_id, category_id: (cat || defCat)?.id ?? null,
      account_id: null, type: 'expense', amount: Math.round(amountYuan * 100),
      note: s.replace(/(昨天|前天)\s*/, '').slice(0, 50),
      occurred_at: now(), status: 'active', created_at: now(), updated_at: now(),
    };
    db.transactions.push(t); save();
    return Promise.resolve({ ...serializeTx(db, t), parsed: { amount: amountYuan, category: cat?.name || defCat?.name || null } });
  },

  // 自动抓取消费记录 — 解析候选（与后端 /transactions/fetch 规则一致，不落库）
  fetchTransactionCandidates: (text: string, ledger_id: number): Promise<{ count: number; items: TxCandidate[] }> => {
    const db = load();
    const chunks = String(text).split(/[\n;；、]+/).map((s) => s.trim()).filter(Boolean);
    const now = new Date();
    const seen = new Set();
    const items: TxCandidate[] = [];
    for (const chunk of chunks) {
      const c = parseCandidate(chunk, now);
      if (!c) continue;
      const key = `${c.amount}|${c.note}|${c.occurred_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cat = classifyLocal(chunk, db, Number(ledger_id));
      items.push({ ...c, category: cat });
    }
    return Promise.resolve({ count: items.length, items });
  },

  // 分类 / 账户 / 标签
  categories: (params?: Record<string, string | number>): Promise<Category[]> => {
    const db = load();
    let items = [...db.categories];
    if (params?.type) items = items.filter((c) => c.type === String(params.type));
    if (params?.ledger_id) items = items.filter((c) => c.ledger_id === Number(params.ledger_id));
    return Promise.resolve(items);
  },
  createCategory: (body: Record<string, unknown>): Promise<Category> => {
    const db = load();
    const c: any = {
      id: nextId(db), ledger_id: Number(body.ledger_id), name: String(body.name).trim(),
      type: body.type || 'expense', icon: String(body.icon || '▣'),
      sort_order: db.categories.filter((x) => x.ledger_id === Number(body.ledger_id) && x.type === (body.type || 'expense')).length,
      created_at: now(),
    };
    db.categories.push(c); save();
    return Promise.resolve(c);
  },
  accounts: (params?: Record<string, string | number>): Promise<Account[]> => {
    const db = load();
    let items = [...db.accounts];
    if (params?.type) items = items.filter((a) => a.type === String(params.type));
    if (params?.ledger_id) items = items.filter((a) => a.ledger_id === Number(params.ledger_id));
    return Promise.resolve(items.map((a) => ({ ...a, balance: yuan(a.balance) })));
  },
  createAccount: (body: Record<string, unknown>): Promise<Account> => {
    const db = load();
    const a: any = {
      id: nextId(db), ledger_id: Number(body.ledger_id), name: String(body.name).trim(),
      type: body.type || 'cash', balance: cents(Number(body.balance) || 0), created_at: now(),
    };
    db.accounts.push(a); save();
    return Promise.resolve({ ...a, balance: yuan(a.balance) });
  },
  tags: (ledger_id?: number): Promise<Tag[]> => {
    const db = load();
    let items = [...db.tags];
    if (ledger_id) items = items.filter((t) => t.ledger_id === ledger_id);
    return Promise.resolve(items.map((t) => ({
      ...t,
      tx_count: db.transaction_tags.filter((tt) => tt.tag_id === t.id).length,
    })));
  },
  createTag: (ledger_id: number, name: string): Promise<Tag> => {
    const db = load();
    if (db.tags.some((t) => t.ledger_id === ledger_id && t.name === name)) return Promise.reject(new Error('tag exists'));
    const t = { id: nextId(db), ledger_id, name, created_at: now() };
    db.tags.push(t); save();
    return Promise.resolve(t);
  },

  // 预算
  budgets: (ledger_id?: number): Promise<{ year: number; month: number; items: Budget[] }> => {
    const db = load();
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    let items = [...db.budgets];
    if (ledger_id) items = items.filter((b) => b.ledger_id === ledger_id);
    const out = items.map((b) => {
      const cat = db.categories.find((c) => c.id === b.category_id);
      const spent = db.transactions
        .filter((t) => t.category_id === b.category_id && t.type === 'expense' && t.status === 'active'
          && String(t.occurred_at).startsWith(key))
        .reduce((s, t) => s + t.amount, 0);
      const s = spent / 100, a = b.amount / 100;
      return {
        ...b, category_name: cat?.name, category_icon: cat?.icon, category_type: cat?.type,
        amount: Number(a.toFixed(2)), spent: Number(s.toFixed(2)),
        progress: a > 0 ? Math.min(Math.round((s / a) * 100), 999) : 0,
        remaining: Number((a - s).toFixed(2)),
      };
    });
    return Promise.resolve({ year: y, month: m, items: out as Budget[] });
  },
  updateBudget: (id: number, body: Record<string, unknown>): Promise<Budget> => {
    const db = load();
    const b = db.budgets.find((x) => x.id === id);
    if (!b) return Promise.reject(new Error('budget not found'));
    if (body.amount !== undefined) b.amount = cents(Number(body.amount));
    if (body.period) b.period = body.period;
    if (body.year) b.year = Number(body.year);
    if (body.month !== undefined) b.month = body.month === null ? null : Number(body.month);
    b.updated_at = now(); save();
    return Promise.resolve({ ...b, amount: yuan(b.amount) } as Budget);
  },
  createBudget: (body: Record<string, unknown>): Promise<Budget> => {
    const db = load();
    const b: any = {
      id: nextId(db), ledger_id: Number(body.ledger_id), category_id: Number(body.category_id),
      amount: cents(Number(body.amount)), period: 'monthly',
      year: Number(body.year) || new Date().getFullYear(), month: body.month || new Date().getMonth() + 1,
      created_at: now(), updated_at: now(),
    };
    db.budgets.push(b); save();
    return Promise.resolve({ ...b, amount: yuan(b.amount) } as Budget);
  },
  deleteBudget: (id: number): Promise<{ ok: boolean }> => {
    const db = load();
    db.budgets = db.budgets.filter((b) => b.id !== id); save();
    return Promise.resolve({ ok: true });
  },

  // 统计 / 搜索
  analytics: (params: Record<string, string | number | undefined>): Promise<AnalyticsSummary> => {
    const db = load();
    const { scope = 'month', year, month, ledger_id } = params;
    const d = new Date();
    const y = year ? Number(year) : d.getFullYear();
    const m = month ? Number(month) : d.getMonth() + 1;
    let txs = db.transactions.filter((t) => t.status === 'active');
    if (ledger_id) txs = txs.filter((t) => t.ledger_id === Number(ledger_id));
    if (scope === 'month') txs = txs.filter((t) => String(t.occurred_at).startsWith(`${y}-${String(m).padStart(2, '0')}`));
    else if (scope === 'year') txs = txs.filter((t) => String(t.occurred_at).startsWith(String(y)));
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const byCat = (type: string) => {
      const map = new Map<number, { amount: number; count: number }>();
      txs.filter((t) => t.type === type).forEach((t) => {
        const e = map.get(t.category_id) || { amount: 0, count: 0 };
        e.amount += t.amount; e.count += 1; map.set(t.category_id, e);
      });
      return [...map.entries()]
        .map(([cid, e]) => {
          const c = db.categories.find((x) => x.id === cid);
          return { id: cid, name: c?.name || '未分类', icon: c?.icon || '▣', amount: yuan(e.amount), count: e.count };
        })
        .sort((a, b) => b.amount - a.amount)
        .slice(0, type === 'expense' ? 8 : 5);
    };
    const daily = Array.from({ length: 30 }).map((_, i) => {
      const dd = new Date(d.getTime() - (29 - i) * 86400000);
      const key = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
      const day = txs.filter((t) => String(t.occurred_at).startsWith(key));
      return {
        date: key,
        income: yuan(day.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)),
        expense: yuan(day.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)),
      };
    });
    return Promise.resolve({
      scope: String(scope), year: y, month: m,
      income: yuan(income), expense: yuan(expense), balance: yuan(income - expense),
      tx_count: txs.length,
      top_expense: byCat('expense'),
      top_income: byCat('income'),
      daily,
    });
  },
  search: (q: string, ledger_id?: number): Promise<{ query: string; count: number; items: Transaction[] }> => {
    const db = load();
    const s = String(q).toLowerCase();
    let items = db.transactions.filter((t) => t.status === 'active');
    if (ledger_id) items = items.filter((t) => t.ledger_id === ledger_id);
    const out = items.filter((t) => {
      const cat = db.categories.find((c) => c.id === t.category_id);
      const acct = db.accounts.find((a) => a.id === t.account_id);
      return (t.note || '').toLowerCase().includes(s)
        || (cat?.name || '').toLowerCase().includes(s)
        || (acct?.name || '').toLowerCase().includes(s);
    }).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)).slice(0, 50);
    return Promise.resolve({ query: q, count: out.length, items: out.map((t) => serializeTx(db, t)) });
  },
};

/** 探测 API 是否可用（APK/离线场景自动切换到本地层） */
export async function detectMode(): Promise<'remote' | 'local'> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/v1/health', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) return 'remote';
    return 'local';
  } catch {
    return 'local';
  }
}

// ---- 自动抓取解析辅助（与后端规则一致，供本地离线模式复用）----

function parseCandidate(s: string, now: Date): Omit<TxCandidate, 'category'> | null {
  let amountYuan = null;
  const mY = s.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
  const mYuan = s.match(/(?:支付|消费|付款|转入|支出|收款|收入|到账|入账|交易|扣款|花费|支付金额)\s*(\d+(?:\.\d{1,2})?)\s*元/);
  const mPlain = s.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块)/);
  const mFen = s.match(/(\d+)\s*块\s*(\d+)\s*(?:毛|角)?/);
  if (mY) amountYuan = Number(mY[1]);
  else if (mYuan) amountYuan = Number(mYuan[1]);
  else if (mFen) amountYuan = Number(mFen[1]) + Number(mFen[2]) / 10;
  else if (mPlain) amountYuan = Number(mPlain[1]);
  if (amountYuan === null || amountYuan <= 0) return null;

  const incomeWords = ['收款', '收入', '转入', '到账', '入账', '收到', '+'];
  const expenseWords = ['支付', '消费', '付款', '支出', '扣款', '花费', '交易', '-'];
  let type: 'expense' | 'income' = 'expense';
  if (incomeWords.some((w) => s.includes(w)) && !expenseWords.some((w) => s.includes(w))) type = 'income';
  else if (expenseWords.some((w) => s.includes(w))) type = 'expense';

  let note = '';
  const mMerchant = s.match(/(?:在|向|支付给|付款给|转入|收自|来自)\s*([\u4e00-\u9fa5A-Za-z0-9·]{1,18}?)(?:[（(]|消费|支付|付款|\.|$)/);
  if (mMerchant) note = mMerchant[1].trim();
  if (!note) {
    const cleaned = s
      .replace(/^【[^】]*】/, '')
      .replace(/[¥￥]\s*\d+(?:\.\d{1,2})?/, '')
      .replace(/(?:支付|消费|付款|收款|交易|到账|入账|扣款|转入|收入|支出|花费|支付金额)\s*\d+(?:\.\d{1,2})?\s*元/, '')
      .replace(/[。.]\s*$/, '')
      .trim();
    if (cleaned && cleaned.length <= 30) note = cleaned;
  }
  note = (note || '自动抓取').slice(0, 50);

  // 默认「今天」；相对/绝对日期统一按本地时间存储（与带日期分支一致）
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  let occurredAt = toLocal(now);
  const rel = (days: number) => toLocal(new Date(now.getTime() - days * 86400000));
  const mDate = s.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[时:：](\d{1,2})分?/);
  const mDateOnly = s.match(/(\d{1,2})月(\d{1,2})日/);
  const mTime = s.match(/(\d{1,2})[时:：](\d{1,2})分?/);
  if (/昨天/.test(s)) occurredAt = rel(1);
  else if (/前天/.test(s)) occurredAt = rel(2);
  else if (mDate) {
    const d = new Date(now.getFullYear(), Number(mDate[1]) - 1, Number(mDate[2]), Number(mDate[3]), Number(mDate[4]), 0);
    occurredAt = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  } else if (mDateOnly) {
    const d = new Date(now.getFullYear(), Number(mDateOnly[1]) - 1, Number(mDateOnly[2]), now.getHours(), now.getMinutes(), 0);
    occurredAt = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  } else if (mTime && /今天|今日|本日/.test(s)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(mTime[1]), Number(mTime[2]), 0);
    occurredAt = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  }

  return { type, amount: Number(amountYuan.toFixed(2)), note, occurred_at: occurredAt, raw: s.slice(0, 80) };
}

function classifyLocal(text: string, db: DB, ledgerId: number): { id: number; name: string } | null {
  const kw: [string, string[]][] = [
    ['餐饮', ['餐', '饭', '咖啡', '奶茶', '外卖', '吃', '面', '烧烤', '火锅', '星巴克', '麦当劳', '肯德基', '便利']],
    ['交通', ['车', '地铁', '打车', '公交', '油', '停车', '高铁', '机票', '滴滴']],
    ['购物', ['买', '购', '超市', '衣服', '鞋', '数码', '淘宝', '京东', '天猫']],
    ['娱乐', ['电影', '游戏', 'KTV', '娱乐', '演出', '视频']],
    ['医疗', ['药', '医院', '诊所', '挂号', '体检']],
    ['通讯', ['话费', '流量', '宽带', '充值', '移动', '联通', '电信']],
    ['教育', ['书', '课', '学费', '培训']],
    ['人情', ['红包', '礼物', '请客']],
    ['居住', ['房租', '物业', '水电', '燃气', '住房']],
  ];
  let catName = null;
  for (const [cn, words] of kw) {
    if (words.some((w) => text.includes(w))) { catName = cn; break; }
  }
  if (!catName) return null;
  const cat = db.categories.find((c) => c.ledger_id === ledgerId && c.name === catName && c.type === 'expense');
  return cat ? { id: cat.id, name: cat.name } : null;
}
