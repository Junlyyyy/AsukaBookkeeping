// BeeCount 本地后端 — 预算 / 统计 / 搜索 路由
// 对齐 MCP tools: list_budgets / update_budget / get_analytics_summary / search

import { Router } from 'express';
import { db, centsToYuan, yuanToCents, TX_SELECT, serializeTransaction } from '../db.js';

export const miscRouter = Router();

/** list_budgets — 预算 + 当月已用进度 */
miscRouter.get('/budgets', (req, res) => {
  const { ledger_id } = req.query;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  let sql = `
    SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.type AS category_type
    FROM budgets b
    LEFT JOIN categories c ON c.id = b.category_id
    WHERE 1=1`;
  const params = [];
  if (ledger_id) { sql += ' AND b.ledger_id = ?'; params.push(Number(ledger_id)); }
  sql += ' ORDER BY b.id';
  const budgets = db.prepare(sql).all(...params).map((b) => {
    const spent = db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS s FROM transactions
      WHERE category_id = ? AND type = 'expense' AND status = 'active'
        AND strftime('%Y-%m', occurred_at) = ?
    `).get(b.category_id, `${y}-${String(m).padStart(2, '0')}`).s;
    const s = spent / 100;
    const a = b.amount / 100;
    return {
      ...b,
      amount: Number(a.toFixed(2)),
      spent: Number(s.toFixed(2)),
      progress: a > 0 ? Math.min(Math.round((s / a) * 100), 999) : 0,
      remaining: Number((a - s).toFixed(2)),
    };
  });
  res.json({ year: y, month: m, items: budgets });
});

/** update_budget — 改预算金额 */
miscRouter.patch('/budgets/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'budget not found' });
  const { amount, period, year, month } = req.body || {};
  const sets = [];
  const params = [];
  if (amount !== undefined) {
    try { sets.push('amount = ?'); params.push(yuanToCents(amount)); } catch { return res.status(400).json({ error: 'invalid amount' }); }
  }
  if (period) { sets.push('period = ?'); params.push(period); }
  if (year) { sets.push('year = ?'); params.push(Number(year)); }
  if (month !== undefined) { sets.push('month = ?'); params.push(month === null ? null : Number(month)); }
  if (sets.length === 0) return res.json(existing);
  sets.push("updated_at = datetime('now','localtime')");
  db.prepare(`UPDATE budgets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  const row = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  res.json({ ...row, amount: Number(centsToYuan(row.amount)) });
});

miscRouter.post('/budgets', (req, res) => {
  const { ledger_id, category_id, amount, year, month = null } = req.body || {};
  if (!ledger_id || !category_id || amount === undefined) return res.status(400).json({ error: 'ledger_id, category_id and amount required' });
  const y = year || new Date().getFullYear();
  const r = db.prepare(`
    INSERT INTO budgets (ledger_id, category_id, amount, period, year, month)
    VALUES (?, ?, ?, 'monthly', ?, ?)
  `).run(Number(ledger_id), Number(category_id), yuanToCents(amount), Number(y), month);
  const row = db.prepare('SELECT * FROM budgets WHERE id = ?').get(Number(r.lastInsertRowid));
  res.status(201).json({ ...row, amount: Number(centsToYuan(row.amount)) });
});

miscRouter.delete('/budgets/:id', (req, res) => {
  db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/** get_analytics_summary — 月度/年度/全部范围的收入/支出/Top 分类/每日趋势 */
miscRouter.get('/analytics', (req, res) => {
  const { scope = 'month', year, month, ledger_id } = req.query;
  const now = new Date();
  const y = year ? Number(year) : now.getFullYear();
  const m = month ? Number(month) : now.getMonth() + 1;

  let where = "WHERE t.status = 'active'";
  const params = [];
  if (ledger_id) { where += ' AND t.ledger_id = ?'; params.push(Number(ledger_id)); }

  if (scope === 'month') {
    where += " AND strftime('%Y-%m', t.occurred_at) = ?";
    params.push(`${y}-${String(m).padStart(2, '0')}`);
  } else if (scope === 'year') {
    where += " AND strftime('%Y', t.occurred_at) = ?";
    params.push(String(y));
  }

  // 收入/支出合计
  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount END),0) AS income,
      COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END),0) AS expense,
      COUNT(*) AS n
    FROM transactions t ${where}
  `).get(...params);

  // Top 分类（支出）
  const topExpense = db.prepare(`
    SELECT c.id, c.name, c.icon, COALESCE(SUM(t.amount),0) AS amount, COUNT(*) AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    ${where} AND t.type = 'expense'
    GROUP BY c.id ORDER BY amount DESC LIMIT 8
  `).all(...params).map((r) => ({ ...r, amount: Number((r.amount / 100).toFixed(2)) }));

  // Top 分类（收入）
  const topIncome = db.prepare(`
    SELECT c.id, c.name, c.icon, COALESCE(SUM(t.amount),0) AS amount, COUNT(*) AS count
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    ${where} AND t.type = 'income'
    GROUP BY c.id ORDER BY amount DESC LIMIT 5
  `).all(...params).map((r) => ({ ...r, amount: Number((r.amount / 100).toFixed(2)) }));

  // 每日趋势（近 30 天）
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
      FROM transactions t ${where} AND date(t.occurred_at) = ?
    `).get(...params, key);
    daily.push({
      date: key,
      income: Number((row.income / 100).toFixed(2)),
      expense: Number((row.expense / 100).toFixed(2)),
    });
  }

  res.json({
    scope, year: y, month: m,
    income: Number((sums.income / 100).toFixed(2)),
    expense: Number((sums.expense / 100).toFixed(2)),
    balance: Number(((sums.income - sums.expense) / 100).toFixed(2)),
    tx_count: sums.n,
    top_expense: topExpense,
    top_income: topIncome,
    daily,
  });
});

/** search — 全文模糊搜交易备注、分类名、账户名 */
miscRouter.get('/search', (req, res) => {
  const { q, ledger_id, limit = 50 } = req.query;
  if (!q || !String(q).trim()) return res.status(400).json({ error: 'q required' });
  const like = `%${String(q).trim()}%`;
  let where = "WHERE t.status = 'active' AND (t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)";
  const params = [like, like, like];
  if (ledger_id) { where += ' AND t.ledger_id = ?'; params.push(Number(ledger_id)); }
  const rows = db.prepare(`${TX_SELECT} ${where} ORDER BY t.occurred_at DESC LIMIT ?`)
    .all(...params, Math.min(Number(limit) || 50, 200));
  res.json({ query: q, count: rows.length, items: rows.map(serializeTransaction) });
});
