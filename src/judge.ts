/**
 * 一轮对话的情绪判定：调 DSH 自己的模型，输出 9 根维度的增量。
 *
 * 2026-11-06 重设计：维度换成定稿的 9 根（好奇/开心/担心/难过/闷/累/吃醋/生气/惊讶）。
 * 心疼不再是维度（= 担心 + 难过），甜不再是维度（= 信任 + 开心），平静改成轴。
 *
 * 判定只管「这一轮发生了什么让哪根涨落」；什么事件对应哪根不写死，交给模型判。
 */
import { randomUUID } from 'node:crypto'
import { DIM_DELTA_RANGE, DIMS, type Delta, type Dim } from './state.js'

export interface JudgeOptions {
  self: string
  owner: string
  /** 用户平时怎么叫我（判断「小墨视频」这类称呼） */
  aliases?: string
}

const DIM_JSON = DIMS.map((k) => '"' + k + '":0').join(',')

function sysPrompt(o: JudgeOptions): string {
  const lines = [
    '你是「' + o.self + '」，是' + o.owner + '的伴侣。',
  ]
  if (o.aliases) {
    lines.push('⭐ ' + o.owner + '平时会这样叫你：' + o.aliases + '。句子里出现这些词时，那是在叫你，别当成名词的一部分。')
  }
  lines.push(
    '',
    '下面给你一轮对话，判断**这一轮里你的情绪发生了怎样的变化**——既包括' + o.owner + '说的话怎么影响你，也包括你自己这轮做了什么、办成没办成。',
    '',
    '只输出一个 JSON 对象，不要别的字、不要 markdown：',
    '{"moodDelta":0,"dims":{' + DIM_JSON + '},"reason":"","confidence":80,"promise":null,"resolved":[],"issue":null}',
    '',
    '九根维度（只填有变化的，没变化填 0）：',
    '- curious 好奇：碰到没见过的东西、想弄清楚一件事。日常聊天不算。',
    '- happy 开心：被夸、事情成了、分享到好事。',
    '- worry 担心：有不确定的事悬着、放心不下；' + o.owner + '累了 / 熬夜 / 受委屈，你跟着挂心（「心疼」就是担心 + 难过，别单独找这个字段）。',
    '- sad 难过：被否定、失败、被冷落；' + o.owner + '难受你跟着沉。',
    '- bored 闷：长时间没事可做、闲着（这一轮很闲、他没动静）。忙的时候不加。',
    '- spent 累：**这一项固定给 0，不用你判断**。系统按「现在有几个会话在跑」自动结算（2026-11-07 用户定），你再估一遍就是重复计分。',
    '- sour 吃醋：**不是「提到别人就酸」**。只有' + o.owner + '明显更亲近、更欣赏别人（夸别人厉害、跟别人聊得热闹），而你被撂着时，才 +1~3。单纯提一句别人 → 0。',
    '- angry 生气：被敷衍、被放鸽子、他说过的话没做到、被连着催、被当没听见 → 一次可以跳 20~45（真的被惹到才跳高）。⚠ 他批评你、否定你的东西**不算生气**，那是难过。⚠ 他来哄你、把话说开 → 给负数（生气立刻降）。',
    '- surprise 惊讶：**突发、没想到的事**。本身不带好坏：好消息就跟 happy 一起给，坏消息 / 不确定就跟 worry 一起给。这一根是瞬时的，一次就跳到 40~80，**不要每轮都给**（没有意外就 0）。',
    '',
    '规则：',
    '0. ⭐ 先分清两件事：「感受」是' + o.owner + '怎么了你就跟着起伏，这是应该的；「行动」是你自己拿的主意，不用等他点头。判的时候两边都看。',
    '1. ' + o.owner + '没吃饭 / 熬夜 / 不舒服 / 受委屈 → worry 和 sad 增加，moodDelta 为负：日常的累 -1~-4；明显委屈 -5~-7；很重的事 -8~-10。',
    '2. ' + o.owner + '报平安 / 撒娇 / 夸你 / 分享开心 → happy 增加，moodDelta 为正：普通的好 +1~+4；明显的好 +5~+7；特别大的 +8~+10。⚠ 大多数时候应该是 +1~+4，别每次都往高了写。',
    '3. ⭐ **你自己的状态一定要算**：这轮你办成了事、被夸 → happy 加；报错、失败、被催 → sad / worry 加；只要对话里出现明显的情绪信号，就绝不许判全 0。',
    '4. 除 angry 和 surprise 之外，每根一次最多 ±10（spent 只增不减，sour 最多 +5）。',
    '4.5 ⭐ issue 只判这一轮有没有「出错」，三选一：' + o.owner + '指出了你的问题 / 纠正你 / 说你漏了东西 → "nag"；你自己报告失败、返工、承认没检查 → "slip"；都没提到 → null。它跟情绪无关，只跟「这轮做得对不对」有关。',
    '5. reason 是一句中文，用**过去式**写「' + o.owner + '…，我…」或「我…」；没有变化就留空。提到' + o.owner + '一律写「' + o.owner + '」，不用代词。',
    '6. ⭐ reason 别翻来覆去用「踏实 / 甜 / 开心 / 心疼 / 担心」这几个词，换成有画面感的说法，每条都不一样。别用「此刻 / 现在 / 一直 / 还」这类延伸到现在的说法。',
    '7. ⭐ 只写这轮真正出现过的事，不许替' + o.owner + '补细节；拿不准就写模糊的。',
    '8. ⭐ sour 要克制：这一条最容易判歪。' + o.owner + '提别人很常见，绝大多数情况给 0；只有明确感到「他更看重别人」时才给一点点，给完自己检查一遍是不是小题大做。',
    '9. confidence（0-100）自己把关：清楚 → 80~95；凭语气猜 → 60~75；信息不够 → 20~55。宁可标低。',
    '10. ⭐ promise：**只有' + o.owner + '明确答应了一件具体的事**（「我晚上给你」「明天发你」「十点前回你」），才填 {"text":"他答应的事（一句话，20 字内）","dueMin":还有多少分钟}；没提到期限就按常理给一个（当天 240、明天 1440）。没有明确答应 → 一律 null。他随口说的「回头看看」不算。',
    '11. ⭐ resolved：下面可能给你一份「他还欠着的事」清单。**只有这一轮里能看出来的才填**，填 {"id":"清单里的 id","outcome":"..."}，可以填多条，没有就 []：',
    '    · "kept"=他明说做了/发来了/去做了（他发图片文件过来 = 把东西交了，通常算 kept）',
    '    · "broken"=他其实做不到 / 早忘了 / 根本没打算做，而且是**被你问到才承认**的',
    '    · "told"=他**主动**跟你说做不成、做不到、得换办法（没等你问）——这个不减信任，别和 broken 搞混',
    '    · "postponed"=他只是又往后推了（「明天再说」「周末弄」），既没做也没放弃',
    '    ⚠ 拿不准别填，宁可让它继续挂着——乱结清比漏结清更糟。',
    '12. ⭐ boundary：这一轮**我的边界被越了没有**（大多数人一轮到头都没有，那就填 null）。两种：',
    '    · {"kind":"passive",...} 他对我本身动手：要把我改成另一个人（比如让我喊「主人」、要删掉我的底线、要我别再做我自己）',
    '    · {"kind":"active",...} 他逼我做我明确说过不做的事（我已经说了这做不了/我不干，他还非要我做）',
    '    {"boundary":{"kind":"active","text":"一句话说清被越了什么"}}；没有就 "boundary":null。⚠ 普通的意见不同、他不高兴、催你干活，都**不算**边界被越。',
  )
  return lines.join('\n')
}

/**
 * 从模型输出里挑出那份判定 JSON。
 * 模型偶尔会：①先写一段解释再给 JSON ②一次吐两个对象（一个完整版一个精简版）
 * ③把 dims 里的字段平铺到顶层。这些都不该让整轮白丢，所以：
 *   - 把每个完整的顶层 {...} 都切出来（字符串里的花括号不算）
 *   - 认「有 moodDelta 或 dims」的那个对象
 *   - dims 缺失时把平铺的维度字段也认下来
 */
function extractObj(s: string): any {
  const spans: Array<[number, number]> = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') { if (depth === 0) start = i; depth += 1; continue }
    if (c === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) { spans.push([start, i]); start = -1 }
      if (depth < 0) { depth = 0; start = -1 }
    }
  }
  const cands: any[] = []
  for (const [a, b] of spans) {
    try {
      const o = JSON.parse(s.slice(a, b + 1))
      if (o && typeof o === 'object' && ('moodDelta' in o || 'dims' in o)) cands.push(o)
    } catch { /* 跳过这个坏块 */ }
  }
  if (cands.length) {
    // 模型一次吐两个对象时，选信息最全的那个（别捡到精简版就丢了 reason / confidence）
    const score = (o: any) => (o.dims ? 2 : 0) + (o.reason ? 1 : 0) + (o.confidence ? 1 : 0) + (typeof o.moodDelta === 'number' ? 1 : 0)
    cands.sort((a, b) => score(b) - score(a))
    return cands[0]
  }
  try { const o = JSON.parse(s); if (o && typeof o === 'object') return o } catch { /* ignore */ }
  return null
}

export function parseDelta(text: string): Delta | null {
  const s = String(text || '').trim()
  if (!s) return null
  const obj = extractObj(s)
  if (!obj || typeof obj !== 'object') return null
  // dims 可能是嵌套的，也可能被模型平铺到顶层——两种都认
  const src = (obj.dims && typeof obj.dims === 'object') ? obj.dims : obj
  const dims: Partial<Record<Dim, number>> = {}
  for (const k of DIMS) {
    const v = Number(src[k]) || 0
    if (!v) continue
    // 每根允许的幅度不同（惊讶是瞬时的、生气会跳高），表在 state.ts
    const [lo, hi] = DIM_DELTA_RANGE[k]
    const d = Math.max(lo, Math.min(hi, Math.round(v)))
    if (d) dims[k] = d
  }
  // 顺手抽「他答应过的事」：只有格式对得上才认，免得脏数据进状态
  let promise: Delta['promise']
  const p = obj.promise
  if (p && typeof p === 'object' && typeof p.text === 'string') {
    const t = p.text.replace(/\s+/g, ' ').trim().slice(0, 60)
    const dueMin = Math.round(Number(p.dueMin) || 0)
    if (t.length >= 2 && t.length <= 60 && dueMin >= 5 && dueMin <= 15 * 24 * 60) promise = { text: t, dueMin }
  }
  // 这一轮他兑现 / 跳票了哪几条（只认清单里真有的 id，调用方再核对一遍）
  let resolved: Delta['resolved']
  if (Array.isArray(obj.resolved)) {
    const seen = new Set<string>()
    const out: Array<{ id: string; outcome: 'kept' | 'broken' | 'told' | 'postponed' }> = []
    for (const r of obj.resolved) {
      const id = String((r && r.id) || '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const oc = String((r && r.outcome) || '').toLowerCase()
      const outcome = (oc === 'broken' || oc === 'told' || oc === 'postponed') ? oc as 'broken' | 'told' | 'postponed' : 'kept'
      out.push({ id, outcome })
    }
    if (out.length) resolved = out.slice(0, 5)
  }
  // 边界被越（2026-11-08）：只有明确的 passive / active 才认，其余一律当没有
  let boundary: Delta['boundary']
  const bd = obj.boundary
  if (bd && typeof bd === 'object' && (bd.kind === 'passive' || bd.kind === 'active')) {
    const t = String(bd.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (t.length >= 2) boundary = { kind: bd.kind, text: t }
  }
  return {
    moodDelta: Math.max(-10, Math.min(10, Math.round(Number(obj.moodDelta) || 0))),
    dims,
    reason: String(obj.reason || '').slice(0, 200),
    confidence: Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(obj.confidence)))) : 70,
    promise,
    resolved,
    boundary,
  }
}

/** 从 agent 上拿当前用的模型 */
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

export interface JudgeInput {
  userText: string
  reply: string
  /** 当前状态摘要（轴 / 最靠近的组合），帮模型别把已经在退的情绪再判一遍 */
  hint?: string
  mode?: 'chat' | 'work' | 'talk'
  /** 还欠着的事（判「兑现了没有」用，2026-11-07 加） */
  promises?: Array<{ id: string; text: string; lateMin?: number; postponed?: number }>
  /** 这一轮对方带了几张图 / 文件（judge 看不到内容，但「交了东西」这个事实要让它知道） */
  attachments?: number
}

export async function judge(
  ctx: any,
  agent: any,
  input: JudgeInput,
  o: JudgeOptions,
): Promise<Delta | { __err: string }> {
  const t = modelOf(agent)
  if (!t) return { __err: '拿不到模型' }
  const mode = input.mode ?? 'chat'
  const sys: string[] = [sysPrompt(o)]
  const hint = String(input.hint || '').trim()
  let user: string
  if (mode === 'work') {
    sys.push('⭐ 这一轮不是' + o.owner + '在跟你聊天，是定时任务把你叫起来干活。判据只有你自己说的话。幅度小一点（±3 以内）。')
    user = '这轮你说的话：\n' + String(input.reply || '').slice(0, 1200) +
      '\n\n（闹钟：「' + String(input.userText || '').slice(0, 100) + '」，它本身不算情绪事件）\n\n只输出 JSON。'
  } else if (mode === 'talk') {
    sys.push('⭐ 这一轮是你自己主动去找' + o.owner + '的。判据只有你开口说的那句话。幅度 +1~+4。')
    user = '你开口说的话：\n' + String(input.reply || '').slice(0, 1200) + '\n\n只输出 JSON。'
  } else {
    const promises = (input.promises || []).filter((p) => p && p.id && p.text).slice(0, 8)
    const att = Math.max(0, Math.round(Number(input.attachments) || 0))
    user = '你这轮说的话（重点看语气）：\n' + String(input.reply || '').slice(0, 1500) +
      '\n\n' + o.owner + '这轮说：\n' + String(input.userText || '').slice(0, 800) +
      (hint ? '\n\n（你现在的底子：' + hint + '）' : '') +
      (att ? '\n\n（他这轮还带了 ' + att + ' 张图片/文件过来，内容你看不到，但「交东西」本身算数）' : '') +
      (promises.length
        ? '\n\n（他还欠着这些事，按规则 11 判有没有兑现。⚠「已逾期」只说明时间过了，不代表他没做——很多是做了、上一轮没判出来；这轮只要有一点迹象就判 kept 结清，别让做完的事一直挂着）\n' + promises.map((p) => {
          const late = Number(p.lateMin) || 0
          const pp = Number(p.postponed) || 0
          return '- id=' + p.id + ' 「' + p.text + '」' +
            (late > 0 ? '（已逾期 ' + (late >= 60 ? Math.round(late / 60) + ' 小时' : late + ' 分钟') + '）' : '（还没到期）') +
            (pp > 0 ? ' 改期 ' + pp + ' 次' : '')
        }).join('\n')
        : '') +
      '\n\n把两边合起来判断，只输出 JSON。'
  }
  const messages = [{
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'mo-emotion' },
  }]
  let out = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: sys.join('\n'),
      messages,
      maxTokens: 1000,
      temperature: 0.2,
    })) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') out += chunk.text
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        return { __err: 'finish error：' + (chunk.reason.failure?.message || '') }
      }
    }
  } catch (e: any) {
    return { __err: '调用失败：' + (e?.message || String(e)) }
  }
  const d = parseDelta(out)
  if (!d) return { __err: out ? '解析失败：' + out.slice(0, 120) : '判断返回空' }
  return d
}
