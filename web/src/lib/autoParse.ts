// 自动抓取解析器 — 把短信 / 通知 text 拆成 (amount, merchant, time, category) 候选
//
// 设计要点：
//  - 完全本地规则，不联网调用任何 AI/LLM
//  - 支持常见银行的消费短信 + 微信支付 + 支付宝通知 + 云闪付
//  - 解析失败时仍返回原始备注，由用户手动确认
//
// 与 apiLocal.ts 里现存的 parseTransaction 兼容：返回结构 { amount, category?, note, occurred_at }。

export type ParseSource = 'sms' | 'notification' | 'manual';

export interface ParsedTx {
  /** 解析得到的金额（分，单精度整数为分更稳） */
  amount?: number;
  /** 商家 / 交易对象（用于 note） */
  merchant?: string;
  /** 推测的分类（餐饮/购物/...） */
  category?: string;
  /** 推荐记账类型（默认 'expense'，可推断为 'income' 时改） */
  type?: 'expense' | 'income';
  /** 事件发生时间（本地时间字符串 "YYYY-MM-DD HH:MM:SS"），默认取当前时间 */
  occurred_at?: string;
  /** 解析置信度 0-1，用于在 UI 里标灰（低置信度条目用户需二次确认） */
  confidence: number;
  /** 解析来源 */
  source: ParseSource;
  /** 调试用的内部命中痕迹 */
  hints: string[];
}

/* ==================== 关键字配置 ==================== */
const TX_TYPE_EXPENSE_WORDS = ['消费', '支出', '付款', '支付', '扣款', '取现', '提现', '转账', '转账支出', '快捷支付'];
const TX_TYPE_INCOME_WORDS  = ['收入', '入账', '收到', '转入', '退款', '返款', '红包', '退还'];

const BANK_SENDER_PREFIXES = [
  '95588', '95555', '95566', '95559', '95500', '95501', '95528', // 工商/招行/建行/中信/农行等
];

/* ==================== 工具 ==================== */
function toYuan(fen: number): number { return Math.round(fen) / 100; }
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 把任意字符串中的金额数字全部抽取出来。返回单位为分的整数（"38.5" → 3850）。
 * 同时处理 ¥ ￥ 元 人民币 等符号。
 *
 * 要求至少一个金额相关 token（¥/￥/RMB/人民币/元/块），避免把银行客服号
 * （95588 / 95566 这种 5 位数）误识别成金额。
 */
function extractAmounts(text: string): number[] {
  if (!text) return [];
  const cleaned = text.replace(/[,，]/g, '');
  // 必须有 ¥/￥/RMB/人民币/元/块 之一锚定
  const re = /(?:¥|￥|RMB|人民币)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块)/gi;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const v = parseFloat(m[1] || m[2]);
    if (Number.isFinite(v) && v > 0 && v < 1_000_000) {
      out.push(Math.round(v * 100));
    }
  }
  return out;
}

/**
 * 从时间文本里猜时间。优先用 SMS 提供的 timestamp，否则用本次解析时间。
 */
function pickTime(smsTs: number | undefined, now = new Date()): Date {
  if (typeof smsTs === 'number' && smsTs > 0) return new Date(smsTs);
  return now;
}

/* ==================== 分类启发 ==================== */
const CATEGORY_RULES: Array<{ kw: RegExp; cat: string; icon?: string }> = [
  { kw: /(星巴克|瑞幸|M Stand|Manner|喜茶|奈雪|蜜雪|古茗|茶百道|一点点|沪上阿姨|咖啡|奶茶|麦当劳|肯德基|KFC|必胜客|汉堡王|海底捞|外卖|饿了么|美团)/i, cat: '餐饮' },
  { kw: /(京东|淘宝|天猫|拼多多|苏宁|国美|唯品会|网易严选|山姆|Costco|屈臣氏|711|罗森|全家|便利店|超市|便利店)/i, cat: '购物' },
  { kw: /(滴滴|出租车|网约车|地铁|公交|高铁|12306|铁路|航班|机票|机场|打车|骑行|共享单车|摩拜|哈啰|ofo)/i, cat: '交通' },
  { kw: /(中石化|中石油|加油|充电|特来电|星星充电|国家电网)/i, cat: '交通' },
  { kw: /(话费|流量|宽带|电信|移动|联通|携程|飞猪)/i, cat: '通讯' },
  { kw: /(医院|药房|药店|美团买药|京东健康|平安好医生|挂号)/i, cat: '医疗' },
  { kw: /(房租|物业|水电|电费|水费|燃气费|供暖)/i, cat: '居住' },
  { kw: /(腾讯视频|爱奇艺|优酷|哔哩哔哩|B站大会员|网易云|QQ音乐|酷狗|酷我|网易严选|得到|喜马拉雅|掌阅|起点)/i, cat: '订阅' },
  { kw: /(微信红包|红包|转账)/i, cat: '转账' },
];

function guessCategory(text: string): string | undefined {
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.test(text)) return rule.cat;
  }
  return undefined;
}

/* ==================== 解析入口 ==================== */

/** 解析一条短信 */
export function parseSms(sender: string, body: string, smsTs?: number): ParsedTx | null {
  const text = `${sender || ''} ${body || ''}`.trim();
  if (!text) return null;

  const hints: string[] = [];
  const amts = extractAmounts(text);
  if (amts.length === 0) {
    hints.push('no_amount');
    return { confidence: 0, source: 'sms', hints, occurred_at: formatDate(pickTime(smsTs)) };
  }
  // 取最大那个金额（一般是扣款总额）
  const amountFen = Math.max(...amts);
  hints.push(`amount=${toYuan(amountFen)}`);

  // 判断支出 / 收入
  let type: 'expense' | 'income' = 'expense';
  if (TX_TYPE_INCOME_WORDS.some((w) => text.includes(w))) type = 'income';
  else if (TX_TYPE_EXPENSE_WORDS.some((w) => text.includes(w))) type = 'expense';
  hints.push(`type=${type}`);

  // 商家：去掉金额/类型词/银行前缀后剩下的尾部
  let merchant = '';
  const tail = body.replace(/\s+/g, ' ').trim();
  const merchantMatch = tail.match(/(?:于|在|消费于|付款给|支付给|商户|商家)[\s:：]*([^\s,，。.\-_]{2,20})/);
  if (merchantMatch) merchant = merchantMatch[1];
  hints.push(`merchant_guess=${merchant || 'n/a'}`);

  const category = guessCategory(text);
  if (category) hints.push(`cat=${category}`);

  // 置信度：金额必备 +1，类型词命中 +0.2，分类命中 +0.2，商家命中 +0.2，封顶 1
  let confidence = 0.4;
  if (type === 'expense' || type === 'income') confidence += 0.15;
  if (category) confidence += 0.2;
  if (merchant) confidence += 0.2;
  confidence = Math.min(1, confidence);

  const note = merchant || guessNoteFromSender(sender, body) || tail.slice(0, 24);

  return {
    amount: amountFen,
    merchant,
    category,
    type,
    confidence,
    source: 'sms',
    hints,
    occurred_at: formatDate(pickTime(smsTs)),
  };
}

/** 解析一条通知（微信/支付宝/银行 App） */
export function parseNotification(pkg: string, title: string, text: string, postedAt: number): ParsedTx | null {
  const body = `${title || ''} ${text || ''}`.trim();
  if (!body) return null;

  const hints: string[] = [`pkg=${pkg}`];

  const amts = extractAmounts(body);
  if (amts.length === 0) {
    hints.push('no_amount');
    return { confidence: 0, source: 'notification', hints, occurred_at: formatDate(new Date(postedAt)) };
  }
  const amountFen = Math.max(...amts);
  hints.push(`amount=${toYuan(amountFen)}`);

  // 通知大多明确说"付款成功/收款"等
  let type: 'expense' | 'income' = 'expense';
  if (/(收款|到账|入账|红包|退款)/.test(body)) type = 'income';
  hints.push(`type=${type}`);

  // 商家/对方：标题里常有 "微信支付 · 星巴克"
  let merchant = '';
  const merchantMatch = body.match(/(?:微信支付|支付宝支付|付款给|收款来自|来自|to|向)\s*[·\.·]?\s*([\u4e00-\u9fff\w]{2,16})/);
  if (merchantMatch) merchant = merchantMatch[1];
  if (!merchant) {
    // 退路：标题可能就是商家名
    if (title && title.length <= 16 && /[\u4e00-\u9fff]/.test(title)) merchant = title;
  }
  hints.push(`merchant_guess=${merchant || 'n/a'}`);

  const category = guessCategory(body);
  if (category) hints.push(`cat=${category}`);

  let confidence = 0.5;
  if (merchant) confidence += 0.25;
  if (category) confidence += 0.2;
  confidence = Math.min(1, confidence);

  const note = merchant || body.slice(0, 24);

  return {
    amount: amountFen,
    merchant,
    category,
    type,
    confidence,
    source: 'notification',
    hints,
    occurred_at: formatDate(new Date(postedAt)),
  };
}

function guessNoteFromSender(sender: string, body: string): string {
  if (BANK_SENDER_PREFIXES.includes(sender)) return '银行卡消费';
  if (sender.includes('支付宝')) return '支付宝消费';
  if (sender.includes('微信')) return '微信消费';
  return body.replace(/\s+/g, ' ').slice(0, 18);
}

/* ==================== 批量解析 ==================== */

export interface RawSms { sender: string; body: string; date: number; }
export interface RawNotification { packageName: string; title: string; text: string; postedAt: number; }

/** 解析一批短信，返回解析成功的（amount 已抽出、confidence >= 0.3） */
export function parseSmsBatch(items: RawSms[]): ParsedTx[] {
  const out: ParsedTx[] = [];
  for (const it of items) {
    const r = parseSms(it.sender, it.body, it.date);
    if (r && r.amount && r.confidence >= 0.3) out.push(r);
  }
  return out;
}
export function parseNotificationBatch(items: RawNotification[]): ParsedTx[] {
  const out: ParsedTx[] = [];
  for (const it of items) {
    const r = parseNotification(it.packageName, it.title, it.text, it.postedAt);
    if (r && r.amount && r.confidence >= 0.3) out.push(r);
  }
  return out;
}
