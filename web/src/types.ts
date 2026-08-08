// 类型定义 — 对齐 BeeCount 领域模型

export type TxType = 'expense' | 'income' | 'transfer';

export interface Ledger {
  id: number;
  name: string;
  currency: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  tx_count?: number;
  account_count?: number;
  category_count?: number;
}

export interface Account {
  id: number;
  ledger_id: number;
  name: string;
  type: 'cash' | 'bank' | 'credit_card' | 'e_wallet' | 'other';
  balance: number; // 元
  created_at: string;
}

export interface Category {
  id: number;
  ledger_id: number;
  name: string;
  type: TxType;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface Tag {
  id: number;
  ledger_id: number;
  name: string;
  created_at: string;
  tx_count?: number;
}

export interface Transaction {
  id: number;
  ledger_id: number;
  type: TxType;
  amount: number; // 元
  note: string;
  occurred_at: string;
  status: string;
  account: { id: number; name: string; type: string } | null;
  category: { id: number; name: string; icon: string; type: string } | null;
  tags: { id: number; name: string }[];
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: number;
  ledger_id: number;
  category_id: number;
  amount: number;
  period: string;
  year: number;
  month: number | null;
  category_name?: string;
  category_icon?: string;
  spent?: number;
  progress?: number;
  remaining?: number;
}

export interface LedgerStats {
  ledger_id: number;
  tx_count: number;
  expense: number;
  income: number;
  category_count: number;
  account_count: number;
  tag_count: number;
  budget_count: number;
}

export interface AnalyticsSummary {
  scope: string;
  year: number;
  month: number;
  income: number;
  expense: number;
  balance: number;
  tx_count: number;
  top_expense: { id: number; name: string; icon: string; amount: number; count: number }[];
  top_income: { id: number; name: string; icon: string; amount: number; count: number }[];
  daily: { date: string; income: number; expense: number }[];
}

export interface TxListResponse {
  items: Transaction[];
  total: { expense: number; income: number } | null;
  limit: number;
  offset: number;
}

/** 自动抓取解析出的候选交易（未落库，前端确认后批量入库） */
export interface TxCandidate {
  type: TxType;
  amount: number; // 元
  note: string;
  occurred_at: string;
  raw?: string;
  category: { id: number; name: string } | null;
}
