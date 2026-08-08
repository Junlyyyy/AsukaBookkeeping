// BeeCount 本地后端 — 数据库层
// 数据模型对齐 BeeCount Cloud 的领域模型：
//   ledgers(账本) / accounts(账户) / categories(分类) / tags(标签)
//   transactions(交易) / transaction_tags(交易-标签关联) / budgets(预算)
// 金额统一以「分」为单位存储（整数），避免浮点误差。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');
export const DB_PATH = process.env.BEECOUNT_DB || join(DATA_DIR, 'beecount.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/** 初始化全部表结构 */
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledgers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      currency    TEXT    NOT NULL DEFAULT 'CNY',
      is_active   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'cash',   -- cash / bank / credit_card / e_wallet / other
      balance     INTEGER NOT NULL DEFAULT 0,        -- 分
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'expense', -- expense / income / transfer
      icon        TEXT    NOT NULL DEFAULT '▣',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (ledger_id, name)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id    INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      type         TEXT    NOT NULL DEFAULT 'expense', -- expense / income / transfer
      amount       INTEGER NOT NULL,                   -- 分（恒为正数）
      note         TEXT    NOT NULL DEFAULT '',
      occurred_at  TEXT    NOT NULL,                   -- 交易发生时间 ISO8601
      status       TEXT    NOT NULL DEFAULT 'active',  -- active / pending_delete
      created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (transaction_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id   INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      amount      INTEGER NOT NULL,                    -- 分
      period      TEXT    NOT NULL DEFAULT 'monthly',  -- monthly / yearly
      year        INTEGER NOT NULL,
      month       INTEGER,                             -- NULL = 全年
      created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_tx_ledger_time ON transactions (ledger_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_category    ON transactions (category_id);
    CREATE INDEX IF NOT EXISTS idx_tx_account     ON transactions (account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_status      ON transactions (status);
  `);
}

/** 查询辅助：分 → 元字符串 */
export function centsToYuan(cents) {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toFixed(2);
}

/** 查询辅助：元（number 或字符串）→ 分 */
export function yuanToCents(yuan) {
  const n = Number(yuan);
  if (!Number.isFinite(n)) throw new Error(`invalid amount: ${yuan}`);
  return Math.round(n * 100);
}

/** 生成 ISO8601 本地时间（YYYY-MM-DD HH:mm:ss 与前端 Date 兼容） */
export function now() {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

/**
 * 交易行 → API JSON（含分类/账户/标签内联）
 * @param {object} row 原始行
 * @returns {object}
 */
export function serializeTransaction(row) {
  return {
    id: row.id,
    ledger_id: row.ledger_id,
    type: row.type,
    amount: Number(centsToYuan(row.amount)),      // 元
    note: row.note,
    occurred_at: row.occurred_at,
    status: row.status,
    account: row.account_id
      ? { id: row.account_id, name: row.account_name, type: row.account_type }
      : null,
    category: row.category_id
      ? { id: row.category_id, name: row.category_name, icon: row.category_icon, type: row.category_type }
      : null,
    tags: row.tags ? (row.tags ? JSON.parse(row.tags) : []) : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 查询交易时公共的 SELECT 片段 */
export const TX_SELECT = `
  SELECT
    t.*,
    a.name AS account_name, a.type AS account_type,
    c.name AS category_name, c.icon AS category_icon, c.type AS category_type,
    (SELECT json_group_array(json_object('id', tg.id, 'name', tg.name))
       FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.transaction_id = t.id) AS tags
  FROM transactions t
  LEFT JOIN accounts a   ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
`;
