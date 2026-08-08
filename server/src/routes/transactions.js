// BeeCount 本地后端 — 交易路由
// 对齐 MCP tools: list_transactions / get_transaction / create_transaction / create_transactions
//                  update_transaction / delete_transaction(二次确认) / parse_and_create_from_text
// parse 仅本地规则引擎（离线）；语音识别走千问 ASR（联网）

import { Router } from 'express';
import { db, TX_SELECT, serializeTransaction, yuanToCents } from '../db.js';

export const txRouter = Router();

// 本地时间字符串 —— 与 SQLite datetime('now','localtime') 一致；不能用 toISOString()（UTC 差 8 小时）
const NOW = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
};

/** list_transactions — 支持日期/分类/账户/关键词/金额范围/类型/标签筛选 */
txRouter.get('/transactions', (req, res) => {
  const {
    ledger_id, date_from, date_to, category_id, account_id,
    q, amount_min, amount_max, type, tag_id, limit = 200, offset = 0,
  } = req.query;

  let where = "WHERE t.status != 'deleted'";
  const params = [];
  if (ledger_id) { where += ' AND t.ledger_id = ?'; params.push(Number(ledger_id)); }
  if (date_from) { where += ' AND t.occurred_at >= ?'; params.push(`${date_from} 00:00:00`); }
  if (date_to) { where += ' AND t.occurred_at <= ?'; params.push(`${date_to} 23:59:59`); }
  if (category_id) { where += ' AND t.category_id = ?'; params.push(Number(category_id)); }
  if (account_id) { where += ' AND t.account_id = ?'; params.push(Number(account_id)); }
  if (type) { where += " AND t.type = ?"; params.push(type); }
  if (amount_min) { where += ' AND t.amount >= ?'; params.push(yuanToCents(amount_min)); }
  if (amount_max) { where += ' AND t.amount <= ?'; params.push(yuanToCents(amount_max)); }
  if (q) {
    where += ' AND (t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (tag_id) {
    where += ' AND EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)';
    params.push(Number(tag_id));
  }

  const limitN = Math.min(Number(limit) || 200, 1000);
  const offN = Number(offset) || 0;

  const rows = db.prepare(`${TX_SELECT} ${where} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limitN, offN);

  // 合计信息（用于前端小计展示）
  let total = null;
  if (ledger_id) {
    total = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END),0) AS expense,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount END),0) AS income
      FROM transactions t ${where}
    `).get(...params);
    total.expense = Number((total.expense / 100).toFixed(2));
    total.income = Number((total.income / 100).toFixed(2));
  }

  res.json({ items: rows.map(serializeTransaction), total, limit: limitN, offset: offN });
});

/** get_transaction */
txRouter.get('/transactions/:id', (req, res) => {
  const row = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'transaction not found' });
  res.json(serializeTransaction(row));
});

/** create_transaction */
txRouter.post('/transactions', (req, res) => {
  const { ledger_id, account_id, category_id, type = 'expense', amount, note = '', occurred_at, tag_ids = [] } = req.body || {};
  if (!ledger_id) return res.status(400).json({ error: 'ledger_id required' });
  if (amount === undefined || amount === null || amount === '') return res.status(400).json({ error: 'amount required' });

  let cents;
  try { cents = yuanToCents(amount); } catch (e) { return res.status(400).json({ error: 'invalid amount' }); }
  if (cents <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const when = occurred_at || NOW();
  const r = db.prepare(`
    INSERT INTO transactions (ledger_id, account_id, category_id, type, amount, note, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(ledger_id), account_id ? Number(account_id) : null,
    category_id ? Number(category_id) : null, type, cents, String(note).trim(), when);

  const txId = Number(r.lastInsertRowid);
  if (Array.isArray(tag_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)');
    for (const t of tag_ids) ins.run(txId, Number(t));
  }

  const row = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(txId);
  res.status(201).json(serializeTransaction(row));
});

/** create_transactions — 批量 */
txRouter.post('/transactions/batch', (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' });
  if (items.length > 500) return res.status(400).json({ error: 'too many items (max 500)' });

  const created = [];
  db.exec('BEGIN');
  try {
    for (const it of items) {
      const { ledger_id, account_id, category_id, type = 'expense', amount, note = '', occurred_at, tag_ids = [] } = it;
      let cents;
      try { cents = yuanToCents(amount); } catch { throw new Error('invalid amount'); }
      if (!ledger_id) throw new Error('ledger_id required');
      const r = db.prepare(`
        INSERT INTO transactions (ledger_id, account_id, category_id, type, amount, note, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(Number(ledger_id), account_id ? Number(account_id) : null,
        category_id ? Number(category_id) : null, type, cents, String(note || '').trim(), occurred_at || NOW());
      const txId = Number(r.lastInsertRowid);
      if (Array.isArray(tag_ids)) {
        const ins = db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)');
        for (const t of tag_ids) ins.run(txId, Number(t));
      }
      created.push(txId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: e.message });
  }

  const rows = created.map((id) => db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id));
  res.status(201).json({ created: rows.length, items: rows.map(serializeTransaction) });
});

/** update_transaction — 只改传入的字段 */
txRouter.patch('/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'transaction not found' });

  const body = req.body || {};
  const sets = [];
  const params = [];

  const updaters = {
    ledger_id: (v) => { sets.push('ledger_id = ?'); params.push(Number(v)); },
    account_id: (v) => { sets.push('account_id = ?'); params.push(v === null || v === undefined ? null : Number(v)); },
    category_id: (v) => { sets.push('category_id = ?'); params.push(v === null || v === undefined ? null : Number(v)); },
    type: (v) => { sets.push('type = ?'); params.push(v); },
    amount: (v) => { sets.push('amount = ?'); params.push(yuanToCents(v)); },
    note: (v) => { sets.push('note = ?'); params.push(String(v).trim()); },
    occurred_at: (v) => { sets.push('occurred_at = ?'); params.push(v); },
  };
  for (const [k, fn] of Object.entries(updaters)) {
    if (k in body) {
      try { fn(body[k]); } catch { return res.status(400).json({ error: `invalid ${k}` }); }
    }
  }
  if (sets.length === 0 && !('tag_ids' in body)) return res.json(serializeTransaction(existing));
  sets.push('updated_at = datetime(\'now\',\'localtime\')');
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);

  if ('tag_ids' in body) {
    db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)');
    for (const t of body.tag_ids || []) ins.run(id, Number(t));
  }

  const row = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
  res.json(serializeTransaction(row));
});

/**
 * delete_transaction — 二次确认（对齐 BeeCount 设计：第一次调用返回“待确认”，确认后才真删）
 * 第一次 DELETE：status -> pending_delete，返回确认提示
 * 第二次 DELETE ?confirm=1：物理删除
 */
txRouter.delete('/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const confirm = req.query.confirm === '1' || req.query.confirm === 'true';
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'transaction not found' });

  if (!confirm) {
    if (existing.status === 'pending_delete') {
      return res.json({ status: 'pending_delete', message: '该交易已处于待删除状态，调用 DELETE 并携带 confirm=1 执行删除', transaction_id: id });
    }
    db.prepare("UPDATE transactions SET status = 'pending_delete' WHERE id = ?").run(id);
    return res.json({
      status: 'pending_confirmation',
      message: '删除需要二次确认：再次调用 DELETE /api/v1/transactions/:id?confirm=1 将永久删除该笔交易',
      transaction_id: id,
    });
  }

  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ ok: true, deleted: id });
});

/**
 * fetch_transaction_candidates — 自动抓取消费记录（解析不落库，返回候选）
 * 支持输入：
 *  - 微信/支付宝支付短信（如「【微信支付】你于08月06日08:32在星巴克消费38.00元」）
 *  - 银行 App 交易详情文本
 *  - 多行文本（每行一笔，或一段话多笔）
 * 返回候选列表，前端确认后走 create_transactions 批量入库。
 */
txRouter.post('/transactions/fetch', (req, res) => {
  const { text, ledger_id } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
  if (!ledger_id) return res.status(400).json({ error: 'ledger_id required' });

  const candidates = parsePaymentText(String(text), Number(ledger_id));
  res.json({ count: candidates.length, items: candidates });
});

/**
 * 支付文本解析器（纯规则，无外部依赖）
 * 从一段文本中识别 1..N 笔交易，返回标准化候选对象
 */
function parsePaymentText(text, ledgerId) {
  // 1) 先按常见分隔符切分成多个候选块：换行 / 分号 / "、"
  const chunks = text
    .split(/[\n;；、]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const now = new Date();
  const candidates = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const c = parseSingle(chunk, now);
    if (!c) continue;
    const key = `${c.amount}|${c.note}|${c.occurred_at}`;
    if (seen.has(key)) continue; // 去重
    seen.add(key);
    // 关联分类（规则关键词）
    const cat = classifyCategory(chunk, ledgerId);
    candidates.push({ ...c, category: cat });
  }
  return candidates;
}

/** 解析单条支付文本 → { type, amount, note, occurred_at } | null */
function parseSingle(s, now) {
  // 金额：¥38.00 / 38.00元 / 支付38.00元 / 消费38.00元 / 38块5
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

  // 类型：收入关键词优先
  const incomeWords = ['收款', '收入', '转入', '到账', '入账', '收到', '+'];
  const expenseWords = ['支付', '消费', '付款', '支出', '扣款', '花费', '交易', '-'];
  let type = 'expense';
  if (incomeWords.some((w) => s.includes(w)) && !expenseWords.some((w) => s.includes(w))) type = 'income';
  else if (expenseWords.some((w) => s.includes(w))) type = 'expense';

  // 商家/备注：从「在XXX(店铺)消费」「向XXX付款」「支付给XXX」提取，否则取支付渠道后文本
  let note = '';
  const mMerchant = s.match(/(?:在|向|支付给|付款给|转入|收自|来自)\s*([\u4e00-\u9fa5A-Za-z0-9·]{1,18}?)(?:[（(]|消费|支付|付款|\.|$)/);
  if (mMerchant) note = mMerchant[1].trim();
  // 兜底：去掉通道前缀与金额后的核心文本
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

  // 日期：今天/昨天/前天/「X月X日X时X分」/「X月X日」（统一本地时间存储，与带日期分支一致）
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  let occurredAt = toLocal(now);
  const rel = (days) => toLocal(new Date(now.getTime() - days * 86400000));
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

  return {
    type,
    amount: Number(amountYuan.toFixed(2)),
    note,
    occurred_at: occurredAt,
    raw: s.slice(0, 80),
  };
}

/** 分类关键词 → 匹配账本中已有分类（返回 { id, name } 或 null） */
function classifyCategory(text, ledgerId) {
  const kw = [
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
  const cat = db.prepare('SELECT * FROM categories WHERE ledger_id = ? AND name = ? AND type = ?')
    .get(Number(ledgerId), catName, 'expense');
  return cat ? { id: cat.id, name: cat.name } : null;
}

/** parse_and_create_from_text — 自然语言记账
 *  本地规则引擎解析（离线，无需外部依赖；应用整体仅语音识别联网） */
txRouter.post('/transactions/parse', async (req, res) => {
  const { text, ledger_id } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' });
  if (!ledger_id) return res.status(400).json({ error: 'ledger_id required' });

  const s = String(text).trim();
  const ledgerId = Number(ledger_id);

  // ---- 引擎 4：本地规则解析（降级/默认） ----
  // 金额：支持 "38" "38块" "38.5元" "3块5" "12块5毛"
  let amountYuan = null;
  const m1 = s.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱|¥|￥)/);
  const m2 = s.match(/(\d+)\s*块\s*(\d+)\s*(?:毛|角)?/);
  const m3 = s.match(/(\d+(?:\.\d+)?)\s*$/);
  if (m2) amountYuan = Number(m2[1]) + Number(m2[2]) / 10;
  else if (m1) amountYuan = Number(m1[1]);
  else if (m3) amountYuan = Number(m3[1]);

  if (amountYuan === null || amountYuan <= 0) {
    return res.status(400).json({ error: '未识别到金额，请包含金额，例如：昨天星巴克咖啡 38 元' });
  }

  // 分类：关键词匹配
  const kw = [
    ['餐饮', ['餐', '饭', '咖啡', '奶茶', '外卖', '吃', '面', '烧烤', '火锅', '星巴克']],
    ['交通', ['车', '地铁', '打车', '公交', '油', '停车', '高铁', '机票']],
    ['购物', ['买', '购', '超市', '衣服', '鞋', '数码', '淘宝']],
    ['娱乐', ['电影', '游戏', 'KTV', '娱乐', '演出']],
    ['医疗', ['药', '医院', '诊所', '挂号', '体检']],
    ['通讯', ['话费', '流量', '宽带', '充值']],
    ['教育', ['书', '课', '学费', '培训']],
    ['人情', ['红包', '礼物', '请客']],
  ];
  let category = null;
  for (const [catName, words] of kw) {
    if (words.some((w) => s.includes(w))) { category = catName; break; }
  }

  const cat = category
    ? db.prepare('SELECT * FROM categories WHERE ledger_id = ? AND name = ? AND type = ?')
        .get(ledgerId, category, 'expense')
    : null;
  const defaultCat = db.prepare('SELECT * FROM categories WHERE ledger_id = ? AND type = ? ORDER BY sort_order LIMIT 1')
    .get(ledgerId, 'expense');

  // 日期：今天/昨天/前天/明天 或具体日期
  const now = new Date();
  let occurred_at = NOW();
  if (/昨天/.test(s)) {
    const d = new Date(now.getTime() - 86400000);
    occurred_at = d.toISOString().slice(0, 16).replace('T', ' ');
  } else if (/前天/.test(s)) {
    const d = new Date(now.getTime() - 2 * 86400000);
    occurred_at = d.toISOString().slice(0, 16).replace('T', ' ');
  }

  const r = db.prepare(`
    INSERT INTO transactions (ledger_id, category_id, type, amount, note, occurred_at)
    VALUES (?, ?, 'expense', ?, ?, ?)
  `).run(ledgerId, (cat || defaultCat)?.id ?? null,
    Math.round(amountYuan * 100),
    s.replace(/(昨天|前天)\s*/, '').slice(0, 50),
    occurred_at);

  const row = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(Number(r.lastInsertRowid));
  res.status(201).json({
    ...serializeTransaction(row),
    parsed: { amount: amountYuan, category: cat ? cat.name : (defaultCat?.name || null), engine: 'rule' },
  });
});
