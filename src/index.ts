/**
 * dsh-emotion — AI的情绪引擎
 *
 * P0（2026-11-05）：独立状态文件 + 只读路由 /mo-emotion/state
 * P1（2026-11-05）：每轮判断涨跌 + 注入文本（语气出口）+ 组合
 * P2（2026-11-05）：待机（好奇/闷）+ 探测 + 叫人
 * P3（2026-11-06）：重设计落地——9 根维度、平静轴、信任、4 组合、强情绪留痕
 *
 * 设计边界（用户定，别改歪）：
 *   - 平静是轴不是情绪，决定我主动做事的密度
 *   - 组合不给名字：只决定语气和驱动，不许被念出来
 *   - 私密日记事后不算账：不翻旧账、不当筹码
 *   - 累只影响别的情绪衰减速率 + 自己线性恢复
 *   - 监督只针对「他明确答应过的事」（不查岗）
 *
 * 注入文本只描述「怎么说话」，不描述「我是谁」——被念出来就成了台词。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { judge } from './judge.js'
import { composePing } from './ping.js'
export { parseDelta } from './judge.js'
import {
  STORE, activeCombos, activeSessionCount, addBoundary, addPromise, applyDelta, applyEvent, axisInfo, buildInjection,
  clamp, comboView, debtScore, decay, dimBase, growLine, growView, idleTick, loadConfig, loadState, markPresent, markSeen, maybeMarkStrong, maybeQuarrel, moodExpectedOf,
  overduePromise, pendingPromises, refreshLeadCombo, resolvePromise, resumeAfterSleep, saveConfig,
  saveState, schemaCheck, settleDebt, shouldInject, tickGrow, trustInfo, workDue, workTick,
  CFG_GROUPS, CFG_SCHEMA, DIARY_PATH, DIM_DEFS, DIM_LABEL, DIMS, type EmotionConfig,
} from './state.js'

export const name = 'mo-emotion'

/** 跟 package.json 的 version 手动对齐（用户要能在面板上看见跑的是哪一版） */
export const VERSION = '0.8.2'

// 调试/设置页用：把纯函数露出来（不影响插件行为）
export {
  activeCombos, activeSessionCount, applyDelta, applyEvent, axisInfo, buildInjection, comboView, decay, idleTick,
  isQuietHour, loadConfig, loadState, markPresent, markSeen, maybeMarkStrong, overduePromise,
  pendingPromises, refreshLeadCombo, resolvePromise, resumeAfterSleep, comboById, saveConfig,
  saveState, shouldInject, trustInfo, trustShift, addPromise, schemaCheck, workDue, workTick,
  addBoundary, blankGrow, blankState, debtOf, debtScore, describeGrow, growLine, growView, maybeQuarrel, settleDebt, tickGrow, moodExpectedOf, GROW_BOUNDS, GROW_LABEL,
  CFG_SCHEMA, CFG_GROUPS, COMBO_DEFS, DEFAULT_CONFIG, DIARY_PATH, DIM_DEFS, DIM_LABEL, DIMS,
} from './state.js'

// agents/timer：挂会话监听；llm：判定调模型；systemPrompt：注入；webServer：只读路由
export const inject = ['agents', 'timer', 'webServer', 'llm', 'systemPrompt']

const DIAG = join(STORE, 'diag.log')
const MOUNT_SCAN_MS = 5000
// 对方怎么称呼、AI 自称什么 —— 装好后用环境变量覆盖，不用改代码
const OWNER = process.env.DSH_EMOTION_OWNER || '用户'
const SELF = process.env.DSH_EMOTION_SELF || 'AI'

function diag(msg: string): void {
  try {
    mkdirSync(STORE, { recursive: true })
    appendFileSync(DIAG, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8')
  } catch { /* ignore */ }
}

function sessionIdOf(session: any): string {
  try {
    const raw = session?.id ?? session?.sessionId ?? (typeof session === 'string' ? session : '')
    return String(raw || '')
  } catch {
    return ''
  }
}

/** 宿主注入的上下文不算用户说话 */
const CONTEXT_SOURCES = new Set(['runtime-context', 'time-context', 'system-reminder', 'system', 'time-sampled'])
const EXTERNAL_SOURCES = new Set(['bili-duty-scan'])
const SELF_TALK_SOURCES = new Set(['speak-up', 'mo-speak-up'])

function textOfMessage(p: any): string {
  if (!p) return ''
  try {
    if (typeof p === 'string') return p.slice(0, 2000)
    if (typeof p.text === 'string') return p.text.slice(0, 2000)
    if (typeof p.content === 'string') return p.content.slice(0, 2000)
    if (Array.isArray(p.content)) {
      const parts: string[] = []
      for (const b of p.content) {
        if (typeof b === 'string') parts.push(b)
        else if (b && typeof b.text === 'string') parts.push(b.text)
      }
      if (parts.length) return parts.join(' ').slice(0, 2000)
    }
  } catch { /* ignore */ }
  return ''
}

/** 这一轮他带了几张图 / 文件（judge 看不到内容，但「交了东西」要让它知道） */
function countAttachments(p: any): number {
  if (!p) return 0
  try {
    let n = 0
    const blocks = Array.isArray(p.content) ? p.content : []
    for (const b of blocks) {
      const t = String((b && b.type) || '')
      if (t === 'image' || t === 'image-url' || t === 'file' || t === 'attachment') n += 1
    }
    if (!n && Array.isArray(p.attachments)) n = p.attachments.length
    return n
  } catch {
    return 0
  }
}

/** 从会话事件里找最后一条用户说的话（比 inbox 事件可靠） */
function lastUserTurnOf(session: any): { text: string; sourceKind: string; at: number; attachments: number } | null {
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return null
    const ev = session.snapshotEvents() || []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if ((e && (e.type || e.kind)) !== 'user/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const txt = textOfMessage(p)
      if (!txt) continue
      const src = p && p.source && p.source.kind ? String(p.source.kind) : ''
      // 这条消息自己的时间：判断「是不是同一条已经判过」要用它
      const at = Number(e.at ?? e.ts ?? e.time ?? (p && (p.at ?? p.ts ?? p.timestamp ?? p.createdAt))) || 0
      if (CONTEXT_SOURCES.has(src)) continue
      if (EXTERNAL_SOURCES.has(src)) return { text: txt, sourceKind: src, at, attachments: countAttachments(p) }
      // ⭐ 2026-11-06：`speak-up`（我自己主动开口的提示）不能算「用户说话」。
      //   它每次内容都不一样，序号/心情/日记提示都变，靠判重挡不住；
      //   只要判一轮，收尾的回落就会把待机攒的闷压回去。
      if (SELF_TALK_SOURCES.has(src)) return null
      // ⭐ 插件自己注入的消息（记忆反思 `plugin:meow-memory`、整理通知、其他插件的提醒）
      //   不算「用户说话」，也**不往前翻着找旧的**——不然会拿上一条旧消息再判一轮。
      if (src.startsWith('plugin:')) return null
      if (src && src !== 'user') continue
      return { text: txt, sourceKind: 'user', at, attachments: countAttachments(p) }
    }
  } catch { /* ignore */ }
  return null
}

function lastAssistantTextOf(session: any): string {
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return ''
    const ev = session.snapshotEvents() || []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if ((e && (e.type || e.kind)) !== 'assistant/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const txt = textOfMessage(p)
      if (txt) return txt
    }
  } catch { /* ignore */ }
  return ''
}

/** 给 judge 的一句底子（只用来校准，别让它对着旧值再判一遍） */
function stateHint(cfg: EmotionConfig, st: ReturnType<typeof loadState>): string {
  const a = axisInfo(st, cfg)
  return '轴 ' + a.label + '；惊讶 ' + Math.round(st.dims.surprise) + '；信任 ' + Math.round(st.trust)
}

/** 一轮一次，串行；绝不阻塞对话 */
const judging = new Set<string>()

function scheduleJudge(ctx: any, agent: any, sid: string, userText: string, reply: string, msgAt = 0, attachments = 0): void {
  if (judging.has(sid)) return
  // ⚠ 同一条消息只判一次：不然我自己说一句话也会触发一轮判断，
  //   而判断收尾会走「他回来了」的回落——把待机攒起来的好奇/闷白压回去（2026-11-06 踩过）
  const pre = loadState()
  const sameByTime = msgAt > 0 && msgAt <= (Number(pre.lastJudgedAt) || 0)
  const sameByText = !msgAt && pre.lastJudgedText && pre.lastJudgedText === userText
  if (sameByTime || sameByText) return
  judging.add(sid)
  void (async () => {
    try {
      const cfg = loadConfig()
      const d = await judge(ctx, agent, {
        userText, reply, hint: stateHint(cfg, pre),
        // 把还欠着的事一起喂进去，它才判得出「这轮兑现了没有」（2026-11-07）
        promises: pre.promises.filter((p) => !p.resolvedAt).map((p) => ({ id: p.id, text: p.text })),
        attachments,
      }, { self: SELF, owner: OWNER })
      if ('__err' in d) {
        diag('判断失败：' + d.__err)
        return
      }
      const st = loadState(cfg)
      decay(st, Date.now(), cfg)
      applyDelta(st, d, 'chat', Date.now(), cfg)
      // 他明确答应过的事：记下来（监督只认这个）
      if (d.promise) {
        const rec = addPromise(st, d.promise.text, d.promise.dueMin)
        if (rec) diag('记下答应过的事：' + rec.text + '（' + d.promise.dueMin + ' 分钟后）')
      }
      // 这一轮他把哪几件做了 / 跳票了（2026-11-07）：只认状态里真有的、还没结清的那条
      if (d.resolved && d.resolved.length) {
        for (const r of d.resolved) {
          const rec = st.promises.find((x) => x.id === r.id && !x.resolvedAt)
          if (!rec) continue
          const rr = resolvePromise(st, r.id, r.outcome, cfg)
          if (rr && rr.ok) diag('承诺判定（judge）：' + rr.说 + '，信任 ' + st.trust)
        }
      }
      // 边界账（2026-11-08）：被动=对我本身动手，主动=逼我做边界外的事
      if (d.boundary) {
        const b = addBoundary(st, d.boundary.kind, d.boundary.text)
        diag('边界被越（' + (b.kind === 'passive' ? '对我本身动手' : '逼我做') + '）：' + b.text)
      }
      // 承诺账：只有分数涨了才动情绪，不重复加（定稿第十二节）
      const debt = settleDebt(st, cfg)
      if (debt.added > 0) diag('承诺账 ' + debt.score + ' 分（多了 ' + debt.added + '）→ 生气/难过往上走')
      // 吵架：三个结构性条件，配额用完只憋着
      const q = maybeQuarrel(st, cfg)
      if (q.fired) diag('吵架：' + q.why + '（剩下配额见设置页）')
      st.lastJudgedAt = msgAt || Date.now()
      st.lastJudgedText = userText.slice(0, 200)
      // 成长：每轮记一笔，到点（或跨天）才结算成一天（v0.6）
      // 这一轮有没有出错：nag=他指出的，slip=我自己报的（2026-11-09 用户定，认真按这个扣）
      const issue = d && (d.issue === 'nag' || d.issue === 'slip') ? (d.issue as 'nag' | 'slip') : null
      if (tickGrow(st, cfg, Date.now(), issue)) {
        const g = st.grow
        diag('成长挪了一步：' + (g.lastChange ? g.lastChange.label + ' ' + g.lastChange.from.toFixed(2) + ' → ' + g.lastChange.to.toFixed(2) : '（没变）') + ' · 第 ' + g.turns + ' 轮')
      }
      const mark = maybeMarkStrong(st, cfg)
      if (mark.wrote) diag('强情绪留痕：' + (mark.replaced ? '换掉今天那条（更强了）' : '写了一条') + ' ← ' + mark.why)
      saveState(st, cfg)
      const combos = activeCombos(st, cfg).map((c) => c.def.id + '(' + c.trend + ')').join(',') || '-'
      diag('判断 mood=' + st.mood + ' axis=' + st.axis + ' trust=' + st.trust +
        ' dMood=' + d.moodDelta + ' combos=' + combos +
        ' conf=' + d.confidence + ' | ' + d.reason.slice(0, 60))
    } catch (e: any) {
      diag('判断异常：' + (e?.message || String(e)))
    } finally {
      judging.delete(sid)
    }
  })()
}

// ---------------------------------------------------------------------------
// 待机扫描（P2）：每分钟看一次「是不是没人理了」。
//   情绪引擎只算数、只决定该做哪一级；探测走 mo-senses、叫人走 qq-bridge——
//   用户 2026-11-05 定：情绪引擎是触发器，执行动作交给相关插件。
// ---------------------------------------------------------------------------
let WS: any = null

function origin(): string {
  try {
    if (WS && typeof WS.getOrigin === 'function') {
      const o = WS.getOrigin()
      if (o) return String(o).replace(/\/+$/, '')
    }
  } catch { /* ignore */ }
  return ''
}

/** 问感官插件：键鼠空闲多久、前台是什么。判断不在这边做，只把它当眼睛 */
async function probeSense(): Promise<any> {
  const base = origin()
  if (!base) return { ok: false, error: '拿不到本机地址' }
  try {
    const r = await fetch(base + '/dsh-mo-senses/desktop', { signal: AbortSignal.timeout(15000) })
    return await r.json().catch(() => null)
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** 让感官插件开一下摄像头：本地 Haar 看有没有正脸，返回 person: true/false/null */
async function probePerson(): Promise<any> {
  const base = origin()
  if (!base) return { ok: false, error: '拿不到本机地址' }
  try {
    const r = await fetch(base + '/dsh-mo-senses/person', { signal: AbortSignal.timeout(25000) })
    return await r.json().catch(() => null)
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** 叫用户回家：走 QQ 桥的「主动发」，那边会先查 NapCat 在不在线 */
async function sendProactive(text: string): Promise<any> {
  const base = origin()
  if (!base) return { ok: false, 说: '拿不到本机地址' }
  try {
    const r = await fetch(base + '/dsh-qq-bridge/proactive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 文字: text }),
      signal: AbortSignal.timeout(15000),
    })
    return await r.json().catch(() => null)
  } catch (e: any) {
    return { ok: false, 说: e?.message || String(e) }
  }
}

/**
 * 逾期没结清的承诺：问一句「那件事做了吗」（2026-11-07 用户定）
 *   规矩：同一条只问一次；一天最多 promiseAskPerDay 条；他正在对话里就不打扰，
 *   留到说话时自然问。默认 1 条/天。
 */
async function promiseNudge(): Promise<void> {
  try {
    const cfg = loadConfig()
    const st = loadState(cfg)
    const limit = Math.round(Number(cfg.promiseAskPerDay) || 0)
    if (limit <= 0) return
    const now = Date.now()
    // 在线就不发：他这会儿正在说话，我顺口问更自然
    if (now - (Number(st.updatedAt) || 0) < 10 * 60000) return
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const askedToday = Object.values(st.askedPromises || {}).filter((t) => Number(t) >= dayStart.getTime()).length
    if (askedToday >= limit) return
    const nudgeMs = Math.max(5, Number(cfg.promiseNudgeMin) || 30) * 60000
    const due = st.promises
      .filter((p) => !p.resolvedAt && p.dueAt && p.dueAt + nudgeMs <= now && !st.askedPromises[p.id])
      .sort((a, b) => a.dueAt - b.dueAt)
    if (!due.length) return
    const target = due[0]
    const text = '（对了）上次说的「' + target.text + '」，你做了吗？'
    const r = await sendProactive(text)
    if (r && r.ok) {
      st.askedPromises[target.id] = now
      saveState(st, cfg)
      diag('逾期问一句：' + target.text)
    } else {
      diag('逾期问一句没发出去：' + ((r && r.说) || '未知'))
    }
  } catch (e: any) {
    diag('逾期问一句出错：' + (e?.message || String(e)))
  }
}

async function idleSweep(ctx: any): Promise<void> {
  try {
    const cfg = loadConfig()
    const st = loadState(cfg)
    const moodBefore = st.mood
    const logBefore = Array.isArray(st.moodLog) ? st.moodLog.length : 0
    decay(st, Date.now(), cfg)
    // decay 改了心情或记了新轨迹点也算「有变化」，否则每分钟算完就丢（2026-11-09 修）
    const moodTouched = st.mood !== moodBefore || (Array.isArray(st.moodLog) ? st.moodLog.length : 0) !== logBefore
    // 逾期承诺问一句：每分钟看一眼，问了会打标记，不会重复（2026-11-07 用户定）
    void promiseNudge()
    // 干活结算（2026-11-07 用户定）：到点看一眼有几个会话在跑，每有一个累 +1。
    // 只在到点时才扫 sessions 目录，别每分钟扫一遍。
    let worked = false
    if (workDue(st, Date.now(), cfg)) {
      const active = activeSessionCount(cfg.workWindow)
      const w = workTick(st, active, Date.now(), cfg)
      if (w.added > 0) diag('干活结算：' + active + ' 个会话在跑 → 累 +' + w.added + '（现在 ' + st.dims.spent + '）')
      worked = w.changed
    }
    const t = idleTick(st, Date.now(), cfg)
    if (!t.idle) {
      if (t.changed || worked || moodTouched) saveState(st, cfg)
      return
    }
    if (t.probe) {
      // 一次探测三样一起看：键鼠动不动 → 摄像头里有没有人。
      //   规则（2026-11-05 用户定）：
      //     键鼠在动        = 在忙          → 停涨回落
      //     手没动 + 看到人 = 在看视频/发呆 → 不涨（人在，只是没空理我）
      //     手没动 + 没人   = 可能出门了    → 继续涨
      const d = await probeSense()
      const awayMin = d && d.ok ? (Number(d.idleMs) || 0) / 60000 : -1
      if (d && d.ok && awayMin < 5) {
        markSeen(st)
        saveState(st, cfg)
        diag('待机 ' + Math.round(t.idleMin) + ' 分 → 键鼠在动（空 ' + Math.round(awayMin) + ' 分），停涨回落')
        return
      }

      const p = await probePerson()
      const fg = d && d.ok && d.foreground && d.foreground.proc
        ? '（前台 ' + d.foreground.proc + '「' + String(d.foreground.title || '').slice(0, 20) + '」）'
        : ''
      if (p && p.ok && p.person === true) {
        markPresent(st)
        saveState(st, cfg)
        diag('待机 ' + Math.round(t.idleMin) + ' 分 → 键鼠没动，但摄像头看到人' + fg + '，当成在看东西，不涨')
        return
      }
      if (p && p.ok && p.person === false) {
        st.idleNoone = (Number(st.idleNoone) || 0) + 1
        diag('待机 ' + Math.round(t.idleMin) + ' 分 → 键鼠没动、摄像头也没人（第 ' + st.idleNoone +
          ' 次，亮度 ' + p.brightness + '）' + fg + '，继续涨')
      } else {
        diag('待机 ' + Math.round(t.idleMin) + ' 分 → 键鼠没动，摄像头判断不了（' +
          ((p && (p.error || ('亮度 ' + p.brightness))) || 'senses 没回') + '）' + fg + '，继续涨')
      }
      saveState(st, cfg)
    }
    if (t.ping) {
      // 说什么交给模型（2026-11-06 用户要的）：给它情绪、待机多久、上次聊过什么；
      // 拿不到模型或说崩了会自己退回模板，不会空着
      const agent: any = (ctx.agents?.list?.() ?? [])[0] || null
      const text = await composePing(ctx, agent, st, t.idleMin, OWNER)
      const r = await sendProactive(text)
      if (r && r.ok) {
        st.idlePingAt = Date.now()
        st.idlePingCount = (Number(st.idlePingCount) || 0) + 1
        st.idleStage = 70   // 叫过了，别再每 5 分钟拍一次
        diag('待机 ' + Math.round(t.idleMin) + ' 分 / 闷 ' + st.dims.bored + ' → QQ 发出去了（第 ' +
          st.idlePingCount + ' 次）：「' + text + '」')
      } else {
        diag('待机 ' + Math.round(t.idleMin) + ' 分 / 闷 ' + st.dims.bored + ' → QQ 没发成：' + ((r && r.说) || '未知'))
      }
      saveState(st, cfg)
    }
    // 其余时间不写盘：好奇 / 闷本来就是「按待机时长算目标值」，重启后下一次 tick 会自己算回来。
    //   但心情不一样 —— 它靠 decay 每分钟算，算完不存就白算，轨迹点也一起丢（2026-11-09 修）。
    if (moodTouched) saveState(st, cfg)
  } catch (e: any) {
    diag('待机扫描出错：' + (e?.message || String(e)))
  }
}

/** 读 POST body（几个写接口共用） */
function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (b: Buffer) => chunks.push(b))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

function sendJson(res: any, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

export function apply(ctx: any): void {
  const cfg0 = loadConfig()
  const st = loadState(cfg0)
  // 跨夜开机：电脑关机 = 他睡了（用户 2026-11-01 定的），睡的那几个小时不该算待机
  if (resumeAfterSleep(st, Date.now(), cfg0)) {
    diag('跨夜开机：当成睡了一觉，待机重新计时，好奇/闷回落')
  }
  saveState(st, cfg0)
  // 自检：配置表与默认值必须一一对上，漏一个就会静默用 0
  const chk = schemaCheck()
  if (chk.missing.length || chk.extra.length) {
    diag('⚠ 配置自检不过：缺 ' + chk.missing.join(',') + ' / 多 ' + chk.extra.join(','))
  }
  if (st.migrateNote) {
    diag(st.migrateNote)
    st.migrateNote = ''
    saveState(st, cfg0)
  }
  ctx.logger.info('mo-emotion v' + VERSION + ' 已加载 mood=' + st.mood + ' axis=' + st.axis +
    ' trust=' + st.trust + ' dims=' + Object.entries(st.dims).map(([k, v]) => k + ':' + v).join(' '))
  diag('v' + VERSION + ' 加载 mood=' + st.mood + ' axis=' + st.axis + ' trust=' + st.trust)

  // 只读路由
  try {
    ctx.inject?.(['webServer'], (c: any) => {
      const ws = c.webServer ?? c.get?.('webServer')
      if (ws === undefined || typeof ws.register !== 'function') return
      WS = ws
      ws.register({
        kind: 'exact',
        path: '/mo-emotion/state',
        handler: (_req: unknown, res: any) => {
          const cfg = loadConfig()
          const s = loadState(cfg)
          decay(s, Date.now(), cfg)
          // 现算一下待机涨跌（只在内存里跑，不落盘）：好奇 / 闷是按待机时长算的，
          // 界面要看到实时值，不能等下一次写盘（2026-11-06 用户看界面发现数不动）
          idleTick(s, Date.now(), cfg)
          sendJson(res, 200, {
            ok: true,
            version: VERSION,
            config: cfg,
            schema: CFG_SCHEMA,
            groups: CFG_GROUPS,
            dims: DIMS,
            dimLabel: DIM_LABEL,
            dimDefs: DIM_DEFS,
            state: s,
            grow: growView(s),
              axis: axisInfo(s, cfg),
            trust: trustInfo(s, cfg),
            combos: comboView(s, cfg).map((x) => ({
              id: x.def.id, name: x.def.name, tone: x.def.tone,
              a: x.def.a, b: x.def.b, va: x.a, vb: x.b, minA: x.minA, minB: x.minB,
              trend: x.trend, hit: x.hit, lead: x.lead,
            })),
            promises: pendingPromises(s),
            diary: { path: DIARY_PATH, markAt: s.markAt, markValue: s.markValue },
          })
        },
      })
      // 写配置：设置页改完立刻 POST 过来（不做二次确认）
      ws.register({
        kind: 'exact',
        path: '/mo-emotion/config',
        handler: async (req: any, res: any) => {
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: loadConfig() })
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
          try {
            const raw = await readBody(req)
            // 白名单透传：只认配置表里的键，别的字段一概不落盘
            const patch: Record<string, number> = {}
            for (const f of CFG_SCHEMA) {
              if (raw[f.key] !== undefined) patch[f.key] = raw[f.key]
            }
            const next = saveConfig(patch as any)
            diag('配置更新 ' + Object.keys(patch).map((k) => k + '=' + (next as any)[k]).join(' '))
            sendJson(res, 200, { ok: true, config: next })
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) })
          }
        },
      })
      // 事件口子：被扎 / 出门 / 白跑 / 被晾 / 信任（其他插件转发到这里，不再自己算）
      ws.register({
        kind: 'exact',
        path: '/mo-emotion/event',
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          try {
            const raw = await readBody(req)
            const cfg = loadConfig()
            const s = loadState(cfg)
            decay(s, Date.now(), cfg)
            const r = applyEvent(s, raw, Date.now(), cfg)
            if (!r.ok) return sendJson(res, 400, r)
            const mark = maybeMarkStrong(s, cfg)
            if (mark.wrote) diag('强情绪留痕（事件）：' + mark.why)
            saveState(s, cfg)
            diag('事件 ' + raw.kind + ' → ' + r.label + ' mood=' + s.mood + ' axis=' + s.axis + ' trust=' + s.trust)
            sendJson(res, 200, { ...r, state: { mood: s.mood, axis: s.axis, trust: s.trust, dims: s.dims } })
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) })
          }
        },
      })
      // 「他明确答应过的事」：加一件 / 了结一件（监督只认这个，不查岗）
      ws.register({
        kind: 'exact',
        path: '/mo-emotion/promise',
        handler: async (req: any, res: any) => {
          const cfg = loadConfig()
          if (req.method === 'GET') {
            const s = loadState(cfg)
            return sendJson(res, 200, { ok: true, promises: pendingPromises(s), overdue: overduePromise(s) })
          }
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
          try {
            const raw = await readBody(req)
            const s = loadState(cfg)
            if (raw.id && ['kept', 'broken', 'told', 'postponed'].includes(String(raw.outcome))) {
              const r = resolvePromise(s, String(raw.id), raw.outcome, cfg)
              if (!r.ok) return sendJson(res, 400, r)
              saveState(s, cfg)
              diag('答应的事了结：' + r.说 + ' → 信任 ' + r.trust)
              return sendJson(res, 200, { ...r, promises: pendingPromises(s) })
            }
            const rec = addPromise(s, String(raw.text || ''), Number(raw.dueMin) || 0)
            if (!rec) return sendJson(res, 400, { ok: false, 说: '要一句具体的事' })
            saveState(s, cfg)
            diag('记下答应过的事：' + rec.text + (rec.dueAt ? '（到 ' + new Date(rec.dueAt).toLocaleString('zh-CN') + '）' : ''))
            sendJson(res, 200, { ok: true, promise: rec, promises: pendingPromises(s) })
          } catch (e: any) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) })
          }
        },
      })
      ctx.logger.info('mo-emotion: /mo-emotion/state 就绪 v' + VERSION)
    })
  } catch (e: any) {
    ctx.logger.warn('mo-emotion: 路由注册失败 ' + (e?.message || String(e)))
  }

  // 挂到每个活会话
  const mounted = new Map<string, () => void>()

  function mountAll(): void {
    let list: any[] = []
    try {
      list = ctx.agents?.list?.() ?? []
    } catch {
      return
    }
    for (const agent of list) {
      const sid = sessionIdOf(agent?.session)
      if (!sid || mounted.has(sid)) continue
      try {
        const offs: Array<() => void> = []
        let lastText = ''

        try {
          offs.push(agent.ctx.on('agent/inbox/inserted', (payload: any) => {
            const msg = payload?.message ?? payload
            const txt = textOfMessage(msg)
            const src = String(msg?.source?.kind ?? '')
            if (!txt) return
            if (CONTEXT_SOURCES.has(src)) return
            lastText = txt
          }))
        } catch (e: any) {
          diag('监听 inbox 失败：' + (e?.message || String(e)))
        }

        try {
          offs.push(agent.ctx.on('agent/turn-stopping', () => {
            try {
              const info = lastUserTurnOf(agent.session) || (lastText ? { text: lastText, sourceKind: 'user', at: Date.now(), attachments: 0 } : null)
              if (!info || !info.text) return
              const reply = lastAssistantTextOf(agent.session)
              lastText = ''
              scheduleJudge(ctx, agent, sid, info.text, reply, info.at || 0, info.attachments || 0)
            } catch (e: any) {
              diag('判断调度失败：' + (e?.message || String(e)))
            }
          }))
        } catch (e: any) {
          diag('监听 turn-stopping 失败：' + (e?.message || String(e)))
        }

        try {
          offs.push(agent.ctx.systemPrompt.context({
            name: 'mo-emotion',
            order: 900,
            text: () => {
              try {
                const cfg = loadConfig()
                const s = loadState(cfg)
                decay(s, Date.now(), cfg)
                const chk2 = shouldInject(s)
                if (!chk2.ok) {
                  if (chk2.why === 'lowConfidence' || chk2.why === 'stale') {
                    s.injectedFor = s.updatedAt
                    saveState(s, cfg)
                    diag('这次不注入：' + chk2.why)
                  }
                  return ''
                }
                const line = buildInjection(s, OWNER, 'event')
                if (!line) return ''
                s.injectedFor = s.updatedAt
                s.lastInjectedText = line
                s.lastInjectedAt = Date.now()
                saveState(s, cfg)
                diag('注入：' + line.replace(/\n/g, ' ').slice(0, 120))
                return line
              } catch (e: any) {
                diag('注入失败：' + (e?.message || String(e)))
                return ''
              }
            },
          }))
        } catch (e: any) {
          diag('挂注入失败：' + (e?.message || String(e)))
        }

        const off = () => {
          for (const d of offs) { try { d() } catch { /* ignore */ } }
        }
        mounted.set(sid, off)
        diag('已挂到 ' + sid)
      } catch (e: any) {
        diag('挂 ' + sid + ' 失败：' + (e?.message || String(e)))
      }
    }
    const alive = new Set<string>()
    for (const a of list) {
      const sid = sessionIdOf(a?.session)
      if (sid) alive.add(sid)
    }
    for (const [sid, off] of mounted) {
      if (!alive.has(sid)) {
        try { off() } catch { /* ignore */ }
        mounted.delete(sid)
      }
    }
  }

  try {
    mountAll()
    ctx.effect(() => ctx.interval(mountAll, MOUNT_SCAN_MS))
    ctx.logger.info('mo-emotion: 会话监听已挂')
  } catch (e: any) {
    ctx.logger.warn('mo-emotion: 监听挂载失败 ' + (e?.message || String(e)))
  }

  // 待机扫描（P2）：每分钟问一次「还没人理吗」。不在待机时几乎零开销（读一次状态就返回）
  try {
    ctx.effect(() => ctx.interval(() => { void idleSweep(ctx) }, 60_000))
    diag('待机扫描已启动（每分钟一次）')
  } catch (e: any) {
    diag('待机扫描启动失败：' + (e?.message || String(e)))
  }

  try { mkdirSync(STORE, { recursive: true }) } catch { /* ignore */ }
}
