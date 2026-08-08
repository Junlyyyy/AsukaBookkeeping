// BeeCount 本地后端 — 账本/账户/分类/标签 路由
// 对齐 MCP tools: list_ledgers / get_active_ledger / list_accounts / list_categories / list_tags / create_category

import { Router } from 'express';
import { db, centsToYuan } from '../db.js';

export const ledgerRouter = Router();

/** list_ledgers + get_active_ledger */
ledgerRouter.get('/ledgers', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM transactions t WHERE t.ledger_id = l.id AND t.status = 'active') AS tx_count,
      (SELECT COUNT(*) FROM accounts a WHERE a.ledger_id = l.id) AS account_count,
      (SELECT COUNT(*) FROM categories c WHERE c.ledger_id = l.id) AS category_count
    FROM ledgers l ORDER BY l.id
  `).all();
  res.json(rows);
});

ledgerRouter.get('/ledgers/active', (req, res) => {
  const row = db.prepare(`SELECT * FROM ledgers WHERE is_active = 1 LIMIT 1`).get();
  if (!row) return res.status(404).json({ error: 'no active ledger' });
  res.json(row);
});

ledgerRouter.put('/ledgers/:id/active', (req, res) => {
  const id = Number(req.params.id);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE ledgers SET is_active = 0').run();
    db.prepare('UPDATE ledgers SET is_active = 1, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

ledgerRouter.post('/ledgers', (req, res) => {
  const { name, currency = 'CNY' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const r = db.prepare('INSERT INTO ledgers (name, currency) VALUES (?, ?)').run(String(name).trim(), currency);
  const row = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(Number(r.lastInsertRowid));
  res.status(201).json(row);
});

/** get_ledger_stats */
ledgerRouter.get('/ledgers/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  const ledger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(id);
  if (!ledger) return res.status(404).json({ error: 'ledger not found' });
  const tx = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense,
           COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income
    FROM transactions WHERE ledger_id = ? AND status = 'active'
  `).get(id);
  res.json({
    ledger_id: id,
    tx_count: tx.n,
    expense: Number(centsToYuan(tx.expense)),
    income: Number(centsToYuan(tx.income)),
    category_count: db.prepare('SELECT COUNT(*) AS n FROM categories WHERE ledger_id = ?').get(id).n,
    account_count: db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE ledger_id = ?').get(id).n,
    tag_count: db.prepare('SELECT COUNT(*) AS n FROM tags WHERE ledger_id = ?').get(id).n,
    budget_count: db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE ledger_id = ?').get(id).n,
  });
});

/** list_accounts */
ledgerRouter.get('/accounts', (req, res) => {
  const { type, ledger_id } = req.query;
  let sql = 'SELECT * FROM accounts WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (ledger_id) { sql += ' AND ledger_id = ?'; params.push(Number(ledger_id)); }
  sql += ' ORDER BY id';
  const rows = db.prepare(sql).all(...params).map((a) => ({
    ...a,
    balance: Number(centsToYuan(a.balance)),
  }));
  res.json(rows);
});

ledgerRouter.post('/accounts', (req, res) => {
  const { ledger_id, name, type = 'cash', balance = 0 } = req.body || {};
  if (!ledger_id || !name) return res.status(400).json({ error: 'ledger_id and name required' });
  const r = db.prepare(
    'INSERT INTO accounts (ledger_id, name, type, balance) VALUES (?, ?, ?, ?)'
  ).run(Number(ledger_id), String(name).trim(), type, Math.round(Number(balance) * 100));
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
  res.status(201).json({ ...row, balance: Number(centsToYuan(row.balance)) });
});

/** list_categories (可按 expense/income/transfer 筛选) */
ledgerRouter.get('/categories', (req, res) => {
  const { type, ledger_id } = req.query;
  let sql = 'SELECT * FROM categories WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (ledger_id) { sql += ' AND ledger_id = ?'; params.push(Number(ledger_id)); }
  sql += ' ORDER BY type, sort_order, id';
  res.json(db.prepare(sql).all(...params));
});

/** create_category */
ledgerRouter.post('/categories', (req, res) => {
  const { ledger_id, name, type = 'expense', icon = '▣' } = req.body || {};
  if (!ledger_id || !name) return res.status(400).json({ error: 'ledger_id and name required' });
  const max = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories WHERE ledger_id = ? AND type = ?'
  ).get(Number(ledger_id), type).m;
  const r = db.prepare(
    'INSERT INTO categories (ledger_id, name, type, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(ledger_id), String(name).trim(), type, String(icon || '▣'), max + 1);
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid));
  res.status(201).json(row);
});

/** list_tags */
ledgerRouter.get('/tags', (req, res) => {
  const { ledger_id } = req.query;
  let sql = `
    SELECT tg.*,
      (SELECT COUNT(*) FROM transaction_tags tt JOIN transactions t ON t.id = tt.transaction_id
        WHERE tt.tag_id = tg.id AND t.status = 'active') AS tx_count
    FROM tags tg WHERE 1=1`;
  const params = [];
  if (ledger_id) { sql += ' AND tg.ledger_id = ?'; params.push(Number(ledger_id)); }
  sql += ' ORDER BY tg.id';
  res.json(db.prepare(sql).all(...params));
});

ledgerRouter.post('/tags', (req, res) => {
  const { ledger_id, name } = req.body || {};
  if (!ledger_id || !name) return res.status(400).json({ error: 'ledger_id and name required' });
  try {
    const r = db.prepare('INSERT INTO tags (ledger_id, name) VALUES (?, ?)')
      .run(Number(ledger_id), String(name).trim());
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(r.lastInsertRowid));
    res.status(201).json(row);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'tag exists' });
    throw e;
  }
});
