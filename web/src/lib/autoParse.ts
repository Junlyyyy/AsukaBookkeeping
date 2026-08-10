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

/** 非银行发件人黑名单 —— 验证码平台 / 营销短信 / 106/121/171 号段等，根本不是消费记录，直接拒。
 * 银行号段（955xx/100xx/123xx 等）已在 BANK_SENDER_PREFIXES 白名单精确匹配，不进黑名单。 */
const NON_BANK_SENDER_PREFIXES = [
  '106', // 三大运营商短信端口号段（验证码、营销）
  '121', // 短信端口
  '171', // 短信端口
];

/** 短信解析专用 —— 单笔合理上限 10 万。短信里出现 ≥10 万通常是把电话号码/时间戳/图片 ID 等当成了金额 */
const SMS_AMOUNT_MAX = 100_000;

/** 验证码 / 一次性口令类短信特征 —— 命中直接跳过（不是交易记录） */
const OTP_PATTERNS = /验证码|动态码|校验码|安全码|登录码|注册码|短信验证|一次性密码|OTP|一次有效|请在\s*\d+\s*(?:分钟|秒)|分钟内有效|有效期|不要泄露|请勿泄露|请勿转发/;

/** 交易动词 —— 金额必须紧跟其后才算交易金额（避免验证码/余额误判） */
const TX_VERB_RE = /(消费|支出|支付|付款|扣款|转账|转出|提现|收款|收入|入账|退款|返款|退回|买入|卖出|充值|缴费)\s*(?:人民币|RMB|rmb)?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)?/gi;

/** 数字附近的账户信息语境 —— 这些数字不是交易金额 */
const NON_AMT_CONTEXT = /余额|可用|限额|额度|上限|下限|有效期|尾号|剩余|积分|总计|总额|信用卡额度|取现额度/;

/** 短信商家提取 — 多模式正则集合（参考 XUranus/sms-filter 的银行短信规则）。
 *  命中后取第一个非空捕获组，按下面顺序尝试：
 *  1) 【XX】方括号标签（电商平台、银行商户名常用）
 *  2) 商户:/商家:/收款方:/付款方:/付款给:（明示标签）
 *  3) 于/在/消费于/付款给/支付给（自然语序）
 *  4) 备注: 后置描述
 */
const MERCHANT_PATTERNS: RegExp[] = [
  /(?:商户|商家|收款方|付款方|付款给|收款人|对方|对方户名|付款账户名)[\s:：]+([^\s,，。\-\_]{2,20})/,
  /(?:向|在|于|消费于|付款给|支付给)[\s:：]*([^\s,，。\-\_【】]{2,20})(?:付款|支付|消费|支出|扣款|转账|转出)/,
  /【([^【】\n]{2,20})】/,
  /备注[\s:：]+([^\s,，。]{2,30})/,
];

function cleanSmsBody(body: string): string {
  return String(body || '')
    .replace(/【[^【】]{1,30}】/g, '')            // 去掉【XX】标签
    .replace(/\d{4}[年-]\d{1,2}[月-]\d{1,2}/g, '') // 去掉 2026年07月12日 / 2026-07-12
    .replace(/\d{1,2}时\d{1,2}分(?:\d{1,2}秒)?/g, '') // 去掉 13时14分
    .replace(/[\s,，。]+/g, ' ')
    .trim();
}

/* ==================== 工具 ==================== */
function toYuan(fen: number): number { return Math.round(fen) / 100; }
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 把任意字符串中的金额数字全部抽取出来。返回单位为分的整数（"38.5" → 3850）。
 *
 * 策略（参考 upi_sms_parser 的 5-gate 模型 + 交易动词锚定）：
 *  - strongOnly=true ：只找「交易动词 + 金额」（转账5000元 / 消费38.5元）——
 *    银行交易确认短信即使含验证码（「验证码6719，用于转账5000元」）也识别
 *  - strongOnly=false：先强锚定；没有时退到 ¥/￥/元/块 弱锚定，
 *    但排除「余额/限额/额度/有效期」语境（Gate1/2：钱要真的动了）
 */
function extractAmounts(text: string, strongOnly = false): number[] {
  if (!text) return [];
  const cleaned = text.replace(/[,，]/g, '');
  const out: number[] = [];
  const push = (v: number) => {
    if (Number.isFinite(v) && v > 0 && v < SMS_AMOUNT_MAX) out.push(Math.round(v * 100));
  };
  // 强锚定：交易动词 + 金额
  let m: RegExpExecArray | null;
  while ((m = TX_VERB_RE.exec(cleaned)) !== null) push(parseFloat(m[2]));
  if (strongOnly || out.length > 0) return out;
  // 弱锚定：¥/￥/RMB/人民币/元/块，排除账户信息语境
  const weakRe = /(?:¥|￥|RMB|人民币)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块)/gi;
  while ((m = weakRe.exec(cleaned)) !== null) {
    const v = parseFloat(m[1] || m[2]);
    if (!Number.isFinite(v) || v <= 0 || v >= 1_000_000) continue;
    const ctx = cleaned.slice(Math.max(0, (m.index || 0) - 20), (m.index || 0) + (m[0]?.length || 0) + 6);
    if (NON_AMT_CONTEXT.test(ctx)) continue; // 余额/限额/有效期等 → 跳过
    out.push(Math.round(v * 100));
  }
  return out;
}

/**
 * 判断短信是否纯验证码（Gate-4）：无交易动词锚定的金额 + 含 OTP 特征 → 跳过；
 * 有交易动词（转账/消费等）的银行交易确认短信即使带验证码也算交易。
 */
function extractSmsAmounts(text: string): number[] | null {
  const hasOtp = OTP_PATTERNS.test(text);
  const strong = extractAmounts(text, true);
  if (strong.length > 0) return strong;      // 交易确认短信（含验证码也算）
  if (hasOtp) return null;                    // 纯验证码 → 跳过
  return extractAmounts(text, false);         // 普通弱锚定
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

  // 非银行发件人黑名单（验证码/营销短信端口）—— 直接拒，避免把验证码短信里的数字当成金额
  if (NON_BANK_SENDER_PREFIXES.some((p) => sender.startsWith(p))) {
    hints.push('non_bank_sender');
    return { confidence: 0, source: 'sms', hints, occurred_at: formatDate(pickTime(smsTs)) };
  }

  // 验证码 / 非交易短信：只有「纯验证码（无交易动词锚定）」才跳过；
  // 「验证码6719，用于转账5000元」这类银行交易确认短信照常识别
  const amts = extractSmsAmounts(text);
  if (!amts) {
    hints.push('otp_skipped');
    return { confidence: 0, source: 'sms', hints, occurred_at: formatDate(pickTime(smsTs)) };
  }
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

  // 商家：按多模式正则依次尝试，取第一个有意义的命中（参考 XUranus/sms-filter）
  let merchant = '';
  for (const re of MERCHANT_PATTERNS) {
    const m = body.match(re);
    if (m && m[1]) {
      const cand = m[1].trim();
      // 排除明显不是商家的：纯数字、单字、含金额字符
      if (cand.length >= 2 && !/^\d+$/.test(cand) && !/[¥￥元]/.test(cand)) {
        merchant = cand;
        break;
      }
    }
  }
  hints.push(`merchant_guess=${merchant || 'n/a'}`);

  const category = guessCategory(text);
  if (category) hints.push(`cat=${category}`);

  // 置信度：金额必备 +1，类型词命中 +0.2，分类命中 +0.2，商家命中 +0.2，封顶 1
  let confidence = 0.4;
  if (type === 'expense' || type === 'income') confidence += 0.15;
  if (category) confidence += 0.2;
  if (merchant) confidence += 0.2;
  confidence = Math.min(1, confidence);

  // note：merchant 优先（最简洁）；否则取清理后的短信前 6 字（用户要求「简略显示」）
  const cleaned = cleanSmsBody(body);
  const note = merchant
    || body.match(/(?:转账|消费|支付|付款|收入|入账|退款|充值|缴费)[^,，。\s]{0,8}/)?.[0]
    || (cleaned ? cleaned.slice(0, 6) : '')
    || guessNoteFromSender(sender, body);

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

  // 验证码类通知：同样「纯验证码才跳过」，交易确认通知照常识别
  const amts = extractSmsAmounts(body);
  if (!amts) {
    hints.push('otp_skipped');
    return { confidence: 0, source: 'notification', hints, occurred_at: formatDate(new Date(postedAt)) };
  }
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

  // 商家/对方：标题里常有 "微信支付 · 星巴克"；纯数字（电话/单号）不当作商家
  let merchant = '';
  const merchantMatch = body.match(/(?:微信支付|支付宝支付|付款给|收款来自|来自|to|向)\s*[·\.·]?\s*([\u4e00-\u9fff\w]{2,16})/);
  if (merchantMatch && !/^\d{4,}$/.test(merchantMatch[1])) merchant = merchantMatch[1];
  if (!merchant) {
    // 退路：标题可能就是商家名（排除纯数字/含号码的标题）
    if (title && title.length <= 16 && /[\u4e00-\u9fff]/.test(title) && !/\d{4,}/.test(title)) merchant = title;
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
