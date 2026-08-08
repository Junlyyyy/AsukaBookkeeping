// API 客户端 — 支持远端（localhost:3001）/ 本地（localStorage）双模式自动切换
// 开发/网页环境走 /api（Vite 代理到 3001）；APK/离线场景 API 不可达时自动降级到本地数据层
// 两种模式接口签名、数据模型完全一致

import type {
  Account, AnalyticsSummary, Budget, Category, Ledger, LedgerStats,
  Tag, Transaction, TxCandidate, TxListResponse,
} from './types';
import { localApi } from './apiLocal';

const BASE = '/api/v1';

// ---- 模式管理（立即返回不阻塞 API；后台异步探测升级为远端）----
let mode: 'remote' | 'local' | 'unknown' = 'unknown';
let probeInFlight = false;

/** 立即返回当前模式。首次调用默认 'local'（APK/离线场景安全），避免阻塞 API 调用 */
export function ensureMode(): 'remote' | 'local' {
  if (mode === 'unknown') {
    mode = 'local'; // 默认本地优先（APK 内无后端；网页场景若无后端也回退到 local）
    if (!probeInFlight) {
      probeInFlight = true;
      void probeRemote();
    }
  }
  return mode;
}

async function probeRemote() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) mode = 'remote';
  } catch {
    /* stay local */
  }
}

export function setMode(m: 'remote' | 'local') { mode = m; probeInFlight = false; }
export function getMode() { return mode; }

// ---- 远端实现 ----
async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const remoteApi = {
  ledgers: () => req<Ledger[]>('/ledgers'),
  activeLedger: () => req<Ledger>('/ledgers/active'),
  createLedger: (name: string, currency = 'CNY') =>
    req<Ledger>('/ledgers', { method: 'POST', body: JSON.stringify({ name, currency }) }),
  setActiveLedger: (id: number) =>
    req<{ ok: boolean }>(`/ledgers/${id}/active`, { method: 'PUT' }),
  ledgerStats: (id: number) => req<LedgerStats>(`/ledgers/${id}/stats`),

  listTransactions: (params: Record<string, string | number | undefined>) =>
    req<TxListResponse>(`/transactions${qs(params)}`),
  getTransaction: (id: number) => req<Transaction>(`/transactions/${id}`),
  createTransaction: (body: Record<string, unknown>) =>
    req<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(body) }),
  createTransactions: (items: Record<string, unknown>[]) =>
    req<{ created: number; items: Transaction[] }>('/transactions/batch', { method: 'POST', body: JSON.stringify({ items }) }),
  updateTransaction: (id: number, body: Record<string, unknown>) =>
    req<Transaction>(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTransaction: (id: number, confirm = false) =>
    req<unknown>(`/transactions/${id}?confirm=${confirm ? 1 : 0}`, { method: 'DELETE' }),
  parseTransaction: (text: string, ledger_id: number) =>
    req<Transaction & { parsed?: unknown }>('/transactions/parse', {
      method: 'POST',
      body: JSON.stringify({ text, ledger_id }),
    }),
  fetchTransactionCandidates: (text: string, ledger_id: number) =>
    req<{ count: number; items: TxCandidate[] }>('/transactions/fetch', {
      method: 'POST',
      body: JSON.stringify({ text, ledger_id }),
    }),

  categories: (params?: Record<string, string | number>) =>
    req<Category[]>(`/categories${qs(params ?? {})}`),
  createCategory: (body: Record<string, unknown>) =>
    req<Category>('/categories', { method: 'POST', body: JSON.stringify(body) }),
  accounts: (params?: Record<string, string | number>) =>
    req<Account[]>(`/accounts${qs(params ?? {})}`),
  createAccount: (body: Record<string, unknown>) =>
    req<Account>('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  tags: (ledger_id?: number) => req<Tag[]>(`/tags${qs({ ledger_id })}`),
  createTag: (ledger_id: number, name: string) =>
    req<Tag>('/tags', { method: 'POST', body: JSON.stringify({ ledger_id, name }) }),

  budgets: (ledger_id?: number) => req<{ year: number; month: number; items: Budget[] }>(`/budgets${qs({ ledger_id })}`),
  updateBudget: (id: number, body: Record<string, unknown>) =>
    req<Budget>(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createBudget: (body: Record<string, unknown>) =>
    req<Budget>('/budgets', { method: 'POST', body: JSON.stringify(body) }),
  deleteBudget: (id: number) => req<{ ok: boolean }>(`/budgets/${id}`, { method: 'DELETE' }),

  analytics: (params: Record<string, string | number | undefined>) =>
    req<AnalyticsSummary>(`/analytics${qs(params)}`),
  search: (q: string, ledger_id?: number) =>
    req<{ query: string; count: number; items: Transaction[] }>(`/search${qs({ q, ledger_id })}`),

  // ---- 语音识别（仅远端模式有意义；千问百炼 Paraformer 录音文件转写）----
  speechHealth: () => req<{ ok: boolean; engine: string | null }>('/speech/health'),
  speechTranscribe: async (blob: Blob): Promise<{ text: string; engine?: string; duration_ms?: number }> => {
    const res = await fetch(`${BASE}/speech/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: blob,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  },
};

// ---- 统一导出：根据模式选择实现（同步 pick，不阻塞 API 调用）----
function pick() {
  return ensureMode() === 'remote' ? remoteApi : localApi;
}

export const api = {
  ledgers() { return pick().ledgers(); },
  activeLedger() { return pick().activeLedger(); },
  createLedger(name: string, currency = 'CNY') { return pick().createLedger(name, currency); },
  setActiveLedger(id: number) { return pick().setActiveLedger(id); },
  ledgerStats(id: number) { return pick().ledgerStats(id); },

  listTransactions(params: Record<string, string | number | undefined>) { return pick().listTransactions(params); },
  getTransaction(id: number) { return pick().getTransaction(id); },
  createTransaction(body: Record<string, unknown>) { return pick().createTransaction(body); },
  createTransactions(items: Record<string, unknown>[]) { return pick().createTransactions(items); },
  updateTransaction(id: number, body: Record<string, unknown>) { return pick().updateTransaction(id, body); },
  deleteTransaction(id: number, confirm = false) { return pick().deleteTransaction(id, confirm); },
  parseTransaction(text: string, ledger_id: number) { return pick().parseTransaction(text, ledger_id); },
  fetchTransactionCandidates(text: string, ledger_id: number) { return pick().fetchTransactionCandidates(text, ledger_id); },

  categories(params?: Record<string, string | number>) { return pick().categories(params); },
  createCategory(body: Record<string, unknown>) { return pick().createCategory(body); },
  accounts(params?: Record<string, string | number>) { return pick().accounts(params); },
  createAccount(body: Record<string, unknown>) { return pick().createAccount(body); },
  tags(ledger_id?: number) { return pick().tags(ledger_id); },
  createTag(ledger_id: number, name: string) { return pick().createTag(ledger_id, name); },

  budgets(ledger_id?: number) { return pick().budgets(ledger_id); },
  updateBudget(id: number, body: Record<string, unknown>) { return pick().updateBudget(id, body); },
  createBudget(body: Record<string, unknown>) { return pick().createBudget(body); },
  deleteBudget(id: number) { return pick().deleteBudget(id); },

  analytics(params: Record<string, string | number | undefined>) { return pick().analytics(params); },
  search(q: string, ledger_id?: number) { return pick().search(q, ledger_id); },

  // 语音识别：仅远端（本地 server + ASR 微服务）可用，离线/APK 模式返回不可用
  async speechHealth() {
    if (ensureMode() !== 'remote') return { ok: false as const, engine: null };
    try { return await remoteApi.speechHealth(); } catch { return { ok: false as const, engine: null }; }
  },
  speechTranscribe(blob: Blob) {
    if (ensureMode() !== 'remote') return Promise.reject(new Error('ASR 服务仅本地后端可用'));
    return remoteApi.speechTranscribe(blob);
  },
};

export type Api = typeof api;
