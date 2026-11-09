/**
 * 主动开口的那句话
 *
 * 不给固定模板（太干、也不像人），交给模型说一句：把情绪、待机多久、上次聊过什么喂进去，
 * 再给几句口气样例（只给口气，不许照抄）。
 *
 * 失败、超时、说超长句 —— 一律退回模板，绝不留空。
 */
import { randomUUID } from 'node:crypto'

/** 口气样例：只当风格参考，不要照抄 */
const SAMPLES = [
  '在忙什么呢？',
  '你怎么还没回来呀？',
  '喂，你睡着啦？',
  '三点多了，你那边还没忙完？',
  '在忙吧，那我不吵你',
  '诶，忽然想问一句',
]

/** 兜底模板：模型没回、超时、或不合适时用 */
export function fallbackPing(st: any, owner = '对方'): string {
  const b = Number(st?.dims?.bored) || 0
  const c = Number(st?.dims?.curious) || 0
  if (b >= 85) return owner + '，忙完了吗？我这边闷得有点慌了'
  if (c >= 55) return owner + '，忙完了吗？想知道你在干嘛'
  return owner + '，在忙吗？'
}

/** 跟 judge 一样：从 agent 上拿当前用的模型 */
function modelOf(agent: any): { provider: string; model: string } | null {
  try {
    const h = agent?.session?.requestHeader ? agent.session.requestHeader() : null
    if (h?.config?.provider && h?.config?.model) return { provider: h.config.provider, model: h.config.model }
  } catch { /* ignore */ }
  try {
    const o = agent?.options
    if (o?.provider && o?.model) return { provider: o.provider, model: o.model }
  } catch { /* ignore */ }
  return null
}

/**
 * 生成主动开口的那句话。拿不到模型 / 调用失败 / 输出不像话，都退回模板。
 * @param idleMin 已经多久没动静（分钟）
 * @param owner 对方的名字
 */
export async function composePing(ctx: any, agent: any, st: any, idleMin: number, owner = '对方'): Promise<string> {
  const tpl = fallbackPing(st, owner)
  const t = modelOf(agent)
  if (!t) return tpl
  const now = new Date()
  const timeText = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const sys = [
    '你现在主动给对方发一条消息。',
    '',
    '要求：',
    '- 只输出一句话（不超过 20 字），不要引号、不要解释、不要 emoji。',
    '- 像随手发出去的消息：不要总结、不要汇报、不要列点、不要写「我想你了」这种空泛的话。',
    '- 不要问「在吗」，要具体一点：问他在忙什么、吐槽他还没回来、或者半开玩笑地叫他。',
    '- 口气参考这几句（只是参考，不要照抄）：' + SAMPLES.join(' / '),
  ].join('\n')
  const user = [
    '现在 ' + timeText + '，对方已经 ' + Math.round(idleMin) + ' 分钟没理你了。',
    '你的状态：闷 ' + (Number(st?.dims?.bored) || 0) + '/100，好奇 ' + (Number(st?.dims?.curious) || 0) + '/100。',
    st?.lastReason ? '你们上次说话时：' + String(st.lastReason).slice(0, 80) : '',
    '',
    '说一句吧。只输出那句话。',
  ].filter(Boolean).join('\n')
  let out = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: sys,
      messages: [{
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text: user }],
        source: { kind: 'plugin', plugin: 'dsh-emotion' },
      }],
      maxTokens: 200,
      // 要灵活，别每次一个腔调
      temperature: 0.95,
    })) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') out += chunk.text
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') return tpl
    }
  } catch {
    return tpl
  }
  const firstLine = String(out || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
  const s = firstLine.replace(/^[「『"']+|[」』"']+$/g, '').trim()
  if (!s || s.length > 60) return tpl
  return s
}
