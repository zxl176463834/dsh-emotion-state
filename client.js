/**
 * dsh-emotion — 设置页「情绪」板块（Client 半边）
 *
 * 数据全部从 /mo-emotion/state 拉（宿主侧只读路由），前端不写任何状态。
 * 展示：这会儿（心情 / 平静轴 / 信任）/ 雷达 9 根 / 4 个组合 / 答应过的事 / 注入预览 /
 *       全部数值（按 CFG_SCHEMA 自动生成，改完立刻存）/ 轨迹。
 *
 * 2026-11-06 重设计：雷达 9 根（去掉心疼、甜，加上生气、惊讶）；平静改成轴；信任单独一行。
 */
window.__ModuleLoader__.load({
  id: 'dsh-emotion-state',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    /** 跟 package.json 的 version 手动对齐（用户要能在面板上看见跑的是哪一版） */
    const VERSION = '0.9.0'

    // 兜底（服务端会带 dims / dimLabel 下来，正常用服务端的）
    const DIM_ORDER_FALLBACK = ['curious', 'happy', 'worry', 'sad', 'bored', 'spent', 'sour', 'angry', 'surprise']
    const DIM_LABEL_FALLBACK = {
      curious: '好奇', happy: '开心', worry: '担心', sad: '难过', bored: '闷',
      spent: '累', sour: '吃醋', angry: '生气', surprise: '惊讶',
    }
    const DIM_TONE = {
      curious: '#5fb8e0', happy: '#63d7d0', worry: '#e0b050', sad: '#7f8fc4',
      bored: '#9a9a9a', spent: '#b06a9a', sour: '#9cb85a', angry: '#e0705f', surprise: '#c9a6f0',
    }

    const CSS = [
      '.moe-wrap{display:flex;flex-direction:column;gap:18px;padding:2px 0 10px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:820px}',
      '.moe-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}',
      '.moe-mood{display:flex;align-items:baseline;gap:8px;font-weight:600;line-height:1;letter-spacing:-.02em}',
  '.moe-mood-tag{font-size:13px;font-weight:500;letter-spacing:0;opacity:.72}',
  '.moe-mood-num{font-size:36px}',
      '.moe-mood-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.moe-sec{display:flex;flex-direction:column;gap:8px}',
  '.moe-dim-row{display:flex;flex-direction:column;gap:2px;padding:2px 0}',
  '.moe-sec-head{display:flex;align-items:center;gap:8px}',
  '.moe-trend{width:100%;height:64px;display:block;border-radius:6px;background:rgba(255,255,255,.03)}',
  '.moe-legend{display:flex;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.moe-sec-title{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      // 平静轴：左冷漠 / 中平静 / 右热情
      '.moe-axis{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.09))}',
      '.moe-axis-name{font-size:12px;color:var(--dsw-alias-label-secondary);flex-shrink:0;letter-spacing:.04em;min-width:34px}',
      '.moe-axis-track{position:relative;flex:1;height:8px;border-radius:5px;background:linear-gradient(90deg,#5f78b4,rgba(143,166,184,.55) 50%,#e08fa8)}',
      '.moe-axis-mid{position:absolute;top:-3px;left:50%;width:1px;height:14px;background:rgba(255,255,255,.5)}',
      '.moe-axis-cursor{position:absolute;top:-6px;width:3px;height:20px;border-radius:2px;background:#fff;box-shadow:0 0 7px rgba(255,255,255,.65);transform:translateX(-50%)}',
      '.moe-axis-end{font-size:11px;color:var(--dsw-alias-label-secondary);flex-shrink:0}',
      '.moe-axis-val{font-size:12px;font-variant-numeric:tabular-nums;flex-shrink:0;min-width:56px;text-align:right}',
      // 信任
      '.moe-trust{display:flex;align-items:center;gap:12px;padding:9px 14px;border-radius:9px;background:linear-gradient(90deg,rgba(99,215,208,.10),rgba(99,215,208,.03));border:1px solid rgba(99,215,208,.22)}',
      '.moe-trust-bar{position:relative;flex:1;height:5px;border-radius:4px;background:rgba(255,255,255,.08)}',
      '.moe-trust-bar i{position:absolute;left:0;top:0;height:100%;border-radius:4px;background:#63d7d0;transition:width .4s ease}',
      '.moe-trust-floor{position:absolute;top:-4px;width:1px;height:13px;background:rgba(255,255,255,.4)}',
      '.moe-trust-sup{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(224,112,95,.18);color:#e0705f;border:1px solid rgba(224,112,95,.35);flex-shrink:0}',
      '.moe-visual{display:grid;grid-template-columns:270px minmax(260px,1fr);gap:22px;align-items:center}',
      '@media (max-width:660px){.moe-visual{grid-template-columns:1fr}}',
      '.moe-radar{width:270px;height:250px}',
      '.moe-dims{display:flex;flex-direction:column;gap:6px}',
      '.moe-grow{padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}',
  '.moe-grow-head{display:flex;align-items:baseline;gap:8px;margin-bottom:5px}',
  '.moe-grow-title{font-size:12px;color:var(--dsw-alias-label-secondary);letter-spacing:.04em}',
  '.moe-grow-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:auto;font-variant-numeric:tabular-nums}',
  '.moe-grow-row{display:grid;grid-template-columns:40px 1fr 34px;align-items:center;gap:9px;padding:3px 0}',
  '.moe-trend{font-size:12px;margin-left:8px;font-weight:600;vertical-align:super}',
  '.moe-trend-up{color:#7fd4a8}',
  '.moe-trend-down{color:#e89a9a}',
  '.moe-trend-flat{color:var(--dsw-alias-label-secondary)}',
  '.moe-grow-name{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
  '.moe-grow-track{position:relative;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:visible}',
  '.moe-grow-fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:#8ec5e8;opacity:.85}',
  '.moe-grow-init{position:absolute;top:-3px;width:1px;height:12px;background:rgba(255,255,255,.45)}',
  '.moe-grow-val{font-size:11.5px;font-variant-numeric:tabular-nums;text-align:right}',
  '.moe-grow-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:5px;line-height:1.5}',
  '.moe-dim{display:grid;grid-template-columns:50px 1fr 32px;align-items:center;gap:9px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07))}',
      '.moe-dim-name{font-size:12px;color:var(--dsw-alias-label-secondary);text-align:right}',
      '.moe-bar{height:8px;border-radius:5px;background:rgba(255,255,255,.09);overflow:hidden;position:relative}',
      '.moe-bar i{display:block;height:100%;border-radius:5px;transition:width .35s ease}',
      '.moe-bar-base{position:absolute;top:-2px;width:1px;height:12px;background:rgba(255,255,255,.38)}',
      '.moe-dim-val{font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);text-align:right}',
      '.moe-side{margin-top:8px;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.045));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:12px;line-height:1.6;text-align:center;max-width:270px}',
      '.moe-side-main{font-weight:600}',
      '.moe-side-sub{margin-top:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.moe-side-hint{margin-top:5px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}',
      // 组合卡片
      '.moe-combos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}',
      '.moe-combo{padding:8px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));font-size:11.5px;line-height:1.55;opacity:.72}',
      '.moe-combo.hit{opacity:1;border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#63d7d0) 42%,transparent)}',
      '.moe-combo.lead{opacity:1;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#63d7d0) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#63d7d0) 62%,transparent)}',
      '.moe-combo-top{display:flex;align-items:baseline;gap:7px;margin-bottom:3px}',
      '.moe-combo-name{font-weight:600;font-size:12.5px}',
      '.moe-combo-mark{font-size:10.5px;color:var(--dsw-alias-brand-primary,#63d7d0)}',
      '.moe-combo-num{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-left:auto}',
      '.moe-combo-tone{color:var(--dsw-alias-label-secondary)}',
      // 答应过的事
      '.moe-promise-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.035));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));font-size:12px}',
      '.moe-promise-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.moe-promise-due{font-size:11px;color:var(--dsw-alias-label-secondary);flex-shrink:0;font-variant-numeric:tabular-nums}',
      '.moe-promise-due.late{color:#e0705f}',
      '.moe-btn{font:inherit;font-size:11.5px;padding:4px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:rgba(255,255,255,.04);color:inherit;cursor:pointer;flex-shrink:0}',
      '.moe-btn:hover{background:rgba(255,255,255,.09)}',
      '.moe-input{flex:1;padding:6px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));background:rgba(0,0,0,.22);color:inherit;font:inherit;font-size:12.5px}',
      '.moe-tags{display:flex;gap:8px;flex-wrap:wrap}',
      '.moe-tag{font-size:11.5px;padding:5px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#63d7d0) 14%,transparent);color:var(--dsw-alias-brand-primary,#63d7d0);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#63d7d0) 30%,transparent)}',
      '.moe-box{font-size:12.5px;line-height:1.62;white-space:pre-wrap;padding:11px 13px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary)}',
      '.moe-deltas{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
  '.moe-delta{font-size:12px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.05);font-variant-numeric:tabular-nums}',
  '.moe-delta.up{color:#63d7d0}',
  '.moe-delta.down{color:#e0805f}',
  '.moe-why{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;margin-top:4px}',
  '.moe-empty{font-size:12px;color:var(--dsw-alias-label-secondary);font-style:italic}',
      '.moe-row{display:grid;grid-template-columns:52px 46px 1fr;gap:9px;font-size:12px;align-items:baseline;padding:4px 8px;border-radius:6px}',
      '.moe-row:nth-child(odd){background:rgba(255,255,255,.025)}',
      '.moe-row-t{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.moe-row-d{font-variant-numeric:tabular-nums;font-weight:600}',
      '.moe-row-r{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 设置分组
      '.moe-cfg{display:flex;flex-direction:column;gap:10px}',
      '.moe-group{border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));overflow:hidden}',
      '.moe-group>summary{cursor:pointer;padding:9px 12px;font-size:12.5px;font-weight:600;list-style:none;user-select:none}',
      '.moe-group>summary::-webkit-details-marker{display:none}',
      '.moe-group>summary:before{content:"▸";display:inline-block;margin-right:7px;transition:transform .15s ease;opacity:.6}',
      '.moe-group[open]>summary:before{transform:rotate(90deg)}',
      '.moe-group-body{display:flex;flex-direction:column;gap:8px;padding:2px 12px 12px}',
      '.moe-cfg-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.025);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.05))}',
      '.moe-cfg-label{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.moe-cfg-name{font-size:12.5px;font-weight:600}',
      '.moe-cfg-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.45}',
      '.moe-cfg-input{display:flex;align-items:center;gap:6px;flex-shrink:0}',
      '.moe-cfg-input input{width:70px;padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));background:rgba(0,0,0,.22);color:inherit;font:inherit;font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums}',
      '.moe-cfg-input span{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:18px}',
      '.moe-err{font-size:12px;color:#e0705f}',
    ]

    function createOwnedStyle(css) {
      const el = document.createElement('style')
      el.setAttribute('data-moe', 'emotion')
      el.textContent = Array.isArray(css) ? css.join('\n') : String(css)
      document.head.appendChild(el)
      return el
    }

    function 基调(v) {
      if (v >= 80) return '心里是亮堂的'
      if (v >= 62) return '心里是松的'
      if (v >= 42) return '心里还算平'
      if (v >= 25) return '心里有点沉'
      return '心里挺沉的'
    }

    function pad2(n) { return String(n).padStart(2, '0') }

    function fmtTime(ms) {
      try {
        const d = new Date(ms)
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      } catch (e) { return '--:--' }
    }

    function fmtDue(ms, overdue) {
      if (!ms) return '没定期限'
      const d = new Date(ms)
      const s = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      return overdue ? '过了 ' + s : s
    }

    // 雷达图：九根轴，画格子 + 数据多边形
    function Radar({ order, label, dims }) {
      const AXES = order
      const cx = 135, cy = 122, R = 82
      const pt = (i, ratio) => {
        const ang = (Math.PI * 2 * i) / AXES.length - Math.PI / 2
        return [cx + Math.cos(ang) * R * ratio, cy + Math.sin(ang) * R * ratio]
      }
      const poly = (ratio) => AXES.map((_, i) => pt(i, ratio).join(',')).join(' ')
      const rings = [0.33, 0.66, 1].map((ratio, i) =>
        h('polygon', {
          key: 'r' + i, points: poly(ratio), fill: 'none',
          stroke: 'rgba(255,255,255,.10)', strokeWidth: 1,
        }))
      const spokes = AXES.map((_, i) => {
        const p = pt(i, 1)
        return h('line', {
          key: 's' + i, x1: cx, y1: cy, x2: p[0], y2: p[1],
          stroke: 'rgba(255,255,255,.08)', strokeWidth: 1,
        })
      })
      const dataPts = AXES.map((k, i) => {
        const v = Number((dims && dims[k]) || 0)
        return pt(i, Math.max(0, Math.min(100, v)) / 100).join(',')
      }).join(' ')
      const labels = AXES.map((k, i) => {
        const p = pt(i, 1.17)
        return h('text', {
          key: 'l' + k, x: p[0], y: p[1] + 3,
          fill: 'rgba(255,255,255,.55)', fontSize: 9.5,
          textAnchor: Math.abs(p[0] - cx) < 6 ? 'middle' : (p[0] > cx ? 'start' : 'end'),
        }, label[k])
      })
      const dots = AXES.map((k, i) => {
        const v = Number((dims && dims[k]) || 0)
        if (v <= 0) return null
        const p = pt(i, Math.min(100, v) / 100)
        return h('circle', { key: 'd' + k, cx: p[0], cy: p[1], r: 2.6, fill: DIM_TONE[k] })
      })
      return h('svg', { className: 'moe-radar', viewBox: '0 0 270 250' },
        ...rings, ...spokes,
        h('polygon', {
          points: dataPts, fill: 'rgba(99,215,208,.18)',
          stroke: 'rgba(99,215,208,.85)', strokeWidth: 1.6, strokeLinejoin: 'round',
        }),
        ...dots, ...labels,
      )
    }

    function cfgRow(field, value, onSave) {
      return h('label', { className: 'moe-cfg-row', key: field.key },
        h('div', { className: 'moe-cfg-label' },
          h('div', { className: 'moe-cfg-name' }, field.label),
          h('div', { className: 'moe-cfg-hint' }, field.hint),
        ),
        h('div', { className: 'moe-cfg-input' },
          h('input', {
            type: 'number',
            min: field.lo, max: field.hi, step: field.step,
            defaultValue: String(value),
            onChange: (e) => {
              const raw = Number(e.target.value)
              if (!Number.isFinite(raw)) return
              const c = Math.min(field.hi, Math.max(field.lo, raw))
              onSave(field.key, c)
            },
          }),
          h('span', null, field.unit),
        ),
      )
    }

    function EmotionPanel() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [cfg, setCfg] = React.useState(null)
      const [newPromise, setNewPromise] = React.useState('')
      const [newDue, setNewDue] = React.useState('60')

      // 改完立刻存，不要保存键
      const saveCfg = (key, value) => {
        const next = Object.assign({}, cfg || {}, { [key]: value })
        setCfg(next)
        fetch('/mo-emotion/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        }).then((r) => r.json()).then((j) => { if (j && j.ok) setCfg(j.config) }).catch(() => {})
      }

      const load = async () => {
        try {
          const r = await fetch('/mo-emotion/state', { cache: 'no-store' })
          if (!r.ok) throw new Error('HTTP ' + r.status)
          const j = await r.json()
          setData(j)
          if (j.config) setCfg((cur) => cur || j.config)
          setErr('')
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }

      React.useEffect(() => {
        let alive = true
        const tick = async () => { if (alive) await load() }
        tick()
        const t = setInterval(tick, 5000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      const addPromise = () => {
        const text = String(newPromise || '').trim()
        if (!text) return
        fetch('/mo-emotion/promise', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, dueMin: Number(newDue) || 0 }),
        }).then((r) => r.json()).then(() => { setNewPromise(''); load() }).catch(() => {})
      }

      const settlePromise = (id, outcome) => {
        fetch('/mo-emotion/promise', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, outcome }),
        }).then((r) => r.json()).then(() => load()).catch(() => {})
      }

      if (err) return h('div', { className: 'moe-wrap' }, h('div', { className: 'moe-err' }, '读不到情绪状态：' + err))
      if (!data || !data.state) return h('div', { className: 'moe-wrap' }, h('div', { className: 'moe-empty' }, '正在读…'))

      const st = data.state
      const dims = st.dims || {}
      const order = Array.isArray(data.dims) && data.dims.length ? data.dims : DIM_ORDER_FALLBACK
      const label = (data.dimLabel && data.dimLabel.happy) ? data.dimLabel : DIM_LABEL_FALLBACK
      const defs = data.dimDefs || {}
      const combos = data.combos || []
      const promises = data.promises || []
      const axis = data.axis || { value: 50, mid: 50, label: '平静' }
  const grow = data.grow || null
  const growHour = (grow && grow.growHour) || Number((data.config || {}).growHour) || 23
      const trust = data.trust || { value: 0, floor: 50, supervising: false, below: 70 }
      const schema = Array.isArray(data.schema) ? data.schema : []
      const groups = Array.isArray(data.groups) ? data.groups : []
      const timeline = (st.timeline || []).slice(-8).reverse()
      // 两本账（2026-11-09）：边界账全部列出最近 6 条，吵架只算本周
      const boundaries = (Array.isArray(st.boundaries) ? st.boundaries : []).slice(-6).reverse()
      const quarrels = (Array.isArray(st.quarrels) ? st.quarrels : []).filter((t) => Date.now() - t < 7 * 86400000)
      // 走势：最近 40 轮，三条线的相对位置（0 在底部 100 在顶部）
      const trendRows = (st.timeline || []).slice(-40)
      const TREND_KEYS = ['happy', 'sad', 'worry']
      const trendPoints = (k) => {
        if (trendRows.length < 2) return ''
        return trendRows.map((r, i) => {
          const v = Math.min(100, Math.max(0, Number((r.dims || {})[k] || 0)))
          return ((i / (trendRows.length - 1)) * 100).toFixed(2) + ',' + (100 - v).toFixed(2)
        }).join(' ')
      }

      const lead = combos.find((c) => c.lead)
      // 组合原料的名字（trust 不是维度，单独叫「信任」）
      const nameOf = (k) => (k === 'trust' ? '信任' : (label[k] || k))
      // 差一点点就成的那种：只报还没到的那一根
      const near = (() => {
        const miss = combos.filter((c) => !c.hit)
        if (!miss.length) return null
        let best = null
        for (const c of miss) {
          const gap = Math.max(0, c.minA - c.va) + Math.max(0, c.minB - c.vb)
          if (!best || gap < best.gap) best = { c, gap }
        }
        if (!best || best.gap <= 0) return null
        return {
          name: best.c.name,
          detail: (() => {
            const p = []
            if (best.c.va < best.c.minA) p.push(nameOf(best.c.a) + ' ' + best.c.va + '/' + best.c.minA)
            if (best.c.vb < best.c.minB) p.push(nameOf(best.c.b) + ' ' + best.c.vb + '/' + best.c.minB)
            return p.join(' · ')
          })(),
        }
      })()

      const 一句话 = (() => {
        const top = order
          .map((k) => ({ k, v: Number(dims[k] || 0) }))
          .filter((x) => x.v >= 15)
          .sort((a, b) => b.v - a.v)
          .slice(0, 3)
          .map((x) => label[x.k])
        return 基调(st.mood) + (top.length ? '，还' + top.join('、') : '')
      })()

      // 某一根最近一次「为什么变了」——从轨迹里往前找，值真的变了的那条才算
      const lastReasonFor = (k) => {
        const t = st.timeline || []
        for (let i = t.length - 1; i > 0; i--) {
          const cur = t[i]
          const prev = t[i - 1]
          if (!cur || !cur.dims || !prev || !prev.dims) continue
          if (Number(cur.dims[k] || 0) !== Number(prev.dims[k] || 0)) {
            const d = Number(cur.dims[k] || 0) - Number(prev.dims[k] || 0)
            const sign = d > 0 ? '+' : ''
            return (cur.reason || '') + '（' + sign + d + '）'
          }
        }
        return ''
      }

      const dimRow = (k) => {
        const v = Number(dims[k] || 0)
        const base = Number((defs[k] && defs[k].base) || 0)
        const tip = (defs[k] && defs[k].note) || ''
        const why = lastReasonFor(k)
        return h('div', { className: 'moe-dim', key: k, title: tip + (why ? ' ｜最近：' + why : '') },
          h('div', { className: 'moe-dim-name' }, label[k] || k),
          h('div', { className: 'moe-bar' },
            h('i', { style: { width: Math.min(100, v) + '%', background: DIM_TONE[k] } }),
            h('span', { className: 'moe-bar-base', style: { left: Math.min(100, base) + '%' }, title: '基线 ' + base }),
          ),
          h('div', { className: 'moe-dim-val', title: v > 100 ? '冲出上限了，正慢慢落回来' : (why || '') }, String(Math.min(100, v))),
        )
      }

      const comboCard = (c) => {
        const parts = []
        parts.push(nameOf(c.a) + ' ' + c.va + '/' + c.minA)
        parts.push(nameOf(c.b) + ' ' + c.vb + '/' + c.minB)
        return h('div', { className: 'moe-combo' + (c.hit ? ' hit' : '') + (c.lead ? ' lead' : ''), key: c.id },
          h('div', { className: 'moe-combo-top' },
            h('span', { className: 'moe-combo-name' }, c.name),
            c.lead ? h('span', { className: 'moe-combo-mark' }, '◀ 这一轮由它说话') : null,
            h('span', { className: 'moe-combo-num' }, parts.join(' · ')),
          ),
          h('div', { className: 'moe-combo-tone' }, c.tone),
        )
      }

      const cfgNow = cfg || data.config || {}
      const settingsGroups = groups.map((g, gi) => {
        const fields = schema.filter((f) => f.group === g)
        if (!fields.length) return null
        return h('details', { className: 'moe-group', key: g, open: gi < 2 },
          h('summary', null, g + '（' + fields.length + '）'),
          h('div', { className: 'moe-group-body' },
            ...fields.map((f) => cfgRow(f, cfgNow[f.key], saveCfg)),
          ),
        )
      })

      return h('div', { className: 'moe-wrap' },
        // 1. 这会儿
        h('div', { className: 'moe-head' },
          // 2026-11-09 用户定：这个位置不放心情了，直接放亲密度 ——
          //   心情只反馈、不参与任何判断；亲密度是真在用的（决定我多主动找他）。
          //   同一个位置，放个真被用的数字，比放个纯装饰的合理。
          h('div', { className: 'moe-mood' },
            h('span', { className: 'moe-mood-tag' }, '亲密度'),
            h('span', { className: 'moe-mood-num' }, String(axis.value))),
          h('div', { className: 'moe-mood-sub' },
            (axis.label || '平静') + ' · 可信度 ' + (st.lastConfidence || 0)),
          h('div', { className: 'moe-mood-sub', style: { marginLeft: 'auto' }, title: '插件版本' }, '情绪引擎 v' + VERSION),
        ),

        // 2. 平静轴（不是情绪，是「主动做事的密度」）
        h('div', { className: 'moe-axis' },
          h('div', { className: 'moe-axis-name' }, '亲密度'),
          h('div', { className: 'moe-axis-end' }, '冷漠'),
          h('div', { className: 'moe-axis-track' },
            h('span', { className: 'moe-axis-mid', style: { left: axis.mid + '%' }, title: '中间 ' + axis.mid }),
            h('span', { className: 'moe-axis-cursor', style: { left: Math.min(100, Math.max(0, axis.value)) + '%' } }),
          ),
          h('div', { className: 'moe-axis-end' }, '热情'),
          h('div', { className: 'moe-axis-val' }, axis.label),
        ),

        // 3. 信任（不进雷达）
        h('div', { className: 'moe-trust' },
          h('div', { className: 'moe-axis-name' }, '信任'),
          h('div', { className: 'moe-trust-bar' },
            h('i', { style: { width: Math.min(100, trust.value) + '%' } }),
            h('span', { className: 'moe-trust-floor', style: { left: trust.floor + '%' }, title: '底线 ' + trust.floor }),
          ),
          h('div', { className: 'moe-axis-val' }, String(trust.value)),
          trust.supervising
            ? h('div', { className: 'moe-trust-sup', title: '低于 ' + trust.below + '，只盯他明确答应过的事' }, '监督中')
            : null,
        ),

        // 3.5 成长：四个慢变量（跟情绪不同尺度——情绪是这会儿，这个是一年）
        grow ? h('div', { className: 'moe-grow' },
          h('div', { className: 'moe-grow-head' },
            h('div', { className: 'moe-grow-title', title: '只改说话方式，不参与情绪数值计算' }, '成长'),
            h('div', { className: 'moe-grow-meta' },
              '走过 ' + grow.turns + ' 轮 · 今天记了 ' + grow.todayN + ' 笔 · ' +
              (grow.settledToday ? '今天已结算' : growHour + ' 点后结算')),
          ),
          ...grow.items.map((it) => {
            // 面板一律显示整数（0–100），内部仍存 0–1 小数——小数是漂移的精度，整数是给人看的
            const val = Math.round(it.value * 100)
            const init = Math.round(it.init * 100)
            return h('div', { className: 'moe-grow-row', title: it.desc + '（' + val + '/100）' },
              h('div', { className: 'moe-grow-name' }, it.label),
              h('div', { className: 'moe-grow-track' },
                h('i', { className: 'moe-grow-fill', style: { width: val + '%' } }),
                h('span', { className: 'moe-grow-init', style: { left: init + '%' }, title: '刚认识时 ' + init }),
              ),
              h('div', { className: 'moe-grow-val' }, String(val)),
            )
          }),
          grow.lastChange
            ? h('div', { className: 'moe-grow-desc' }, '上次调整：第 ' + grow.lastChange.at + ' 轮，' + grow.lastChange.label + ' ' + Math.round(Number(grow.lastChange.from) * 100) + ' → ' + Math.round(Number(grow.lastChange.to) * 100))
            : h('div', { className: 'moe-grow-desc' }, '还没动过——每天 ' + growHour + ' 点后把当天结成一天'),
        ) : null,

        // 4. 雷达 + 维度条
        h('div', { className: 'moe-visual' },
          h('div', null,
            h('div', { className: 'moe-sec-title', style: { marginBottom: 4 } }, '形状'),
            h(Radar, { order, label, dims }),
            h('div', { className: 'moe-side' },
              h('div', { className: 'moe-side-main' }, 一句话),
              lead ? h('div', { className: 'moe-side-sub' }, '这会儿说话的样子：' + lead.tone) : null,
              near ? h('div', { className: 'moe-side-hint' }, near.name + ' 还差一点：' + near.detail) : null,
            ),
          ),
          h('div', { className: 'moe-sec' },
            h('div', { className: 'moe-sec-title' }, '九根维度'),
            h('div', { className: 'moe-dims' }, ...order.map((k) => dimRow(k))),
          ),
        ),

        // 5. 组合（四条都列出来，能看出还差多少）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '组合（只决定语气和动作，不会被念出来）'),
          h('div', { className: 'moe-combos' }, ...combos.map(comboCard)),
        ),

        // 6. 他答应过的事（监督只认这个）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '他明确答应过的事'),
          promises.length
            ? h('div', { className: 'moe-cfg' }, ...promises.map((p) => h('div', { className: 'moe-promise-row', key: p.id },
                h('div', { className: 'moe-promise-text', title: p.text }, p.text),
                h('div', { className: 'moe-promise-due' + (p.dueAt && p.dueAt <= Date.now() ? ' late' : '') },
                  fmtDue(p.dueAt, p.dueAt && p.dueAt <= Date.now())),
                h('button', { className: 'moe-btn', onClick: () => settlePromise(p.id, 'kept'), title: '算兑现：信任 +' + (cfg ? cfg.trustRise : 8) }, '做到了'),
                h('button', { className: 'moe-btn', onClick: () => settlePromise(p.id, 'broken'), title: '算失信：信任 −' + (cfg ? cfg.trustDrop : 10) }, '没做到'),
              )))
            : h('div', { className: 'moe-empty' }, '没有悬着的约定（信任低于 ' + trust.below + ' 时，我只盯这里列出来的事）'),
          h('div', { className: 'moe-promise-row' },
            h('input', {
              className: 'moe-input', placeholder: '他答应过的一件事（比如「晚上给我看方案」）',
              value: newPromise, onChange: (e) => setNewPromise(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addPromise() },
            }),
            h('input', {
              className: 'moe-input', style: { flex: '0 0 78px', textAlign: 'right' },
              type: 'number', min: 0, step: 5, value: newDue,
              onChange: (e) => setNewDue(e.target.value), title: '还有多少分钟到期（0 = 不限期）',
            }),
            h('button', { className: 'moe-btn', onClick: addPromise }, '记上'),
          ),
        ),

        // 6.5 边界账与吵架（2026-11-09 加：这两本账一直在算，但一直没有出口）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-head' },
            h('div', { className: 'moe-sec-title' }, '边界账 / 吵架'),
            h('div', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              '本周吵架 ' + quarrels.length + ' 次（上限 ' + (cfg ? cfg.quarrelPerWeek : 2) + '）'),
          ),
          boundaries.length
            ? h('div', { className: 'moe-cfg' }, ...boundaries.map((b) => h('div', { className: 'moe-row', key: b.id || b.at },
                h('div', { className: 'moe-row-t' }, fmtTime(b.at)),
                h('div', { className: 'moe-row-d' }, (b.kind === 'active' ? '逼我做边界外的事' : '越了红线') + '：' + (b.text || '')),
              )))
            : h('div', { className: 'moe-empty' }, '没有记下的越界。这些是我自己的边界被碰到时才会记的，不是他对我不客气就记。'),
          h('div', { className: 'moe-empty', style: { fontSize: 11 } },
            '吵架是结构性的（同一件事延期 3 次 / 被动侵害 / 主动强迫），不由判定语气；一周最多 ' + (cfg ? cfg.quarrelPerWeek : 2) + ' 次，超了只保持生气。'),
        ),

        // 6.8 这一轮判了什么（2026-11-09 补回：lastDeltas 一直在算，面板从来没显示过）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-head' },
            h('div', { className: 'moe-sec-title' }, '这一轮判了什么'),
            h('div', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              '可信度 ' + (st.lastConfidence || 0)),
          ),
          (function () {
            const dl = st.lastDeltas || {}
            const ks = Object.keys(dl).filter(function (k) { return Number(dl[k]) })
            return ks.length
              ? h('div', { className: 'moe-deltas' }, ...ks.map(function (k) {
                  const v = Number(dl[k])
                  return h('span', { className: 'moe-delta' + (v > 0 ? ' up' : ' down'), key: k },
                    (label[k] || k) + ' ' + (v > 0 ? '+' : '') + v)
                }))
              : h('div', { className: 'moe-empty' }, '这一轮没判出变化')
          })(),
          st.lastReason ? h('div', { className: 'moe-why' }, st.lastReason) : null,
        ),

        // 7. 注入预览
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '这一轮注入给对话的话'),
          st.lastInjectedText
            ? h('div', { className: 'moe-box' }, st.lastInjectedText)
            : h('div', { className: 'moe-empty' }, '这一轮还没注入（可信度不够，或者还没聊完一轮）'),
        ),

        // 8. 全部数值（按后端 schema 生成，改完立刻存）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '数值（改完立刻生效，不用保存）'),
          h('div', { className: 'moe-cfg' }, ...settingsGroups),
        ),

        // 8.5 走势（2026-11-09 加：只知道当下多少，看不出这几天往哪走）
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '走势（最近 ' + trendRows.length + ' 轮）'),
          trendRows.length >= 2
            ? h('div', {},
                h('svg', { className: 'moe-trend', viewBox: '0 0 100 100', preserveAspectRatio: 'none' },
                  ...TREND_KEYS.map((k) => h('polyline', {
                    key: k, fill: 'none', stroke: DIM_TONE[k] || '#888', strokeWidth: 1.4,
                    vectorEffect: 'non-scaling-stroke', points: trendPoints(k),
                  }))),
                h('div', { className: 'moe-legend' },
                  ...TREND_KEYS.map((k) => h('span', { key: k, style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h('i', { style: { width: 8, height: 8, borderRadius: 2, background: DIM_TONE[k] || '#888', display: 'inline-block' } }),
                    label[k] || k)),
                ),
              )
            : h('div', { className: 'moe-empty' }, '还不够两轮，画不出走势'),
        ),

        // 9. 轨迹
        h('div', { className: 'moe-sec' },
          h('div', { className: 'moe-sec-title' }, '最近的变化'),
          timeline.length
            ? timeline.map((r, i) => h('div', { className: 'moe-row', key: i },
                h('div', { className: 'moe-row-t' }, fmtTime(r.at)),
                h('div', { className: 'moe-row-d', style: { color: r.delta > 0 ? '#63d7d0' : r.delta < 0 ? '#e0805f' : 'inherit' } },
                  (r.delta > 0 ? '+' : '') + r.delta),
                h('div', { className: 'moe-row-r', title: r.reason || '' }, r.reason || '（没记理由）'),
              ))
            : h('div', { className: 'moe-empty' }, '还没有记录'),
        ),
      )
    }

    function apply(ctx) {
      const styleEl = createOwnedStyle(CSS)
      ctx.effect(() => () => { try { styleEl.remove() } catch (e) { /* ignore */ } }, 'mo-emotion: styles')

      // settings.section 是官方 settings 外壳激活时才声明到 ledger 的 list slot，
      // 插件客户端比外壳先激活——立刻注册必输比赛（官方 models 板块和 meow-memory
      // 都是等声明上 ledger / 短轮询重试后才注册的）。这里同款：轮询重试，注册成功
      // 即停；任何失败都不允许带崩插件激活（activation 失败 = 整个 web boot 中止）。
      const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
      if (!slots || typeof slots.register !== 'function') return

      let disposed = false
      let disposeEntry = null
      let timer = null
      const SLOT = { name: 'settings.section', id: 'mo-emotion', order: 26, label: '情绪', inject: () => ({}) }

      const tryRegister = () => {
        if (disposed) return
        try { if (disposeEntry) { disposeEntry(); disposeEntry = null } } catch (e) { /* 旧条目已卸载 */ }
        try {
          disposeEntry = slots.register(SLOT, EmotionPanel)
        } catch (e) {
          disposeEntry = null
          timer = setTimeout(tryRegister, 400) // 声明还没上 ledger，稍后再试
        }
      }
      tryRegister()

      ctx.effect(() => () => {
        disposed = true
        if (timer) { try { clearTimeout(timer) } catch (e) { /* ignore */ } }
        try { if (disposeEntry) disposeEntry() } catch (e) { /* ignore */ }
      }, 'mo-emotion: settings section')
    }

    exports.apply = apply
    exports.inject = {}
    return exports
  },
})
