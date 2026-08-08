// DeepSeek 大模型客户端 — OpenAI 兼容接口（api.deepseek.com）
// 用于自然语言记账解析：把一句话/语音文本解析为结构化记账字段
// 配置：环境变量 DEEPSEEK_API_KEY（必填，DeepSeek 开放平台 API Key）
//       环境变量 DEEPSEEK_MODEL（可选，默认 deepseek-chat；V4 系列可用 deepseek-v4-pro / deepseek-v4-flash）
// 未配置 DEEPSEEK_API_KEY 时返回 null，由调用方降级到豆包/规则解析
// 注意：DeepSeek 为纯文本模型，不做语音识别（ASR）——本模块只负责「文本 → 记账结构」解析

const DS_ENDPOINT = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const DS_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_TIMEOUT = 15000;

/** DeepSeek 是否已配置（有 API Key 即视为可用） */
export function isDeepSeekConfigured() {
  return Boolean(DS_API_KEY);
}

/**
 * 用 DeepSeek 大模型解析自然语言记账文本
 * @param {string} text 原始文本（如「昨天星巴克咖啡38块」）
 * @returns {Promise<object|null>} 解析结果 { type, amount, note, occurred_at, category, raw } 或 null（失败）
 */
export async function parseWithDeepSeek(text) {
  if (!DS_API_KEY) return null;

  const sysPrompt = `你是记账助手。请把用户的自然语言记账内容解析为 JSON，只输出 JSON 不要多余文字。
规则：
- type: "expense"（支出）或 "income"（收入）
- amount: 金额数字（元，number）
- note: 简短备注（去掉金额和日期，保留商家/用途）
- category: 分类名（从：餐饮、交通、购物、娱乐、医疗、通讯、教育、人情、居住 中选一个最接近的）
- occurred_at: 交易时间，格式 "YYYY-MM-DD HH:mm"，根据文本中的「今天/昨天/前天/X月X日」推算；没提到就用今天
示例输入：昨天星巴克咖啡 38 块
示例输出：{"type":"expense","amount":38,"note":"星巴克咖啡","category":"餐饮","occurred_at":"2026-08-07 10:00"}
只输出一个 JSON 对象。`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DS_TIMEOUT);
    const res = await fetch(DS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DS_API_KEY}`,
      },
      body: JSON.stringify({
        model: DS_MODEL,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: String(text).slice(0, 200) },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(`[deepseek] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    // 提取 JSON（兼容模型输出多余文字）
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);

    // 校验并规整
    const amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const type = parsed.type === 'income' ? 'income' : 'expense';
    const note = String(parsed.note || '').trim().slice(0, 50) || '语音记账';
    // occurred_at 规整为 YYYY-MM-DD HH:mm
    let occurredAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const atMatch = String(parsed.occurred_at || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (atMatch) {
      const [, Y, M, D, h, mi] = atMatch;
      const d = new Date(Number(Y), Number(M) - 1, Number(D), Number(h), Number(mi), 0);
      occurredAt = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
    }

    return {
      type,
      amount: Number(amount.toFixed(2)),
      note,
      category: String(parsed.category || '').trim() || null,
      occurred_at: occurredAt,
      raw: String(text).slice(0, 80),
    };
  } catch (e) {
    console.error(`[deepseek] 解析失败: ${e.message}`);
    return null;
  }
}
