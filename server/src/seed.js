// BeeCount 本地后端 — 种子数据
// 首次启动（空库）时写入一套演示账本：默认账本 + 常用分类 + 账户 + 近 90 天随机交易 + 标签 + 预算。

import { db } from './db.js';

/** 简易可复现随机数（不引入额外依赖） */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM ledgers').get();
  if (n > 0) return;

  const rand = mulberry32(20260807);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const rint = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

  const now = new Date();
  const nowStr = () =>
    new Date().toISOString().slice(0, 19).replace('T', ' ');

  // ---- 账本 ----
  const insLedger = db.prepare('INSERT INTO ledgers (name, currency, is_active) VALUES (?, ?, ?)');
  const mainId = Number(insLedger.run('我的日常账本', 'CNY', 1).lastInsertRowid);
  insLedger.run('旅行基金', 'CNY', 0);

  // ---- 分类 ----
  const catTypes = ['expense', 'income'];
  const expenseCats = [
    ['餐饮', '🍜', 0], ['交通', '🚌', 1], ['购物', '🛍️', 2],
    ['居住', '🏠', 3], ['娱乐', '🎮', 4], ['医疗', '💊', 5],
    ['教育', '📚', 6], ['人情', '🎁', 7], ['通讯', '📱', 8],
    ['其他支出', '⋯', 9],
  ];
  const incomeCats = [
    ['工资', '💰', 0], ['奖金', '🎉', 1], ['理财', '📈', 2],
    ['其他收入', '⋯', 3],
  ];
  const insCat = db.prepare('INSERT INTO categories (ledger_id, name, type, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
  const catId = {};
  expenseCats.forEach(([name, icon, o], i) => {
    const id = Number(insCat.run(mainId, name, 'expense', icon, o).lastInsertRowid);
    catId[name] = id;
  });
  incomeCats.forEach(([name, icon, o]) => {
    const id = Number(insCat.run(mainId, name, 'income', icon, o).lastInsertRowid);
    catId[name] = id;
  });
  // 旅行账本少量分类
  const tripCats = ['机票', '酒店', '餐饮'];
  const tripCatId = {};
  tripCats.forEach((name) => {
    const id = Number(insCat.run(2, name, 'expense', pick(['✈️', '🏨', '🍜']), 0).lastInsertRowid);
    tripCatId[name] = id;
  });

  // ---- 账户 ----
  const insAccount = db.prepare('INSERT INTO accounts (ledger_id, name, type, balance) VALUES (?, ?, ?, ?)');
  const acct = {
    cash: Number(insAccount.run(mainId, '现金', 'cash', 186500).lastInsertRowid),
    bank: Number(insAccount.run(mainId, '招商银行', 'bank', 2580000).lastInsertRowid),
    credit: Number(insAccount.run(mainId, '信用卡', 'credit_card', 0).lastInsertRowid),
    wallet: Number(insAccount.run(mainId, '支付宝', 'e_wallet', 684300).lastInsertRowid),
  };
  insAccount.run(2, '现金', 'cash', 50000);
  insAccount.run(2, '储蓄卡', 'bank', 1000000);

  // ---- 标签 ----
  const insTag = db.prepare('INSERT INTO tags (ledger_id, name) VALUES (?, ?)');
  const tagId = {};
  ['咖啡', '通勤', '旅行', '数码', '健身'].forEach((name) => {
    const id = Number(insTag.run(mainId, name).lastInsertRowid);
    tagId[name] = id;
  });

  // ---- 预算 ----
  const insBudget = db.prepare(`
    INSERT INTO budgets (ledger_id, category_id, amount, period, year, month)
    VALUES (?, ?, ?, 'monthly', ?, ?)
  `);
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const budgets = [
    ['餐饮', 200000], ['交通', 30000], ['购物', 150000],
    ['娱乐', 80000], ['居住', 350000], ['医疗', 50000],
  ];
  budgets.forEach(([name, amount]) => insBudget.run(mainId, catId[name], amount, y, m));

  // ---- 近 90 天交易 ----
  const insTx = db.prepare(`
    INSERT INTO transactions (ledger_id, account_id, category_id, type, amount, note, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insTxTag = db.prepare('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)');
  const nowMs = now.getTime();

  const daySpecs = [
    { cat: '餐饮', amt: [800, 3800], note: ['午餐', '晚餐', '咖啡', '外卖', '奶茶'] },
    { cat: '交通', amt: [200, 1500], note: ['地铁', '打车', '公交'] },
    { cat: '购物', amt: [3000, 30000], note: ['日用品', '衣服', '超市采购', '数码配件'] },
    { cat: '娱乐', amt: [1500, 12000], note: ['电影', '游戏', 'KTV', '桌游'] },
    { cat: '医疗', amt: [1000, 8000], note: ['感冒药', '体检', '挂号'] },
    { cat: '教育', amt: [5000, 30000], note: ['课程', '书籍', '网课'] },
    { cat: '人情', amt: [5000, 50000], note: ['红包', '聚餐请客', '礼物'] },
    { cat: '通讯', amt: [3000, 10000], note: ['话费', '宽带', '流量包'] },
  ];

  for (let i = 0; i < 90; i++) {
    const dayMs = nowMs - i * 86400000;
    const n = rint(2, 5); // 每天 2~5 笔
    for (let k = 0; k < n; k++) {
      const spec = pick(daySpecs);
      const amount = rint(spec.amt[0], spec.amt[1]);
      const hour = rint(8, 22);
      const minute = rint(0, 59);
      const dt = new Date(dayMs);
      dt.setHours(hour, minute, 0, 0);
      const occurredAt = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
        .replace('T', ' ');
      const txId = Number(insTx.run(
        mainId, pick([acct.wallet, acct.bank, acct.cash]),
        catId[spec.cat], 'expense', amount,
        pick(spec.note), occurredAt,
      ).lastInsertRowid);
      if (spec.cat === '餐饮' && rand() < 0.3) insTxTag.run(txId, tagId['咖啡']);
      if (spec.cat === '交通' && rand() < 0.4) insTxTag.run(txId, tagId['通勤']);
      if (spec.cat === '购物' && rand() < 0.2) insTxTag.run(txId, tagId['数码']);
    }
  }

  // 工资与奖金（每月 10 日 / 月末）
  for (let back = 0; back <= 2; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 10, 9, 0, 0);
    if (d > now) continue;
    const occurredAt = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16).replace('T', ' ');
    insTx.run(mainId, acct.bank, catId['工资'], 'income', 2500000, '月度工资', occurredAt);
  }
  const d2 = new Date(now.getFullYear(), now.getMonth(), 25, 12, 0, 0);
  if (d2 <= now) {
    const occurredAt = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16).replace('T', ' ');
    insTx.run(mainId, acct.bank, catId['奖金'], 'income', 800000, '季度奖金', occurredAt);
  }

  // 旅行账本示例交易
  const t3 = new Date(nowMs - 15 * 86400000);
  const iso3 = new Date(t3.getTime() - t3.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  const txTrip = Number(insTx.run(2, 2, tripCatId['机票'], 'expense', 128000, '北京→上海 机票', iso3).lastInsertRowid);
  insTxTag.run(txTrip, tagId['旅行']);
  const t4 = new Date(nowMs - 12 * 86400000);
  const iso4 = new Date(t4.getTime() - t4.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  insTx.run(2, 2, tripCatId['酒店'], 'expense', 88000, '外滩附近酒店', iso4);

  console.log(`[seed] 已写入演示数据：账本 2 个、分类 ${expenseCats.length + incomeCats.length + 3} 个、账户 6 个、标签 5 个、预算 ${budgets.length} 条、交易若干。`);
}
