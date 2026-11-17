/**
 * 构建后自检（build.mjs 会自动跑）
 *
 * 为什么要有它：esbuild 只打包、不做类型检查。
 * 2026-11-06 我清理 import 时漏掉了 DIMS，构建照样「成功」，
 * 但 /mo-emotion/state 一请求就 ReferenceError，被宿主转成空的 400 ——
 * 面板因此读不到数据。这个脚本就是把 lib/index.js 当宿主那样挂一遍，
 * 每个路由真跑一次，外加几条关键纯函数，任何一条挂掉都让构建返回失败。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(process.env.TEMP || '.', 'emo-check-'))

const m = await import('./lib/index.js')

const fails = []
function ok(name, cond, extra = '') {
  if (cond) { console.log('  ✓ ' + name); return }
  fails.push(name + (extra ? ' — ' + extra : ''))
  console.log('  ✗ ' + name + (extra ? ' — ' + extra : ''))
}

console.log('\n[自检] 纯函数')
const cfg = m.loadConfig()
ok('配置项齐全（' + Object.keys(cfg).length + ' 项）', Object.keys(cfg).length > 40)
const chk = m.schemaCheck()
// extra = DEFAULT_CONFIG 里有、但面板不暴露的内部项（爱门槛 / 账本系数 / 干活统计）——
//   2026-11-17 用户定：这些不给用户调，代码照用，所以 extra 合法；missing 才是真错。
ok('schema 与默认值对齐（missing 必须为空）', chk.missing.length === 0, JSON.stringify(chk))
// 白名单式构建的坑（2026-11-17）：schema 撤掉内部项后，buildConfig 只按 schema 铺键，
//   cfg.loveTrust 之类会静默变 undefined（爱永远不成立、衰减算 NaN）。这里写一份盘上的配置再读回来验。
mkdirSync(join(process.env.DSH_HOME, 'emotion'), { recursive: true })
writeFileSync(join(process.env.DSH_HOME, 'emotion', 'config.json'), JSON.stringify({ trustRise: 9 }), 'utf8')
const cfgDisk = m.loadConfig()
ok('读盘后配置键数不缩水', Object.keys(cfgDisk).length === Object.keys(m.DEFAULT_CONFIG).length,
  Object.keys(cfgDisk).length + ' vs ' + Object.keys(m.DEFAULT_CONFIG).length)
ok('内部项读回来仍有值', Number.isFinite(cfgDisk.loveTrust) && Number.isFinite(cfgDisk.half_spent) && Number.isFinite(cfgDisk.workEvery))
ok('10 根维度（含压力）', m.DIMS.length === 10)
ok('10 条组合', m.COMBO_DEFS.length === 10)
const st = m.loadState(cfg)
m.decay(st, Date.now(), cfg)
m.idleTick(st, Date.now(), cfg)
// 小数账（2026-11-10 用户选 A）：每轮衰减不到 1 点也不能被取整扔掉
const stD = m.blankState(cfg)
stD.dims.sad = 71
let td = Date.now()
stD.decayedAt = td
for (let i = 0; i < 30; i++) { td += 2 * 60000; m.decay(stD, td, cfg) }
ok('连跑 30 轮 × 2 分钟，难过必须真的往下走', stD.dims.sad < 70, '实际 ' + stD.dims.sad + '（老逻辑会冻在 71）')
ok('衰减后各根仍是整数', Object.values(stD.dims).every((v) => Number.isInteger(v)))
ok('衰减零头都留在 -1..1 之间', Object.values(stD.dimCarry).every((v) => Math.abs(v) < 1))
// 会话内主动开口（2026-11-10 用户定「我安静你才开口」）：三种情况都要有明确结果，不能静默吞掉
ok('sayInSession：没有活会话时返回没成、不抛错', (await m.sayInSession(null, 'x')).ok === false)
ok('sayInSession：有活会话时走 followup', (await m.sayInSession({ followup: async () => {} }, 'x')).ok === true)
ok('sayInSession：followup 抛错被接住（不能变成未处理 rejection 杀掉宿主）', (await m.sayInSession({ followup: async () => { throw new Error('busy') } }, 'x')).ok === false)
// 主动开口的话会以 user 消息回到下一轮（DSH 只能送 user）：必须在注入里认得出是我说的
const stPing = m.blankState(cfg)
stPing.lastReason = '他在忙'
stPing.lastPingText = '你忙啥呢这么久没动静'
stPing.idlePingAt = Date.now()
ok('刚主动开过口：注入要提醒那是我自己说的', m.buildInjection(stPing).includes('我自己主动开口'))
stPing.idlePingAt = Date.now() - 20 * 60000
ok('二十分钟前的开口不再念叨', !m.buildInjection(stPing).includes('我自己主动开口'))
stPing.lastPingText = ''
ok('没开过口时不该出现这句提醒', !m.buildInjection(stPing).includes('我自己主动开口'))
ok('注入文本能生成', typeof m.buildInjection(st, '用户') === 'string')
ok('judge 解析可用', !!m.parseDelta('{"moodDelta":1,"dims":{"happy":2},"reason":"x","confidence":70}'))
// 出门回来：闷只降一点、不归零（2026-11-07 用户定的 10 点）
const stLeg = m.loadState(cfg)
stLeg.dims.bored = 85
m.applyEvent(stLeg, { kind: 'leg', legKind: 'fun', reason: '自检' }, Date.now(), cfg)
ok('出门回来闷 85 → 75', stLeg.dims.bored === 75, '实际 ' + stLeg.dims.bored)
const stLeg2 = m.loadState(cfg)
stLeg2.dims.bored = 40
m.applyEvent(stLeg2, { kind: 'leg', legKind: 'work', reason: '自检' }, Date.now(), { ...cfg, legBoredDrop: 50 })
ok('闷 40 降 50 → 落 0 不越界', stLeg2.dims.bored === 0, '实际 ' + stLeg2.dims.bored)

// 干活结算：按「几个会话在跑」加累（2026-11-07 用户定，不再靠模型估）
const stW = m.loadState(cfg)
stW.dims.spent = 0
stW.lastWorkAt = 0
const w1 = m.workTick(stW, 3, Date.now(), cfg)
ok('干活结算：3 个会话在跑 → 累 +3', w1.added === 3 && stW.dims.spent === 3, 'added=' + w1.added + ' spent=' + stW.dims.spent)
const w2 = m.workTick(stW, 3, Date.now(), cfg)
ok('没到结算点不重复加', w2.added === 0 && stW.dims.spent === 3, 'added=' + w2.added)
const stW2 = m.loadState(cfg)
stW2.dims.spent = 0
stW2.lastWorkAt = 0
const w3 = m.workTick(stW2, 99, Date.now(), cfg)
ok('一次最多算 workCap 个会话（' + cfg.workCap + '）', w3.added === cfg.workCap, 'added=' + w3.added)
ok('临时目录里没有会话 → 数到 0', m.activeSessionCount(5) === 0, '实际 ' + m.activeSessionCount(5))

// 承诺：judge 判兑现 / 逾期在注入里问一句（2026-11-07 用户定）
const dRes = m.parseDelta('{"moodDelta":0,"dims":{},"reason":"x","confidence":70,"resolved":[{"id":"p1","outcome":"kept"},{"id":"p2","outcome":"broken"}]}')
ok('parseDelta 能解析 resolved', Array.isArray(dRes.resolved) && dRes.resolved.length === 2 && dRes.resolved[1].outcome === 'broken', JSON.stringify(dRes.resolved))
const stP = m.loadState(cfg)
ok('askedPromises 默认是空的', !!stP.askedPromises && Object.keys(stP.askedPromises).length === 0)
const stI = m.loadState(cfg)
stI.lastReason = '自检'
stI.promises = [{ id: 'px1', text: '修的时候拍给我看', dueAt: Date.now() - 3600000, resolvedAt: 0 }]
const inj = m.buildInjection(stI, '用户')
ok('逾期承诺会出现在注入里', inj.includes('修的时候拍给我看'), inj.slice(-100))
stI.askedPromises.px1 = Date.now()
ok('问过的那条不再重复提', !m.buildInjection(stI, '用户').includes('修的时候拍给我看'))

// ---------------------------------------------------------------------------
// 像宿主一样挂一遍，逐个打路由
// ---------------------------------------------------------------------------
console.log('\n[自检] 路由')
const routes = new Map()
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  inject(_deps, cb) {
    cb({
      webServer: {
        register(route) { routes.set(route.path, route); return () => {} },
        getOrigin() { return 'http://127.0.0.1:1' },
      },
      get() { return undefined },
    })
  },
  effect(fn) { try { fn() } catch { /* ignore */ } },
  interval() { return () => {} },
  agents: { list: () => [] },
  llm: {},
}
try {
  m.apply(ctx)
  ok('apply 不抛错', true)
} catch (e) {
  ok('apply 不抛错', false, e && e.message)
}

function makeRes() {
  return {
    headersSent: false, code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; this.headersSent = true; return this },
    end(b) { this.body = b || ''; return this },
  }
}
/** 带 body 的假 req（模拟 node:http 的 data/end 事件） */
function makeReq(method, bodyObj) {
  const listeners = new Map()
  const req = {
    method, url: '/', headers: {},
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, [])
      listeners.get(ev).push(fn)
      return req
    },
    removeListener() { return req },
  }
  setTimeout(() => {
    if (bodyObj !== undefined) {
      const b = Buffer.from(JSON.stringify(bodyObj), 'utf8')
      for (const fn of listeners.get('data') || []) fn(b)
    }
    for (const fn of listeners.get('end') || []) fn()
  }, 0)
  return req
}

async function call(path, method = 'GET', body) {
  const r = routes.get(path)
  if (!r) return { code: 0, body: '', missing: true }
  const res = makeRes()
  try {
    await r.handler(makeReq(method, body), res)
  } catch (e) {
    return { code: -1, body: '', err: (e && e.message) || String(e) }
  }
  return { code: res.code, body: String(res.body || '') }
}

ok('路由都注册了（4 条）', routes.size === 4, [...routes.keys()].join(','))
ok('没有「手动设某一根」的接口（心情只能被推、不能被设）', !routes.has('/mo-emotion/dim'))

ok('没有重置接口（数值不能由外面设）', !routes.has('/mo-emotion/reset'))

const s = await call('/mo-emotion/state')
ok('/state 200', s.code === 200, s.err || String(s.code))
if (s.code === 200) {
  try {
    const j = JSON.parse(s.body)
    ok('/state 带 schema（' + (j.schema ? j.schema.length : 0) + ' 项）', Array.isArray(j.schema) && j.schema.length > 40)
    ok('/state 带 dims/dimLabel', Array.isArray(j.dims) && j.dims.length === 10 && !!j.dimLabel)
ok('/state 里压力是 0 起的', typeof j.state.dims.stress === 'number', 'stress=' + j.state.dims.stress)
    ok('/state 带 axis/trust', !!j.axis && !!j.trust)
    ok('/state 带 10 条组合', Array.isArray(j.combos) && j.combos.some((x) => x && x.name))
    ok('/state 带 state.config', !!j.config && !!j.state)
  } catch (e) {
    ok('/state 是 JSON', false, String(e))
  }
}

const c1 = await call('/mo-emotion/config')
ok('/config GET 200', c1.code === 200, c1.err)
const c2 = await call('/mo-emotion/config', 'POST', { markStrong: 90 })
ok('/config POST 200', c2.code === 200, c2.err)
ok('config POST 真的落盘了', m.loadConfig().markStrong === 90)

const e1 = await call('/mo-emotion/event', 'POST', { kind: 'repeat', reason: '自检' })
ok('/event POST 200', e1.code === 200, e1.err || e1.body.slice(0, 80))

const p1 = await call('/mo-emotion/promise')
ok('/promise GET 200', p1.code === 200, p1.err)

// ---------------------------------------------------------------------------
console.log('')
if (fails.length) {
  console.error('自检失败 ' + fails.length + ' 项：\n - ' + fails.join('\n - '))
  process.exitCode = 1
} else if (process.exitCode) {
  // ★2026-11-09：build.mjs 里 client.js 语法检查挂掉时也设了 exitCode，
  //   这里以前照打「自检全过」，把人骗过去了（client.js 真的坏过一次）。
  //   本项全过 ≠ 整轮全过，必须分开说。
  console.log('本项全过，但同一轮构建里还有别的失败（往上看 [自检] 那几行）')
} else {
  console.log('自检全过')
}
