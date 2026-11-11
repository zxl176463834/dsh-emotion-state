/**
 * dsh-emotion 设置面板冒烟测试（不开浏览器）
 * 用最小 React 替身把 EmotionPanel 真跑一遍：抓渲染时的运行时报错、确认成长卡片出来了。
 * 跑法：node panel-check.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const pkgVersion = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
const src = readFileSync(join(here, 'client.js'), 'utf8')
const clientVersion = /const VERSION = '([^']+)'/.exec(src)[1]

process.env.DSH_HOME = mkdtempSync(join(process.env.TEMP || '.', 'moe-panel-'))
const srv = await import(new URL('./lib/index.js', import.meta.url).href)

console.log('dsh-emotion 面板冒烟测试\n')

let hookQueue = []
let hookIdx = 0
const rendered = []

const React = {
  createElement: (type, props, ...children) => {
    const kids = []
    const push = (c) => {
      if (c === null || c === undefined || c === false || c === true) return
      if (Array.isArray(c)) { c.forEach(push); return }
      if (typeof c === 'string' || typeof c === 'number') { kids.push(c); rendered.push(String(c)); return }
      kids.push(c)
    }
    children.forEach(push)
    if (props && Array.isArray(props.children)) props.children.forEach(push)
    if (typeof type === 'function') {
      const out = type(props || {})
      if (out === null || out === undefined) return null
      return { type, props: props || {}, children: [out] }
    }
    return { type, props: props || {}, children: kids }
  },
  useState: (init) => {
    const v = hookIdx < hookQueue.length ? hookQueue[hookIdx] : (typeof init === 'function' ? init() : init)
    hookIdx += 1
    return [v, () => {}]
  },
  useEffect: () => {},
  Fragment: 'fragment',
}

const fakeEl = { setAttribute() {}, remove() {}, set textContent(v) {}, get textContent() { return '' } }
globalThis.document = { createElement: () => fakeEl, head: { appendChild() {} } }

let component = null
globalThis.window = { __ModuleLoader__: { load: (m) => { component = m } } }

const cfg = srv.loadConfig()
const st = srv.blankState(cfg)
st.grow.turns = 132
st.grow.today = { day: '2026-11-09', n: 4, sum: 2.1 }
st.grow.clingy = 0.76
st.grow.lastChange = { at: 132, key: 'clingy', label: '黏人', from: 0.73, to: 0.76 }

const fixture = {
  ok: true, version: '0.6.0', config: cfg, schema: srv.CFG_SCHEMA, groups: srv.CFG_GROUPS,
  dims: srv.DIMS, dimLabel: srv.DIM_LABEL, dimDefs: {},
  state: st, grow: srv.growView(st),
  axis: srv.axisInfo(st, cfg), trust: srv.trustInfo(st, cfg),
  combos: [], promises: [], diary: { path: '', markAt: 0, markValue: 0 },

}
globalThis.fetch = async () => ({ ok: true, json: async () => fixture })

await import(new URL('./client.js', import.meta.url).href)

let fails = 0
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond || !extra ? '' : ' — ' + extra))
  if (!cond) fails += 1
}

ok('client.js 能加载（有 factory）', !!(component && typeof component.factory === 'function'))
const mod = component.factory((id) => (id === 'react' ? React : {}))
ok('factory 导出 apply', typeof mod.apply === 'function')

let Panel = null
const ctx = {
  get: (k) => (k === 'slots' ? { register: (_slot, comp) => { Panel = comp; return () => {} } } : undefined),
  effect: (fn) => { try { fn() } catch (e) { /* ignore */ } },
}
mod.apply(ctx)
ok('注册到了设置页 section', typeof Panel === 'function')

// hook 顺序：data / err / cfg / newPromise / newDue
hookIdx = 0; hookQueue = [null, '', null, '', '60']; rendered.length = 0
Panel()
ok('空数据时显示「正在读…」', rendered.join(' ').includes('正在读'), rendered.join(' | ').slice(0, 80))

hookIdx = 0; hookQueue = [fixture, '', fixture.config, '', '60']; rendered.length = 0
try {
  Panel()
  ok('完整渲染不报错', true)
} catch (e) {
  ok('完整渲染不报错', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e))
}
let text = rendered.join(' | ')
ok('客户端版本号跟 package.json 一致（' + clientVersion + '）', clientVersion === pkgVersion, 'client=' + clientVersion + ' pkg=' + pkgVersion)
ok('顶部版本号可见', text.includes('v' + clientVersion))
ok('亲密度轴在', text.includes('亲密度'))
ok('成长条是淡蓝单色（不是渐变）', src.includes(".moe-grow-fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:#8ec5e8"))
ok('成长卡片标题在', text.includes('成长'))
ok('四个慢变量名都在', ['黏人', '话量', '玩笑', '认真'].every((n) => text.includes(n)), text.slice(0, 300))
ok('轮数显示', text.includes('132'))
ok('当天笔数显示（今天记了 4 笔）', text.includes('今天记了 4 笔'), text.slice(0, 220))
ok('上次调整那一行在（整数）', text.includes('上次调整') && text.includes('73') && text.includes('76'))
ok('值是整数、不带小数点', text.includes('76') && !text.includes('0.76') && !text.includes('0.55'))
// 2026-11-09 五样补齐：拖动条 / 走势图 / 边界账 / 重置 / 理由
// 拖动条和走势图是 DOM 元素，className 不进渲染文本，按源码断言
// 2026-11-09 用户纠正：九根心情不给用户拖——情绪是被推出来的，不是设出来的
ok('九根没有拖动条（心情不能手动改）', !src.includes('moe-slider') && !src.includes("type: 'range'") && !src.includes('/mo-emotion/dim'))
ok('有走势图（SVG 折线）', src.includes('moe-trend') && src.includes('polyline'))
ok('有边界账卡片', text.includes('边界账') && text.includes('本周吵架'))
ok('九根那行没有重置按钮', !src.includes('doReset') && !src.includes('/mo-emotion/reset'))
// 2026-11-09 补回加减分判定
ok('这一轮判了什么（加减分判定）', src.includes('这一轮判了什么') && src.includes('lastDeltas'))


// 没有 lastChange 时要给「还没动过」
st.grow.lastChange = null
fixture.grow = srv.growView(st)
hookIdx = 0; hookQueue = [fixture, '', fixture.config, '', '60']; rendered.length = 0
try { Panel(); ok('无调整记录时渲染不报错', true) } catch (e) { ok('无调整记录时渲染不报错', false, String(e)) }
ok('没动过时提示「还没动过」', rendered.join(' | ').includes('还没动过'))

// grow 缺字段（旧宿主）不能崩
fixture.grow = { turns: 0, pending: 0, lastChange: null, items: [] }
hookIdx = 0; hookQueue = [fixture, '', fixture.config, '', '60']; rendered.length = 0
try { Panel(); ok('grow 为空数组时不崩', true) } catch (e) { ok('grow 为空数组时不崩', false, String(e)) }

console.log('')
console.log(fails === 0 ? '面板检查全过' : '面板检查失败 ' + fails + ' 项')
process.exit(fails === 0 ? 0 : 1)
