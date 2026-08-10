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
    try { _db = JSON.parse(raw); ensureDefaultCats(); return _db!; } catch { /* fallthrough */ }
  }
  // 正式版：不写任何示例数据。首次打开 app 数据完全为空，
  // 由用户主动创建第一个账本 + 分类 + 账户。
  _db = { ledgers: [], accounts: [], categories: [], tags: [], transactions: [], transaction_tags: [], budgets: [], seq: 1 };
  save();
  return _db;
}

/** 默认分类模板（与 createLedger 保持一致） */
const DEFAULT_CATS: { name: string; type: 'expense' | 'income'; icon: string }[] = [
  { name: '餐饮', type: 'expense', icon: '🍜' },
  { name: '交通', type: 'expense', icon: '🚇' },
  { name: '购物', type: 'expense', icon: '🛍' },
  { name: '娱乐', type: 'expense', icon: '🎮' },
  { name: '居住', type: 'expense', icon: '🏠' },
  { name: '医疗', type: 'expense', icon: '💊' },
  { name: '通讯', type: 'expense', icon: '📱' },
  { name: '人情', type: 'expense', icon: '🧧' },
  { name: '学习', type: 'expense', icon: '📚' },
  { name: '其他', type: 'expense', icon: '▣' },
  { name: '工资', type: 'income', icon: '💰' },
  { name: '奖金', type: 'income', icon: '🎉' },
  { name: '理财', type: 'income', icon: '📈' },
  { name: '其他收入', type: 'income', icon: '✚' },
];

/** 惰性补建：旧账本（v1.2.8 及更早创建）没有默认分类时补一套，幂等 */
function ensureDefaultCats() {
  if (!_db) return;
  let changed = false;
  for (const l of _db.ledgers) {
    if (!_db.categories.some((c) => c.ledger_id === l.id)) {
      DEFAULT_CATS.forEach((c, i) => {
        _db!.categories.push({
          id: nextId(_db!), ledger_id: l.id, name: c.name, type: c.type, icon: c.icon,
          sort_order: i, created_at: now(),
        });
      });
      changed = true;
    }
  }
  if (changed) save();
}

function save() { if (_db) localStorage.setItem(DB_KEY, JSON.stringify(_db)); }
function nextId(db: DB): number { return db.seq++; }
const yuan = (cents: number) => Number((cents / 100).toFixed(2));
const cents = (y: number) => Math.round(Number(y) * 100);
const txSqlDate = (d: string) => d.replace('T', ' ');

/**
 * 口语化金额解析（支持中文数字 + 万/千/百单位）
 * 例：38块 / 38.5元 / 5块2毛 / 5000 / 5万块(50000) / 1.2万(12000) / 3千5(3500)
 *    一万五(15000) / 三千五百(3500) / 五十块(50) / 一百二(120) / 工资收入5万块(50000)
 * 返回「元」为单位的数字；解析不到返回 null
 */
function parseAmountCn(s: string): number | null {
  // 0) 阿拉伯数字 + 中文单位（含零头）：5万 / 1.2万 / 3千5 / 8百5
  const m = s.match(/(\d+(?:\.\d+)?)\s*(万|千|百)\s*(\d+(?:\.\d+)?)?/);
  if (m) {
    const unit = m[2] === '万' ? 10000 : m[2] === '千' ? 1000 : 100;
    const main = Number(m[1]) * unit;
    if (m[3] !== undefined) {
      const subUnit = m[2] === '万' ? 1000 : m[2] === '千' ? 100 : 10;
      return main + Number(m[3]) * subUnit;
    }
    return main;
  }
  // 1) 元角分：38.5元 / 38块5毛 / 5块2 / ¥38 / ￥38
  const m1 = s.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱|¥|￥)/);
  const m2 = s.match(/(\d+)\s*块\s*(\d+)\s*(?:毛|角)?/);
  if (m2) return Number(m2[1]) + Number(m2[2]) / 10;
  if (m1) return Number(m1[1]);
  // 2) 中文数字 + 块 + 角：三十八块五(38.5) / 五块二(5.2) / 一块五(1.5)
  const cnDigits: Record<string, number> = { 零: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 俩: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9, '０': 0, '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9 };
  const cnUnits: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 萬: 10000, 亿: 100000000, 億: 100000000 };
  const CN_CHARS = '[零〇一二两俩三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億０１２３４５６７８９]';
  const mCnMoney = s.match(new RegExp(`(${CN_CHARS}+)\\s*块\\s*([${CN_CHARS.slice(1, -1)}])?\\s*(?:毛|角)?`));
  if (mCnMoney) {
    const whole = cn2num(mCnMoney[1], cnDigits, cnUnits);
    const dec = mCnMoney[2] ? cnDigits[mCnMoney[2]] / 10 : 0;
    if (whole > 0) return whole + dec;
  }
  // 2.5) 财务完整格式：叁拾贰万捌仟零陆元柒角捌分 → 328006.78（元+角+分）
  const mCnYuanJiao = s.match(new RegExp(`(${CN_CHARS}+)元(${CN_CHARS})?(?:角|毛)?(${CN_CHARS})?分?`));
  if (mCnYuanJiao) {
    const whole = cn2num(mCnYuanJiao[1], cnDigits, cnUnits);
    const dec = (mCnYuanJiao[2] ? cnDigits[mCnYuanJiao[2]] / 10 : 0) + (mCnYuanJiao[3] ? cnDigits[mCnYuanJiao[3]] / 100 : 0);
    if (whole > 0) return whole + dec;
  }
  // 3) 中文数字：一万五 / 三千五百 / 五十块 / 一百二 / 十五块 / 壹佰贰拾叁
  const cnNumMatch = s.match(new RegExp(`(${CN_CHARS}+)\\s*(?:元|块|块钱)?`));
  if (cnNumMatch) {
    const cn = cnNumMatch[1];
    // 纯中文数字 → 数字
    const n = cn2num(cn, cnDigits, cnUnits);
    if (n > 0) return n;
  }
  // 4) 纯阿拉伯数字结尾：5000 / 38
  const m3 = s.match(/(\d+(?:\.\d+)?)\s*$/);
  if (m3) return Number(m3[1]);
  return null;
}

/** 中文数字串 → 数值（支持：五十/三百/四千/五万/三万五/三千五/一百二/十五/壹佰贰拾叁/五亿） */
function cn2num(cn: string, digits: Record<string, number>, units: Record<string, number>): number {
  let total = 0;      // 已结算（亿/万级别）
  let section = 0;    // 当前小节（万以下）
  let num = 0;        // 当前数字位
  let lastUnit = 1;   // 最近一次大单位（用于「三千五」省略单位补位）
  for (const ch of cn) {
    if (ch in digits) { num = digits[ch]; continue; }
    if (ch in units) {
      const u = units[ch];
      if (u === 10000 || u === 100000000) {
        // 万/亿：结算当前小节并累计
        total += (section + (num || 1)) * u;
        section = 0; num = 0; lastUnit = u;
      } else {
        // 十/百/千：进小节
        section += (num || 1) * u;
        num = 0; lastUnit = u;
      }
    }
  }
  // 末尾残留数字：口语省略单位（三万五=35000、三千五=3500、一百二=120）
  // 但含「零」时数字位完整（捌仟零陆=8006），不补位
  if (num > 0 && lastUnit >= 10 && !cn.includes('零')) {
    return total + section + num * (lastUnit / 10);
  }
  return total + section + num;
}

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
    db.ledgers.push(l);
    // 新账本自动生成默认分类（支出/收入各一套），否则记账永远无分类
    DEFAULT_CATS.forEach((c, i) => {
      db.categories.push({
        id: nextId(db), ledger_id: l.id, name: c.name, type: c.type, icon: c.icon,
        sort_order: i, created_at: now(),
      });
    });
    save();
    return Promise.resolve(l);
  },
  setActiveLedger: (id: number): Promise<{ ok: boolean }> => {
    const db = load();
    db.ledgers.forEach((l) => { l.is_active = l.id === id ? 1 : 0; l.updated_at = now(); });
    save();
    return Promise.resolve({ ok: true });
  },
  deleteLedger: (id: number): Promise<{ ok: boolean }> => {
    const db = load();
    const idx = db.ledgers.findIndex((l) => l.id === id);
    if (idx < 0) return Promise.reject(new Error('账本不存在'));
    const wasActive = db.ledgers[idx].is_active === 1;
    // 连带删除该账本的所有关联数据（流水/账户/分类/标签/预算/标签关联）
    const ledgerIds = new Set([id]);
    db.transactions = db.transactions.filter((t) => !ledgerIds.has(t.ledger_id));
    db.accounts = db.accounts.filter((a) => !ledgerIds.has(a.ledger_id));
    db.categories = db.categories.filter((c) => !ledgerIds.has(c.ledger_id));
    db.tags = db.tags.filter((t) => !ledgerIds.has(t.ledger_id));
    db.budgets = db.budgets.filter((b) => !ledgerIds.has(b.ledger_id));
    db.transaction_tags = db.transaction_tags.filter((tt) => !ledgerIds.has(tt.ledger_id));
    db.ledgers.splice(idx, 1);
    // 删的是当前账本 → 自动切换到第一个剩余账本（若有）
    if (wasActive && db.ledgers.length > 0) {
      db.ledgers[0].is_active = 1;
      db.ledgers[0].updated_at = now();
    }
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
    const amountYuan = parseAmountCn(s);
    if (amountYuan === null || amountYuan <= 0) return Promise.reject(new Error('未识别到金额'));
    // 收支类型：收入关键词优先（工资收入5万块 → income），无收入词再看出支词，默认支出
    const kwIncome: [string, string[]][] = [
      ['工资', ['工资', '薪金', '薪水', '薪资', '发工资', '工资条', '工资到账']],
      ['奖金', ['奖金', '年终奖', '绩效', '提成']],
      ['报销', ['报销', '报销款']],
      ['理财', ['利息', '分红', '理财', '基金', '股票', '收益', '租金']],
      ['其他收入', ['收入', '收款', '收到', '进账', '入账', '红包到账', '收到红包']],
    ];
    // 注意：分类按顺序匹配，具体词（话费/房租）放前面，泛词（买/车/费）放后面，避免误分
    const kwExpense: [string, string[]][] = [
      ['餐饮', ['餐', '饭', '咖啡', '奶茶', '外卖', '吃', '面', '火锅', '星巴克', '早餐', '午餐', '晚餐', '夜宵', '烧烤', '小龙虾', '汉堡', '炸鸡', '蜜雪', '瑞幸', '肯德基', '麦当劳', '买菜', '水果', '菜市场']],
      ['交通', ['地铁', '打车', '滴滴', '出租', '公交', '高铁', '火车', '机票', '飞机', '加油', '油费', '停车', '高速', '过路费', '车票', '共享单车', '租车']],
      ['购物', ['拼多多', '淘宝', '天猫', '京东', '抖音', '得物', '闲鱼', '唯品会', '苏宁', '小红书', '网易严选', '网购', '下单', '快递', '包裹', '商场', '逛街', '超市', '便利店', '衣服', '鞋', '数码', '手机壳', '化妆品', '护肤', '美妆', '饰品', '玩具', '文具', '日用品', '家电', '家具', '包包', '首饰', '零食', '购物', '买']],
      ['娱乐', ['电影', '游戏', 'KTV', '演唱会', '门票', '酒店', '旅行', '旅游', '景区', '会员', '爱奇艺', '腾讯视频', '视频会员']],
      ['医疗', ['药', '医院', '挂号', '体检', '看病', '药店', '诊所', '疫苗', '就诊', '检查费']],
      ['通讯', ['话费', '流量', '宽带', '套餐', '月租']],
      ['居住', ['房租', '水电', '水费', '电费', '燃气', '物业', '房贷', '装修']],
      ['人情', ['随礼', '份子', '送礼', '发红包', '礼物', '请客']],
      ['学习', ['学费', '书', '课程', '培训', '网课', '教材']],
    ];
    let txType: 'income' | 'expense' = 'expense';
    let catName: string | null = null;
    for (const [cn, words] of kwIncome) {
      if (words.some((w) => s.includes(w))) { txType = 'income'; catName = cn; break; }
    }
    if (txType === 'expense') {
      for (const [cn, words] of kwExpense) {
        if (words.some((w) => s.includes(w))) { catName = cn; break; }
      }
    }
    const cat = catName
      ? db.categories.find((c) => c.ledger_id === ledger_id && c.name === catName && c.type === txType)
      : undefined;
    // 无关键词命中 → 归入「其他」，避免误归到第一个分类
    const defCat = db.categories.find((c) => c.ledger_id === ledger_id && c.type === txType && c.name === '其他')
      ?? db.categories.find((c) => c.ledger_id === ledger_id && c.type === txType);
    const t: any = {
      id: nextId(db), ledger_id, category_id: (cat || defCat)?.id ?? null,
      account_id: null, type: txType, amount: Math.round(amountYuan * 100),
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
