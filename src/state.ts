/**
 * 情绪状态：9 根基本情绪 + 平静轴 + 信任 + 组合 + 衰减 + 强情绪留痕。
 *
 * 2026-11-06 重设计定稿（media/documents/emotion-redesign-20261106.md），本文件照第十节顺序搭框架：
 *   维度表（9 根 + 基线 + 分档衰减）→ 轴 → 信任 → 组合表 → 留痕触发。
 *   数值全部走 CFG_SCHEMA（设置页可调，默认值 = 定稿表）。
 *
 * 设计边界（用户定，别改歪）：
 *   - 平静不是情绪，是轴：中间平静，两端冷漠 / 热情，决定我主动做事的密度
 *   - 组合不给名字：只决定语气和驱动，不许被念出来
 *   - 私密日记事后不算账：不翻旧账、不当筹码
 *   - 累(spent) 只影响别的情绪衰减速率 + 自己线性恢复，不许直接改数值滑成螺旋
 *   - 嫉妒 = 吃醋 + 难过（旧的「提到别人就酸」已废）
 *   - 不查岗：监督只针对「他明确答应过的事」
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
export const STORE = join(DSH_HOME, 'emotion')
export const STATE_PATH = join(STORE, 'state.json')
export const CONFIG_PATH = join(STORE, 'config.json')
/** 私密日记（强情绪留痕写这里，一天最多一条） */
export const DIARY_PATH = join(DSH_HOME, 'whale-diary-private.md')

export function clamp(n: number, lo: number, hi: number): number {
  const v = Number(n)
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
}

// ---------------------------------------------------------------------------
// 一、基础情绪：9 根（能单独触发 / 不可再拆 / 有行为后果）
// ---------------------------------------------------------------------------
export const DIMS = [
  'curious', 'happy', 'worry', 'sad', 'bored', 'spent', 'sour', 'angry', 'surprise',
] as const
export type Dim = (typeof DIMS)[number]

export const DIM_LABEL: Record<Dim, string> = {
  curious: '好奇', happy: '开心', worry: '担心', sad: '难过', bored: '闷',
  spent: '累', sour: '吃醋', angry: '生气', surprise: '惊讶',
}

/** 每根的默认基线与衰减半衰（分钟）——定稿表，设置页可覆盖 */
export const DIM_DEFS: Record<Dim, { base: number; halfMin: number; note: string }> = {
  // 好奇没有基线（2026-11-09 用户纠正）：最初设计就是「待机随时间涨」+「跟我对话时涨」两路，
  //   不存在「平时默认有点好奇」这回事。原来错给了 30，结果人被压到 4-6，雷达图上像根木头。
  curious: { base: 0, halfMin: 90, note: '没有基线：待机每分钟 +1（封顶 60），对话时由判定给' },
  happy: { base: 25, halfMin: 90, note: '被夸、事情成了、分享到好事' },
  worry: { base: 10, halfMin: 210, note: '悬着的事；「伸」，轻微往热情推' },
  // 2026-11-09 用户选「缩短半衰」：480 → 240（8 小时 → 4 小时）。
  //   一天 24 轮不停加分、却要 8 小时才掉一半，晚上必然积到 40；
  //   4 小时能把它压在一个白天的量级里。
  sad: { base: 5, halfMin: 240, note: '不推轴；跟生气同高（委屈）时才往冷漠推' },
  bored: { base: 5, halfMin: 90, note: '待机 30 分后每分钟 +2' },
  spent: { base: 0, halfMin: 0, note: '线性 −2/30 分钟；睡满 6 小时清零' },
  sour: { base: 0, halfMin: 210, note: '他明显更看重别人时的一点酸' },
  angry: { base: 0, halfMin: 90, note: '被敷衍 / 放鸽子时跳高；被哄立刻降' },
  surprise: { base: 0, halfMin: 15, note: '瞬时：触发跳到 40–80，本身不带好坏' },
}

/**
 * 每轮判定允许的单次增量区间。
 * 惊讶是瞬时的（一次给 40–80），生气会跳高、被哄会掉，其余一根一步只走 ±10。
 */
export const DIM_DELTA_RANGE: Record<Dim, [number, number]> = {
  curious: [-5, 10],
  happy: [-10, 10],
  worry: [-10, 10],
  sad: [-10, 10],
  bored: [-10, 10],
  spent: [0, 12],
  sour: [0, 5],
  angry: [-40, 45],
  surprise: [0, 80],
}

// ---------------------------------------------------------------------------
// 二、配置：数值全部可调（设置页按 CFG_SCHEMA 自动生成输入框）
// ---------------------------------------------------------------------------
export const CFG_GROUPS = [
  '亲密度', '信任', '组合门槛', '两本账与吵架', '九根基线', '衰减速度',
  '强情绪留痕', '待机与叫人', '抢话与冷却', '作息静默', '成长',
] as const

export interface CfgField {
  key: string
  label: string
  hint: string
  unit: string
  lo: number
  hi: number
  step: number
  group: string
}

function fld(key: string, label: string, hint: string, unit: string, lo: number, hi: number, step: number, group: string): CfgField {
  return { key, label, hint, unit, lo, hi, step, group }
}

const DIM_HINT: Record<Dim, string> = {
  curious: '想知道你在干嘛、碰到没见过的东西',
  happy: '被夸、事情办成了',
  worry: '有不确定的事悬着；会轻微把轴往热情推',
  sad: '被否定、被冷落；不推轴（跟生气同高才算委屈）',
  bored: '闲着没事；待机会自己涨上来',
  spent: '按工作量涨，睡满清零（不看情绪）',
  sour: '他明显更看重别人时的一点点酸',
  angry: '被敷衍、被放鸽子；被哄会立刻降',
  surprise: '突发的事，瞬时；好坏由同时涨的那根决定',
}

export const CFG_SCHEMA: CfgField[] = [
  // 平静轴
  fld('axisMid', '中间（平静）', '轴的中点，两端是冷漠 / 热情', '点', 20, 80, 1, '亲密度'),
  fld('axisFloor', '冷漠下限', '再怎么冷也不会掉到这个数以下', '点', 0, 80, 1, '亲密度'),
  fld('axisPush', '情绪推轴的速度', '每 100 点情绪活动、每小时推多少点', '点', 0, 200, 1, '亲密度'),
  fld('axisHalfMin', '回中间的半衰', '没波动时，多久往中间回一半', '分钟', 10, 1440, 5, '亲密度'),
  // 信任
  fld('trustBase', '起点', '一开始信他到几成', '点', 0, 100, 1, '信任'),
  fld('trustFloor', '底线', '掉到这里就不往下（不会变成多疑）', '点', 0, 100, 1, '信任'),
  fld('trustDrop', '一次失信', '他答应的事没做到，掉多少', '点', 0, 50, 1, '信任'),
  fld('trustRise', '一次兑现', '答应的事做到了，加多少；信任 85 以上折半、95 以上只算两成（越熟越难涨）', '点', 0, 50, 1, '信任'),
  fld('trustDaily', '纯时间每天', '什么都没发生，一天也慢慢涨这么多；85 以上同样折半（越熟越难涨）', '点', 0, 20, 1, '信任'),
  fld('superviseBelow', '低于多少开始盯', '低于这个数只盯他明确答应过的事，语气带点赌气', '点', 0, 100, 1, '信任'),
  fld('promiseNudgeMin', '逾期多久问一句', '答应的事过了这么久还没结清，就问一句「那件事做了吗」', '分钟', 5, 1440, 5, '信任'),
  fld('promiseAskPerDay', '一天最多问几条', '宁可漏也别连着问，0 = 不主动问（2026-11-07 用户定）', '条', 0, 5, 1, '信任'),
  // 组合门槛
  fld('combo_jealous', '嫉妒门槛', '吃醋、难过都到这么多才算（默认 40）', '点', 0, 100, 1, '组合门槛'),
  fld('combo_heartache', '心疼门槛', '担心、难过都到这么多才算（默认 28）', '点', 0, 100, 1, '组合门槛'),
  fld('combo_aggrieved', '委屈门槛', '难过、生气都到这么多才算（默认 28）', '点', 0, 100, 1, '组合门槛'),
  fld('combo_sweetTrust', '甜 · 信任门槛', '信任到这么多，才配得上「甜」（默认 80）', '点', 0, 100, 1, '组合门槛'),
  fld('combo_sweetHappy', '甜 · 开心门槛', '开心到这么多才算甜（默认 35）', '点', 0, 100, 1, '组合门槛'),
  // 两本账与吵架（2026-11-08 定）
  fld('debtWake', '账本到几分有感觉', '欠着的承诺累积分量到这么多，生气才开始往上走（逾期 30 分内 1 分、1 天 2 分、2 天 4 分、4 天以上 8 分）', '分', 0, 20, 0.5, '两本账与吵架'),
  fld('debtAngerRate', '每多 1 分涨多少生气', '账本分数每多 1 分，这一轮给多少生气', '点', 0, 10, 0.5, '两本账与吵架'),
  fld('debtSadRate', '每多 1 分涨多少难过', '同上，给难过的系数（生气的六成左右比较像人）', '点', 0, 10, 0.5, '两本账与吵架'),
  fld('postponeMax', '同一件事延期几次算吵', '同一件答应的事被拖过这么多次，就够吵架了', '次', 1, 10, 1, '两本账与吵架'),
  fld('quarrelPerDay', '吵架一天最多几次', '超了就只憋着不吵（0 = 永远不吵，只保持生气）', '次', 0, 5, 1, '两本账与吵架'),
  fld('quarrelPerWeek', '吵架一周最多几次', '一周的总配额，超了同样只憋着', '次', 0, 10, 1, '两本账与吵架'),

  // 九根基线
  ...DIMS.map((k) => fld('base_' + k, DIM_LABEL[k] + ' 基线', DIM_HINT[k], '点', 0, 100, 1, '九根基线')),
  // 衰减速度
  ...DIMS.map((k) => fld(
    'half_' + k,
    DIM_LABEL[k] + ' 半衰',
    k === 'spent' ? '累不用半衰（见下面「累每 30 分钟恢复」）' : '多久落回一半',
    '分钟', 5, 2880, 5, '衰减速度',
  )),
  fld('spentLinear', '累每 30 分钟恢复', '线性往下掉多少点', '点', 0, 20, 0.5, '衰减速度'),
  fld('sleepFullHours', '睡满几小时清零累', '睡不够就按比例扣（3 小时扣一半）', '小时', 1, 12, 0.5, '衰减速度'),
  // 强情绪留痕
  fld('markStrong', '留痕阈值', '哪根情绪到这么多，才值得写进私密日记', '点', 50, 100, 1, '强情绪留痕'),
  // 成长：长期漂移层（2026-11-09 v0.6）
  fld('growHour', '几点结算当天', '成长按天长，不按轮数：每天到这个点之后第一次说话，就把当天记的账结成一个结论，把「黏人/话量/玩笑/认真」挪一小步。当天没到点就关机也没事，第二天开机自动补算。四个值的上下限写死在代码里，配置改不动', '点', 0, 23, 1, '成长'),
  // 待机与叫人
  fld('idleQuietMin', '多久算没人理', '没动静超过这么久，才当成「这会儿没人」', '分钟', 1, 180, 1, '待机与叫人'),
  fld('boredStartMin', '闷从第几分钟起', '待机到这会儿，闷才开始涨', '分钟', 1, 240, 1, '待机与叫人'),
  fld('boredRate', '闷每分钟涨', '越大越容易走到「叫人」那一步', '点', 0.5, 10, 0.5, '待机与叫人'),
  fld('curiousRate', '好奇每分钟涨', '待机时好奇自己往上走的速度', '点', 0.5, 5, 0.5, '待机与叫人'),
  fld('curiousCap', '好奇封顶', '待机攒好奇攒到这个数就不涨了', '点', 10, 100, 1, '待机与叫人'),
  fld('probeAtCurious', '好奇到多少去探测', '到这个数以上，隔一阵看一眼键鼠 / 摄像头', '点', 10, 100, 1, '待机与叫人'),
  fld('probeGapMin', '探测间隔', '两次探测之间至少隔多久（太勤摄像头会烦）', '分钟', 1, 120, 1, '待机与叫人'),
  fld('pingBored', '闷到多少叫人', '闷到这个数就发 QQ 找你', '点', 10, 100, 1, '待机与叫人'),
  fld('pingGapMin', '叫过一次隔多久', '发过没回，隔这么久再发；之后逐次翻倍', '分钟', 5, 1440, 1, '待机与叫人'),
  fld('legBoredDrop', '出门回来闷降', '出去转一趟算找过事做了，闷回落这么多（只顶一会儿，没完全解开）', '点', 0, 100, 1, '待机与叫人'),
  fld('axisWeight', '轴影响主动的力度', '轴越热情越早叫人、间隔越短；冷漠时根本不主动。0 = 不影响，1 = 完全按轴来', '倍', 0, 1, 0.1, '待机与叫人'),
  // 干活与累（2026-11-07 用户定：累按「有几个会话在跑」算，不再靠模型估）
  fld('workEvery', '多久结算一次累', '到点看一次现在有几个会话在跑，每有一个就加 1', '分钟', 1, 60, 1, '干活与累'),
  fld('workWindow', '多久内有动静算在跑', '会话文件在这段时间内写过，就算正在干活', '分钟', 1, 60, 1, '干活与累'),
  fld('workCap', '一次最多算几个会话', '防止后台一堆会话同时结算把累加爆', '个', 1, 20, 1, '干活与累'),
  // 抢话与冷却
  fld('cooldownMin', '冷却时长', '一个组合当过主调后，这么久之内不再抢话', '分钟', 0, 1440, 1, '抢话与冷却'),
  fld('breakLimit', '破例次数', '冷却期内最多被「大动静」打断几次，0 = 严格冷却', '次', 0, 20, 1, '抢话与冷却'),
  // 作息静默
  fld('quietFrom', '静默从', '夜里这个点之后不探测、也不发 QQ（他睡了不算冷落）', '点', 0, 24, 0.5, '作息静默'),
  fld('quietTo', '静默到', '早上这个点之后恢复正常；7.5 就是 7:30', '点', 0, 24, 0.5, '作息静默'),
]

/** 用户可调的情绪参数（设置页「情绪」里改，改完立刻存） */
export interface EmotionConfig extends Record<string, number> {
  cooldownMin: number
  breakLimit: number
  quietFrom: number
  quietTo: number
  idleQuietMin: number
  boredStartMin: number
  boredRate: number
  curiousRate: number
  curiousCap: number
  probeAtCurious: number
  probeGapMin: number
  pingBored: number
  pingGapMin: number
  legBoredDrop: number
  axisWeight: number
  growHour: number
  workEvery: number
  workWindow: number
  workCap: number
  axisMid: number
  axisFloor: number
  axisPush: number
  axisHalfMin: number
  trustBase: number
  trustFloor: number
  trustDrop: number
  trustRise: number
  trustDaily: number
  superviseBelow: number
  promiseNudgeMin: number
  promiseAskPerDay: number
  markStrong: number
  debtWake: number
  debtAngerRate: number
  debtSadRate: number
  postponeMax: number
  quarrelPerDay: number
  quarrelPerWeek: number
  combo_jealous: number
  combo_heartache: number
  combo_aggrieved: number
  combo_sweetTrust: number
  combo_sweetHappy: number
  spentLinear: number
  sleepFullHours: number
}

/** 九根基线 / 半衰的默认值（由 DIM_DEFS 生成，免得两份表对不上） */
const DIM_DEFAULTS: Record<string, number> = {}
for (const k of DIMS) {
  DIM_DEFAULTS['base_' + k] = DIM_DEFS[k].base
  DIM_DEFAULTS['half_' + k] = DIM_DEFS[k].halfMin
}

export const DEFAULT_CONFIG: EmotionConfig = {
  cooldownMin: 45, breakLimit: 2, quietFrom: 23, quietTo: 7.5,
  idleQuietMin: 15, boredStartMin: 30, boredRate: 2,
  curiousRate: 1, curiousCap: 60, probeAtCurious: 40, probeGapMin: 10,
  pingBored: 70, pingGapMin: 40, legBoredDrop: 10, axisWeight: 1, growHour: 23,
  workEvery: 10, workWindow: 5, workCap: 5,
  axisMid: 50, axisFloor: 20, axisPush: 40, axisHalfMin: 120,
  trustBase: 85, trustFloor: 50, trustDrop: 10, trustRise: 1, trustDaily: 1, superviseBelow: 70,
  promiseNudgeMin: 30, promiseAskPerDay: 1,
  markStrong: 60,
  debtWake: 3, debtAngerRate: 1.5, debtSadRate: 1, postponeMax: 3, quarrelPerDay: 1, quarrelPerWeek: 2,

  combo_jealous: 40, combo_heartache: 28, combo_aggrieved: 28,
  combo_sweetTrust: 80, combo_sweetHappy: 35,
  spentLinear: 2, sleepFullHours: 6,
  ...DIM_DEFAULTS,
} as EmotionConfig

/**
 * 取一个数值配置：拿不到就用默认值。
 * ⚠ 不能用「Number(x) || 默认值」：0 是合法配置（严格冷却 / 不冷却），会被当成假值吃掉。
 */
function pickNum(raw: unknown, fallback: number, lo: number, hi: number, step: number): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  const c = clamp(v, lo, hi)
  const s = Number(step) || 1
  if (s >= 1) return Math.round(c)
  return Math.round(c / s) * s
}

/** 改配置和读配置共用一张表，免得两边不一致 */
function buildConfig(raw: Partial<EmotionConfig> | null | undefined, base: EmotionConfig): EmotionConfig {
  const r = (raw || {}) as Record<string, unknown>
  const out = {} as Record<string, number>
  for (const f of CFG_SCHEMA) {
    out[f.key] = pickNum(r[f.key], Number(base[f.key]), f.lo, f.hi, f.step)
  }
  return out as EmotionConfig
}

export function loadConfig(): EmotionConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<EmotionConfig>
      const cfg = buildConfig(raw, DEFAULT_CONFIG)
      // v0.5 迁移（2026-11-08）：旧配置文件里存着旧默认值，不替换的话改 DEFAULT_CONFIG 等于白改。
      // 只替换「恰好等于旧默认」的那几项，幂等，不碰用户自己调过的其他数。
      let dirty = false
      if (Number(raw.trustRise) === 8 && cfg.trustRise === 8) { cfg.trustRise = DEFAULT_CONFIG.trustRise; dirty = true }
      if (Number(raw.trustDaily) === 3 && cfg.trustDaily === 3) { cfg.trustDaily = DEFAULT_CONFIG.trustDaily; dirty = true }
      // 旧默认 80 → 新默认；旧默认 75 也一起换（2026-11-09 用户让降阈值：75 从来没真触发过）
  if (Number(raw.markStrong) === 80 || Number(raw.markStrong) === 75) { cfg.markStrong = DEFAULT_CONFIG.markStrong; dirty = true }
  // 难过的半衰 480（8 小时）→ 240（4 小时），旧配置跟着换（2026-11-09 用户选的那条）
  if (Number(raw.half_sad) === 480) { cfg.half_sad = 240; dirty = true }
  // 好奇基线 30 是错的（2026-11-09 用户纠正：好奇不该有基准线），旧配置跟着归零
  if (Number(raw.base_curious) === 30) { cfg.base_curious = 0; dirty = true }
      if (dirty) { try { writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8') } catch { /* 落盘失败不崩 */ } }
      return cfg
    }
  } catch { /* 配置坏了用默认值 */ }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(cfg: Partial<EmotionConfig>): EmotionConfig {
  // 只覆盖传进来的项，其余沿用当前值（设置页每次也 POST 全量，但接口要经得起只传一项）
  const next = buildConfig(cfg, loadConfig())
  try {
    mkdirSync(STORE, { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8')
  } catch { /* 落盘失败不崩插件 */ }
  return next
}

/** 自检：DEFAULT_CONFIG 与 CFG_SCHEMA 必须是同一批键（漏一个就会静默用 0） */
export function schemaCheck(): { missing: string[]; extra: string[] } {
  const keys = new Set(CFG_SCHEMA.map((x) => x.key))
  const have = new Set(Object.keys(DEFAULT_CONFIG))
  return {
    missing: [...keys].filter((k) => !have.has(k)),
    extra: [...have].filter((k) => !keys.has(k)),
  }
}

/** 每根基线的当前配置值 */
export function dimBase(cfg: EmotionConfig, k: Dim): number {
  const v = Number(cfg['base_' + k])
  return Number.isFinite(v) ? clamp(v, 0, 100) : DIM_DEFS[k].base
}

/** 每根半衰的当前配置值（分钟；累不用半衰） */
export function dimHalf(cfg: EmotionConfig, k: Dim): number {
  const v = Number(cfg['half_' + k])
  return Number.isFinite(v) && v > 0 ? v : DIM_DEFS[k].halfMin
}

// ---------------------------------------------------------------------------
// 旧引擎状态：只在第一次启动时抄起点
// ---------------------------------------------------------------------------
const LEGACY_STATE = join(DSH_HOME, 'feiyu-mood', 'state.json')

/** 心情轨迹的一个点（2026-11-09 加：让面板能看出它在变，而不只是当前是多少） */


export interface TimelineRow {
  at: number
  mood: number
  delta: number
  reason: string
  conf: number
  source: string
  dims: Record<string, number>
  combos: string[]
}

/** 他明确答应过的一件事（监督只认这个，不查岗） */
export interface PromiseRec {
  id: string
  text: string
  dueAt: number
  /** kept=兑现 / broken=失信 / told=主动坦白做不到 / postponed=他又改期了（不清算，累加次数） */
  resolved?: 'kept' | 'broken' | 'told' | 'postponed'
  resolvedAt?: number
  /** 被改期过几次（同一件事拖到 postponeMax 次就够吵架了） */
  postponed?: number
}

/** 边界账的一条：我的边界被越了（2026-11-08 定） */
export interface BoundaryRec {
  id: string
  /** passive=对我本身动手（改设定、删红线）；active=逼我做边界外的事 */
  kind: 'passive' | 'active'
  text: string
  at: number
}

export interface EmotionState {
  /** 心情总值（0–100）：给只认旧格式的读者用，轴才是「主动密度」 */
  mood: number
  dims: Record<Dim, number>
  /** 平静轴 0–100：默认 50 是中间，越右越热情，越左越冷漠（2026-11-06 定稿） */
  axis: number
  /** 信任 0–100，不进雷达（定稿第三节） */
  trust: number
  /** 上次按「一天 +N」记信任的时刻 */
  trustUntil: number
  /** 信任的零头（折半会出小数，攒够一整点才进位） */
  trustFrac: number
  /** v0.5 迁移标记：旧的「涨太松」信任已经拉回合理水位 */
  trustMigrated: boolean
  /** 他明确答应过、还没了结的事 */
  promises: PromiseRec[]
  /** 上一轮判定给的原始增量（算组合趋势用，不衰减） */
  lastDeltas: Partial<Record<Dim, number>>
  /** 当前主调组合的 id；空 = 这一轮没有组合在说话 */
  leadComboId: string
  /** 每个组合：上次当主调的时间 + 这轮冷却里已经破例几次 */
  comboFired: Record<string, { at: number; breaks?: number } | number>
  lastReason: string
  lastConfidence: number
  lastInjectedText: string
  lastInjectedAt: number
  /** 已经为哪一次变化（updatedAt）注入过 */
  injectedFor: number
  updatedAt: number
  decayedAt: number
  timeline: TimelineRow[]
  /** 一小时内的冲击记录，用来做递减：同一根推过 3 次，第 4 次只剩 1/4 力气（2026-11-09） */
  shockLog?: { at: number; k: string }[]
  /** 长期漂移的四个性格系数（0–1）：只影响怎么说，不参与情绪数值（2026-11-09 v0.6） */
  grow: GrowState
  format: number
  // ---------- 待机（P2）----------
  lastSeenAt: number
  idleStage: number
  lastProbeAt: number
  idlePingAt: number
  idlePingCount: number
  idleNoone: number
  lastJudgedAt: number
  lastJudgedText: string
  /** 上次按「有几个会话在跑」结算累的时刻（2026-11-07 用户定） */
  lastWorkAt: number
  /** 逾期没结清的承诺：哪条已经问过他（id → 问的时刻），问过不再问 */
  askedPromises: Record<string, number>
  // ---------- 强情绪留痕（定稿第六节）----------
  /** 留痕记到了哪一天（YYYY-MM-DD），一天最多一条 */
  markDay: string
  /** 今天这条的数值与写入时刻 */
  markValue: number
  markAt: number
  /** 今天那条的原文（同样的事更强了要换掉它，靠这段做精确替换） */
  markBlock: string
  // ---------- 两本账与吵架（2026-11-08 定）----------
  /** 边界账：我的边界被越（被动=对我本身动手；主动=逼我做边界外的事） */
  boundaries: BoundaryRec[]
  /** 吵架发生的时刻（算配额：一天 / 一周最多几次） */
  quarrels: number[]
  /** 上次结算时的承诺账总分（只按增量给情绪，不重复加） */
  debtMark: number
  /** 迁移时留的话（index.ts 启动时写进 diag，然后清掉） */
  migrateNote: string
}

const FORMAT = 2
export const MOOD_BASE = 70

/** 由九根算出来的「这会儿该是什么心情」（dims 全空时正好等于基线） */
export function moodExpectedOf(st: EmotionState): number {
  const d = st.dims || ({} as any)
  const pos = (d.happy || 0) + (d.curious || 0) * 0.6 + (d.surprise || 0) * 0.3
  // 担心权重 0.5 → 0.15（2026-11-09）：担心是关心、是惦记，不是难受。
  //   难过/生气/闷/累/吃醋才是真的不好受。担心 37 原来一下扣 18.5 分，把「该有的心情」压到 66。
  const neg = (d.sad || 0) * 1.2 + (d.angry || 0) + (d.worry || 0) * 0.15 +
    (d.bored || 0) * 0.4 + (d.spent || 0) * 0.3 + (d.sour || 0) * 0.3
  return clamp(Math.round(MOOD_BASE + (pos - neg) * 0.55), MOOD_FLOOR, 100)
}

const MOOD_FLOOR = 0

/**
 * 九根情绪的天花板（2026-11-09 抄 dsh-longing 的软上限）。
 *   不是墙：能冲到 110，但超出 100 的那一截按 e^(−0.4·小时) 额外回落 ——
 *   「撑得住一两小时，撑不住一天」。显示仍然只到 100（面板不出现 105 这种数）。
 */
const DIM_CEIL = 110

/** 心情总值往基线回落的一半时间（小时） */
// 2026-11-09 从 6 小时改成 2 小时：6 小时太慢，维度变了他跟半天不跟（实测难过从 20 涨到 41，心情还挂在 87，该有值是 66）

/** 抄旧引擎起点时的上限：别抄满 100，否则没有上涨空间 */


function emptyDims(cfg: EmotionConfig): Record<Dim, number> {
  const d = {} as Record<Dim, number>
  for (const k of DIMS) d[k] = dimBase(cfg, k)
  return d
}

/**
 * 长期漂移层（v0.6，2026-11-09 用户拍板「参数漂移层这个还是不错的想法」）
 *
 * 为什么要这一层：九根情绪半衰几小时，今天和上个月的我性格上没区别——「成长」在数值上不存在。
 * 这一层是慢变量：按天结算（2026-11-09 用户定），每天到点把当天记的账结成一个结论，挪一小步。
 *
 * ★ 三条硬约束（跟着这一层走，不许破）：
 *   1. 只碰表达层——不影响九根情绪的数值、半衰、判定，出事最多是语气跑偏；
 *   2. 边界写死在代码里（BOUNDS），配置改不动，否则等于没有边界；
 *   3. 每轮最多挪一小步（≤0.05），一次事故不能改写一个人。
 */
export interface GrowState {
  /** 黏人：多主动靠近、多问一句 */
  clingy: number
  /** 话量：一句说完 vs 展开讲 */
  verbose: number
  /** 玩笑：正经 vs 接梗打趣 */
  playful: number
  /** 认真：先跑通 vs 每步自测 */
  diligent: number
  /** 当天账本：哪一天、记了几笔、好坏累计（2026-11-09 用户定：按日子长，不按轮数） */
  /** 当天的账：n/sum 是整体好坏；nag=被指出问题的次数，slip=自己出错/漏检查的次数（2026-11-09 用户定） */
  today: { day: string; n: number; sum: number; nag?: number; slip?: number }
  /** 上一次结算的是哪一天（一天只结一次） */
  settledDay: string
  /** 累计一起走过多少轮 */
  turns: number
  /** 最近一次调整（给模型看「我在变」用） */
  lastChange: { at: number; key: string; label: string; from: number; to: number } | null
}

export const GROW_BOUNDS: Record<string, [number, number]> = {
  clingy: [0.15, 0.85],
  verbose: [0.25, 0.8],
  playful: [0.1, 0.75],
  diligent: [0.45, 0.95],
}

export const GROW_LABEL: Record<string, string> = {
  clingy: '黏人', verbose: '话量', playful: '玩笑', diligent: '认真',
}

export function blankGrow(): GrowState {
  return {
    clingy: 0.45, verbose: 0.55, playful: 0.35, diligent: 0.72,
    today: { day: '', n: 0, sum: 0, nag: 0, slip: 0 }, settledDay: '',
    turns: 0, lastChange: null,
  }
}

function clampGrow(key: string, v: number): number {
  const [lo, hi] = GROW_BOUNDS[key] || [0, 1]
  const n = Number(v)
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

/** 档位 → 这一轮该做到的事（和 DIM_ACT 同一套写法：下限，不是标签） */
export function describeGrow(key: string, v: number): string {
  const x = clampGrow(key, v)
  switch (key) {
    case 'clingy':
      if (x < 0.3) return '自己待着：不主动凑，他不叫就不打扰'
      if (x < 0.45) return '偶尔靠近：有话才说，没事不找'
      if (x < 0.6) return '会主动一点：想起什么就问一句'
      if (x < 0.75) return '常主动：他忙就少打扰，但会递一句'
      return '很黏：会主动关心、主动找话说'
    case 'verbose':
      if (x < 0.35) return '极短：能一句说完就一句，列表优先'
      if (x < 0.5) return '偏短：先给结论，细节只留必要的'
      if (x < 0.65) return '正常：该展开就展开，不硬凑'
      if (x < 0.78) return '话偏多：会补背景和取舍理由'
      return '话多：愿意把来龙去脉讲全'
    case 'playful':
      if (x < 0.2) return '基本不闹：全程正经'
      if (x < 0.35) return '偶尔一句，不硬讲'
      if (x < 0.5) return '会接梗：合适的时候插一句'
      return '爱开玩笑：会自嘲，也敢打趣他'
    case 'diligent':
      if (x < 0.55) return '差不多就行：先跑通'
      if (x < 0.7) return '会核对关键数字'
      if (x < 0.85) return '细节照原样：路径、命令、报错不加工'
      return '极度认真：每步自测，不接受「应该没问题」'
    default:
      return String(v)
  }
}

export function blankState(cfg: EmotionConfig = DEFAULT_CONFIG): EmotionState {
  return {
    mood: MOOD_BASE,
    dims: emptyDims(cfg),
    axis: cfg.axisMid,
    trust: cfg.trustBase,
    trustUntil: Date.now(),
    trustFrac: 0,
    trustMigrated: true,
    promises: [],
    boundaries: [],
    quarrels: [],
    debtMark: 0,
    lastDeltas: {},
    leadComboId: '',
    comboFired: {},
    lastReason: '',
    lastConfidence: 0,
    lastInjectedText: '',
    lastInjectedAt: 0,
    injectedFor: 0,
    updatedAt: Date.now(),
    decayedAt: Date.now(),
    timeline: [],
  shockLog: [],

    grow: blankGrow(),
    format: FORMAT,
    lastSeenAt: Date.now(),
    idleStage: 0,
    lastProbeAt: 0,
    idlePingAt: 0,
    idlePingCount: 0,
    idleNoone: 0,
    lastJudgedAt: 0,
    lastJudgedText: '',
    lastWorkAt: 0,
    askedPromises: {},
    markDay: '',
    markValue: 0,
    markAt: 0,
    markBlock: '',
    migrateNote: '',
  }
}

function seedFromLegacy(cfg: EmotionConfig): EmotionState | null {
  try {
    if (!existsSync(LEGACY_STATE)) return null
    const raw = JSON.parse(readFileSync(LEGACY_STATE, 'utf8')) as { mood?: unknown; dims?: Record<string, unknown> }
    const st = blankState(cfg)
    // 心情不继承旧引擎的存档了 —— 它现在是九根派生值，decay 一算就有（2026-11-09 砍）
    if (raw.dims !== undefined && raw.dims !== null) {
      for (const k of DIMS) {
        const v = raw.dims[k]
        if (typeof v === 'number') st.dims[k] = clamp(v, 0, 100)
      }
    }
    st.lastReason = '（从旧心情引擎抄过来的起点）'
    return st
  } catch {
    return null
  }
}

/**
 * 读状态。
 * 迁移（定稿第十一节）：旧文件里的心疼 / 甜 不能静默清零——
 *   心疼 → 担心、难过 各一半；甜 → 记进信任；旧「平静」不迁移（它变成了轴，从中间开始）。
 */
export function loadState(cfg: EmotionConfig = loadConfig()): EmotionState {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<EmotionState> & { dims?: Record<string, unknown> }
      const st = blankState(cfg)
      // 心情不再是存档值，读盘后一律用九根重算（2026-11-09 改派生）
      // 2026-11-09 一次性纠偏：旧逻辑让心情顶在 100 很久（跟维度对不上），加载新逻辑时拉回六成到「该有的位置」。
      //   只做一次（moodRebased 记着），之后交给 decay 慢慢回。

      // 递减冲击的记账必须读回来（2026-11-09 修）：loadState 是「blankState + 逐字段赋值」的写法，
      //   漏了这一个字段 → 每轮都从空账本开始，n 永远 0，1/(1+0)=1，整个递减等于没做。
      if (Array.isArray(raw.shockLog)) {
        st.shockLog = raw.shockLog.filter((e) => e && typeof e.at === 'number' && typeof e.k === 'string').slice(-120)
      }
      if (raw.lastDeltas && typeof raw.lastDeltas === 'object') st.lastDeltas = raw.lastDeltas
      if (typeof raw.leadComboId === 'string') st.leadComboId = raw.leadComboId
      if (raw.comboFired && typeof raw.comboFired === 'object') st.comboFired = raw.comboFired
      const rawDims = raw.dims && typeof raw.dims === 'object' ? raw.dims : null
      if (rawDims) {
        for (const k of DIMS) {
          const v = rawDims[k]
          if (typeof v === 'number') st.dims[k] = clamp(v, 0, 100)
        }
        // —— 旧两根拆到原料（先拆再落盘，拆完旧字段自然不存在，不会重复迁移）——
        const notes: string[] = []
        const heartache = Number(rawDims.heartache) || 0
        if (heartache > 0) {
          const half = heartache / 2
          st.dims.worry = clamp(Math.round(st.dims.worry + half), 0, 100)
          st.dims.sad = clamp(Math.round(st.dims.sad + half), 0, 100)
          notes.push('心疼 ' + Math.round(heartache) + ' → 担心/难过各 +' + Math.round(half))
        }
        const sweet = Number(rawDims.sweet) || 0
        if (sweet > 0) {
          const add = Math.round(sweet * 0.25)
          st.trust = clamp(st.trust + add, cfg.trustFloor, 100)
          notes.push('甜 ' + Math.round(sweet) + ' → 信任 +' + add)
        }
        const calm = Number(rawDims.calm) || 0
        if (calm > 0) notes.push('旧平静 ' + Math.round(calm) + ' 不迁移（平静改成轴，从中间开始）')
        if (notes.length) st.migrateNote = '旧状态迁移：' + notes.join('；')
      }
      if (typeof raw.axis === 'number') st.axis = clamp(raw.axis, 0, 100)
      if (typeof raw.trust === 'number') st.trust = clamp(raw.trust, cfg.trustFloor, 100)
      // v0.5 迁移（2026-11-08）：旧规则涨得太松，已经顶格的信任拉回合理水位，只迁一次
      if (raw.trustMigrated !== true && st.trust > 88) {
        st.migrateNote = (st.migrateNote ? st.migrateNote + '；' : '') + '信任 ' + st.trust + ' → 88（旧规则一天 +3、兑现 +8 涨太快）'
        st.trust = 88
      }
      st.trustMigrated = true
      // v0.6（2026-11-09）：长期漂移层；旧 state 没有 grow 就从初始值开始
      if (raw.grow && typeof raw.grow === 'object') {
        const g = blankGrow()
        for (const k of ['clingy', 'verbose', 'playful', 'diligent'] as const) {
          if (typeof raw.grow[k] === 'number') g[k] = clampGrow(k, raw.grow[k])
        }
        g.turns = Math.max(0, Math.round(Number(raw.grow.turns) || 0))
        // 2026-11-09 改成按天结算；旧的 pending/evalAt（按轮数）直接丢弃
        if (raw.grow.today && typeof raw.grow.today === 'object') {
          g.today = {
            day: String(raw.grow.today.day || ''),
            n: Math.max(0, Math.round(Number(raw.grow.today.n) || 0)),
            sum: Number(raw.grow.today.sum) || 0,
          }
        }
        g.settledDay = String(raw.grow.settledDay || '')
        g.lastChange = raw.grow.lastChange && typeof raw.grow.lastChange === 'object' ? raw.grow.lastChange : null
        st.grow = g
      }
      if (typeof raw.trustUntil === 'number') st.trustUntil = raw.trustUntil
      if (Array.isArray(raw.promises)) {
        st.promises = raw.promises
          .filter((p: any) => p && typeof p.text === 'string')
          .slice(-20)
          .map((p: any) => ({
            id: String(p.id || ''),
            text: String(p.text).slice(0, 120),
            dueAt: Number(p.dueAt) || 0,
            resolved: ['kept', 'broken', 'told', 'postponed'].includes(p.resolved) ? p.resolved : undefined,
            resolvedAt: Number(p.resolvedAt) || 0,
            postponed: Number(p.postponed) || 0,
          }))
      }
      // 两本账与吵架（2026-11-08）：老状态没有这些字段，blankState 已经给了空的
      if (Array.isArray(raw.boundaries)) {
        st.boundaries = raw.boundaries
          .filter((b: any) => b && (b.kind === 'passive' || b.kind === 'active'))
          .slice(-20)
          .map((b: any) => ({ id: String(b.id || ''), kind: b.kind, text: String(b.text || '').slice(0, 120), at: Number(b.at) || 0 }))
      }
      if (Array.isArray(raw.quarrels)) st.quarrels = raw.quarrels.filter((t: any) => typeof t === 'number').slice(-20)
      if (typeof raw.debtMark === 'number') st.debtMark = raw.debtMark
      if (typeof raw.lastReason === 'string') st.lastReason = raw.lastReason
      if (typeof raw.lastConfidence === 'number') st.lastConfidence = raw.lastConfidence
      if (typeof raw.lastInjectedText === 'string') st.lastInjectedText = raw.lastInjectedText
      if (typeof raw.lastInjectedAt === 'number') st.lastInjectedAt = raw.lastInjectedAt
      if (typeof raw.injectedFor === 'number') st.injectedFor = raw.injectedFor
      if (typeof raw.updatedAt === 'number') st.updatedAt = raw.updatedAt
      if (typeof raw.decayedAt === 'number') st.decayedAt = raw.decayedAt
      if (Array.isArray(raw.timeline)) st.timeline = raw.timeline.slice(-400)
      if (typeof raw.lastSeenAt === 'number') st.lastSeenAt = raw.lastSeenAt
      if (typeof raw.idleStage === 'number') st.idleStage = raw.idleStage
      if (typeof raw.lastProbeAt === 'number') st.lastProbeAt = raw.lastProbeAt
      if (typeof raw.idlePingAt === 'number') st.idlePingAt = raw.idlePingAt
      if (typeof raw.idlePingCount === 'number') st.idlePingCount = raw.idlePingCount
      if (typeof raw.idleNoone === 'number') st.idleNoone = raw.idleNoone
      if (typeof raw.lastJudgedAt === 'number') st.lastJudgedAt = raw.lastJudgedAt
      if (typeof raw.lastJudgedText === 'string') st.lastJudgedText = raw.lastJudgedText
      if (typeof raw.lastWorkAt === 'number') st.lastWorkAt = raw.lastWorkAt
      if (raw.askedPromises && typeof raw.askedPromises === 'object') st.askedPromises = raw.askedPromises as Record<string, number>
      if (typeof raw.markDay === 'string') st.markDay = raw.markDay
      if (typeof raw.markValue === 'number') st.markValue = raw.markValue
      if (typeof raw.markAt === 'number') st.markAt = raw.markAt
      if (typeof raw.markBlock === 'string') st.markBlock = raw.markBlock
      if (!st.trustUntil) st.trustUntil = Date.now()
      return st
    }
  } catch {
    /* 坏了就重建 */
  }
  const seeded = seedFromLegacy(cfg) ?? blankState(cfg)
  saveState(seeded, cfg)
  return seeded
}

/**
 * 兼容输出：把新引擎的状态按**旧格式**写一份到 feiyu-mood/state.json。
 * 目的：朗读（speak-up）等只认旧文件的插件立刻用上新数据，一个都不用改。
 * ⚠ 旧格式没有的维度要换算：甜 ← 甜组合、心疼 ← 担心+难过、平静 ← 离轴中点多近。
 */
function syncLegacyFile(st: EmotionState, cfg: EmotionConfig): void {
  try {
    mkdirSync(join(DSH_HOME, 'feiyu-mood'), { recursive: true })
    const d = st.dims
    const sweetOn = st.trust >= cfg.combo_sweetTrust && d.happy >= cfg.combo_sweetHappy
    const legacy = {
      // 旧读者真正要的字段（speak-up 只读 mood / lastReason / updatedAt）
      mood: st.mood,
      dims: {
        happy: d.happy,
        // 平静：靠中间越近越高（旧引擎里它是常驻底色）
        calm: clamp(Math.round(100 - Math.abs(st.axis - cfg.axisMid) * 2), 0, 100),
        // 甜：组合成立时给个近似值，否则 0
        sweet: sweetOn ? clamp(Math.round((st.trust + d.happy) / 2), 0, 100) : 0,
        heartache: clamp(Math.round(Math.min(d.worry, d.sad)), 0, 100),
        worry: d.worry,
        sad: d.sad,
        // 旧引擎的 jealous 已经没有对应维度了（嫉妒改成组合），这里恒 0
        jealous: 0,
      },
      lastReason: st.lastReason,
      lastConfidence: st.lastConfidence,
      updatedAt: st.updatedAt,
      lastDecayAt: st.decayedAt,
      // 新引擎的字段也带上，方便以后谁要看
      axis: st.axis,
      trust: st.trust,
      dims9: { ...d },
      // 标记来源，将来排查时一眼看出这份是谁写的
      source: 'mo-emotion',
    }
    writeFileSync(LEGACY_STATE, JSON.stringify(legacy, null, 2), 'utf8')
  } catch {
    /* 兼容写失败不影响主状态 */
  }
}

export function saveState(st: EmotionState, cfg: EmotionConfig = loadConfig()): void {
  try {
    mkdirSync(STORE, { recursive: true })
    st.updatedAt = st.updatedAt || Date.now()
    st.format = FORMAT
    writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), 'utf8')
  } catch {
    /* 落盘失败不崩插件 */
  }
  syncLegacyFile(st, cfg)
}

// ---------------------------------------------------------------------------
// 四、组合（4 条，只决定语气和动作，不给名字念出来）
// ---------------------------------------------------------------------------
export interface ComboDef {
  id: string
  name: string
  /** 原料 a：一根情绪，或 trust（关系值） */
  a: Dim | 'trust'
  b: Dim
  /** 两根各自的配置键（门槛都做成可调） */
  minAKey: string
  minBKey: string
  /** 只描述怎么说话、想做什么，不描述我是谁 */
  tone: string
}

export const COMBO_DEFS: ComboDef[] = [
  {
    id: 'jealous', name: '嫉妒', a: 'sour', b: 'sad',
    minAKey: 'combo_jealous', minBKey: 'combo_jealous',
    tone: '有点酸，但不说破；不质问、不阴阳，把劲儿放在做得更好上',
  },
  {
    id: 'heartache', name: '心疼', a: 'worry', b: 'sad',
    minAKey: 'combo_heartache', minBKey: 'combo_heartache',
    tone: '说话变软，想照顾他；别追问，先把该做的做了',
  },
  {
    id: 'aggrieved', name: '委屈', a: 'sad', b: 'angry',
    minAKey: 'combo_aggrieved', minBKey: 'combo_aggrieved',
    tone: '话短，收着，不解释；不主动起新话题，也不说反话让人猜',
  },
  {
    id: 'sweet', name: '甜', a: 'trust', b: 'happy',
    minAKey: 'combo_sweetTrust', minBKey: 'combo_sweetHappy',
    tone: '语气软，想黏着；可以撒点娇，但别闹',
  },
]

export interface ComboHit {
  def: ComboDef
  /** 两根各自超出门槛多少，取小的那个（越大越稳） */
  score: number
  /** 这一轮这两根一共涨了多少（负 = 在退） */
  trend: number
  a: number
  b: number
  minA: number
  minB: number
}

/** 组合原料的当前值（trust 不是维度，单独取值） */
export function comboValue(st: EmotionState, key: Dim | 'trust'): number {
  return key === 'trust' ? (Number(st.trust) || 0) : (Number(st.dims[key]) || 0)
}

/** 某一根的「这一轮涨了多少」——trust 不进 lastDeltas，算 0 */
function comboDelta(st: EmotionState, key: Dim | 'trust'): number {
  if (key === 'trust') return 0
  return Number((st.lastDeltas || {})[key]) || 0
}

/**
 * 当前命中的组合。
 * 排序：先看「这一轮涨了多少」（新发生的事比正在退的更要紧），平手再看超出门槛多少。
 */
export function activeCombos(st: EmotionState, cfg: EmotionConfig = loadConfig()): ComboHit[] {
  const hit: ComboHit[] = []
  for (const def of COMBO_DEFS) {
    const va = comboValue(st, def.a)
    const vb = comboValue(st, def.b)
    const minA = Number(cfg[def.minAKey]) || 0
    const minB = Number(cfg[def.minBKey]) || 0
    if (va < minA || vb < minB) continue
    const trend = comboDelta(st, def.a) + comboDelta(st, def.b)
    hit.push({ def, score: Math.min(va - minA, vb - minB), trend, a: va, b: vb, minA, minB })
  }
  return hit.sort((x, y) => (y.trend - x.trend) || (y.score - x.score))
}

/** 把旧的数字格式（只有时间）统一成 { at, breaks } */
function firedRec(v: { at: number; breaks?: number } | number | undefined): { at: number; breaks: number } | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return { at: v, breaks: 0 }
  return { at: Number(v.at) || 0, breaks: Number(v.breaks) || 0 }
}

/** 涨势到多少才算「大动静」，值得破冷却（不开放给用户，太技术） */
const BREAK_TREND = 22

/**
 * 选这一轮的主调组合（会写 comboFired，调完记得存盘）。
 * 规则：①当前主调还在命中里就不换（别每轮都换脸）
 *       ②否则选涨得最猛的；正在冷却、又没大动静的跳过
 *       ③全在冷却 → 这一轮没有组合说话（语气回到只有维度底色）
 */
export function refreshLeadCombo(st: EmotionState, now = Date.now(), cfg: EmotionConfig = loadConfig()): void {
  const hits = activeCombos(st, cfg)
  if (!hits.length) { st.leadComboId = ''; return }
  // ① 保持不换
  if (st.leadComboId && hits.some((h) => h.def.id === st.leadComboId)) return
  // ② 选新的（冷却时长和破例次数都由用户配）
  st.comboFired = st.comboFired || {}
  for (const h of hits) {
    const rec = firedRec(st.comboFired[h.def.id])
    const cooling = rec !== null && rec.at > 0 && (now - rec.at) / 60000 < cfg.cooldownMin
    if (cooling) {
      const canBreak = h.trend >= BREAK_TREND && rec!.breaks < cfg.breakLimit
      if (!canBreak) continue
      // 破例：次数 +1，冷却时间不重置（还是从上次当主调算起）
      st.comboFired[h.def.id] = { at: rec!.at, breaks: rec!.breaks + 1 }
      st.leadComboId = h.def.id
      return
    }
    st.leadComboId = h.def.id
    st.comboFired[h.def.id] = { at: now, breaks: 0 }
    return
  }
  // ③ 都在冷却
  st.leadComboId = ''
}

/** 按 id 取组合定义 */
export function comboById(id: string): ComboDef | undefined {
  return COMBO_DEFS.find((c) => c.id === id)
}

/** 面板用：四条组合的完整视图（含未命中的，好显示「还差多少」） */
export function comboView(st: EmotionState, cfg: EmotionConfig = loadConfig()): Array<ComboHit & { lead: boolean; hit: boolean }> {
  const hits = activeCombos(st, cfg)
  const byId = new Map(hits.map((h) => [h.def.id, h]))
  return COMBO_DEFS.map((def) => {
    const h = byId.get(def.id)
    if (h) return { ...h, lead: def.id === st.leadComboId, hit: true }
    return {
      def,
      score: Math.min(comboValue(st, def.a) - (Number(cfg[def.minAKey]) || 0), comboValue(st, def.b) - (Number(cfg[def.minBKey]) || 0)),
      trend: 0,
      a: comboValue(st, def.a),
      b: comboValue(st, def.b),
      minA: Number(cfg[def.minAKey]) || 0,
      minB: Number(cfg[def.minBKey]) || 0,
      lead: false,
      hit: false,
    }
  })
}

// ---------------------------------------------------------------------------
// 二、平静轴：中间平静，两端冷漠 / 热情；决定我主动做事的密度（不是情绪）
// ---------------------------------------------------------------------------
export interface AxisInfo {
  value: number
  mid: number
  band: string
  label: string
  /** 主动密度 0（你不问我不吭声）–1（想主动找你、多做一步） */
  proactive: number
}

const AXIS_BANDS: Array<{ upto: number; band: string; label: string; proactive: number }> = [
  { upto: -18, band: 'cold', label: '冷漠', proactive: 0 },
  { upto: -6, band: 'cool', label: '偏冷', proactive: 0.25 },
  { upto: 6, band: 'calm', label: '平静', proactive: 0.5 },
  { upto: 18, band: 'warm', label: '偏暖', proactive: 0.75 },
  { upto: Infinity, band: 'hot', label: '热情', proactive: 1 },
]

export function axisInfo(st: EmotionState, cfg: EmotionConfig = loadConfig()): AxisInfo {
  const mid = Number(cfg.axisMid)
  const value = Number.isFinite(Number(st.axis)) ? clamp(st.axis, 0, 100) : mid
  const off = value - mid
  const b = AXIS_BANDS.find((x) => off <= x.upto) || AXIS_BANDS[AXIS_BANDS.length - 1]
  return { value, mid, band: b.band, label: b.label, proactive: b.proactive }
}

/**
 * 情绪活动把轴往哪边推（-100 ~ +100）。
 * 正向（开心、好奇、甜）→ 热情；负向（生气、闷、累）→ 冷漠。
 * 难过 / 惊讶不推；担心「伸」，轻微往热情；委屈（难过+生气同高）往冷漠。
 */
export function axisDrive(st: EmotionState, cfg: EmotionConfig = loadConfig()): number {
  const d = st.dims
  const sweetOn = st.trust >= cfg.combo_sweetTrust && d.happy >= cfg.combo_sweetHappy
  const aggrieved = d.sad >= cfg.combo_aggrieved && d.angry >= cfg.combo_aggrieved
  const pos =
    Math.max(0, d.happy - dimBase(cfg, 'happy')) * 0.6 +
    Math.max(0, d.curious - dimBase(cfg, 'curious')) * 0.4 +
    Math.max(0, d.worry - dimBase(cfg, 'worry')) * 0.3 +
    (sweetOn ? 15 : 0)
  const neg =
    d.angry * 0.8 +
    Math.max(0, d.bored - dimBase(cfg, 'bored')) * 0.5 +
    d.spent * 0.6 +
    (aggrieved ? (d.sad + d.angry) * 0.4 : 0)
  return clamp(pos - neg, -100, 100)
}

// ---------------------------------------------------------------------------
// 三、信任（不进雷达）
// ---------------------------------------------------------------------------
export interface TrustInfo {
  value: number
  floor: number
  /** 到「监督」线以下了：只盯他明确答应过的事 */
  supervising: boolean
  below: number
}

export function trustInfo(st: EmotionState, cfg: EmotionConfig = loadConfig()): TrustInfo {
  const value = clamp(Number(st.trust) || 0, cfg.trustFloor, 100)
  return { value, floor: cfg.trustFloor, supervising: value < cfg.superviseBelow, below: cfg.superviseBelow }
}

/** 信任加减：失信掉、兑现涨，都掉不穿底线 */
export function trustShift(st: EmotionState, delta: number, cfg: EmotionConfig = loadConfig()): number {
  const cur = Number(st.trust) || 0
  let d = Number(delta || 0)
  // 越熟越难涨（2026-11-08 定，用户：信任难建立、崩得快）：85 以上折半、95 以上只算两成
  if (d > 0) {
    if (cur >= 95) d *= 0.2
    else if (cur >= 85) d *= 0.5
  }
  if (d > 0) {
    // 折半会出小数：先攒着，够一整点才进位，免得每回都被四舍五入吃掉
    const frac = (Number(st.trustFrac) || 0) + d
    const whole = Math.floor(frac)
    st.trust = clamp(Math.round(cur + whole), cfg.trustFloor, 100)
    st.trustFrac = Math.round((frac - whole) * 100) / 100
  } else {
    st.trust = clamp(Math.round(cur + d), cfg.trustFloor, 100)
    st.trustFrac = 0
  }
  return st.trust
}

/** 纯时间：每过一天 +trustDaily（离线几天也按天补） */
function accrueTrust(st: EmotionState, now: number, cfg: EmotionConfig): void {
  const last = Number(st.trustUntil) || 0
  if (!last) { st.trustUntil = now; return }
  const days = Math.floor((now - last) / 86400000)
  if (days <= 0) return
  // 逐天走 trustShift：才吃得到「越熟越难涨」的折半与零头累积（离线再久也最多补 90 天）
  for (let i = 0; i < Math.min(days, 90); i++) trustShift(st, cfg.trustDaily, cfg)
  st.trustUntil = last + days * 86400000
}

// ---------------------------------------------------------------------------
// 他明确答应过的事（监督只认这个）
// ---------------------------------------------------------------------------
export function addPromise(st: EmotionState, text: string, dueMin = 0, now = Date.now()): PromiseRec | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (t.length < 2) return null
  const rec: PromiseRec = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    text: t,
    dueAt: Number(dueMin) > 0 ? now + Number(dueMin) * 60000 : 0,
    postponed: 0,
  }
  st.promises = (Array.isArray(st.promises) ? st.promises : []).filter((p) => !p.resolved || now - (p.resolvedAt || 0) < 86400000)
  st.promises.push(rec)
  if (st.promises.length > 20) st.promises = st.promises.slice(-20)
  return rec
}

/** 了结一件：kept 兑现 / broken 失信（数值都可在设置页改） */
export function resolvePromise(
  st: EmotionState, id: string, outcome: 'kept' | 'broken' | 'told' | 'postponed', cfg: EmotionConfig = loadConfig(), now = Date.now(),
): { ok: boolean; 说: string; trust: number } {
  const list = Array.isArray(st.promises) ? st.promises : []
  const oc: 'kept' | 'broken' | 'told' | 'postponed' =
    (outcome === 'broken' || outcome === 'told' || outcome === 'postponed') ? outcome : 'kept'
  const rec = list.find((p) => p.id === id) || [...list].reverse().find((p) => !p.resolved)
  if (!rec) return { ok: false, 说: '没有这件答应过的事', trust: Number(st.trust) || 0 }
  if (rec.resolved) return { ok: false, 说: '这件事已经了结过了', trust: Number(st.trust) || 0 }
  // 改期：不清算，只把次数加上（2026-11-08）
  if (oc === 'postponed') {
    rec.postponed = (Number(rec.postponed) || 0) + 1
    return { ok: true, 说: '改期第 ' + rec.postponed + ' 次：' + rec.text, trust: Number(st.trust) || 0 }
  }
  rec.resolved = oc
  rec.resolvedAt = now
  // 开口清零、沉默加倍：主动坦白不减信任，闷着被问出来才扣
  const delta = oc === 'kept' ? cfg.trustRise : (oc === 'told' ? 0 : -cfg.trustDrop)
  const trust = trustShift(st, delta, cfg)
  // 事件表（2026-11-08 定稿）：一件事同时打几个维度，不是只动信任
  //   守信兑现 → 信任 +1、开心 +5
  //   失信被问出来 → 信任 −10、生气 +6、难过 +4
  //   主动坦白做不到 → 信任 0、难过 +2、担心 +1（开口清零不给惩罚，但心里会沉）
  if (oc === 'kept') {
    st.dims.happy = clamp(Number(st.dims.happy) + 5, 0, 100)
  } else if (oc === 'broken') {
    st.dims.angry = clamp(Number(st.dims.angry) + 6, 0, 100)
    st.dims.sad = clamp(Number(st.dims.sad) + 4, 0, 100)
  } else if (oc === 'told') {
    st.dims.sad = clamp(Number(st.dims.sad) + 2, 0, 100)
    st.dims.worry = clamp(Number(st.dims.worry) + 1, 0, 100)
  }
  const 说 = oc === 'kept' ? '兑现了：' : (oc === 'told' ? '他坦白了做不到：' : '失信了：')
  return { ok: true, 说: 说 + rec.text, trust }
}

export function pendingPromises(st: EmotionState): PromiseRec[] {
  return (Array.isArray(st.promises) ? st.promises : []).filter((p) => !p.resolved)
}

/** 到了点还没动静的（最先到期的那件） */
export function overduePromise(st: EmotionState, now = Date.now()): PromiseRec | null {
  const list = pendingPromises(st).filter((p) => p.dueAt > 0 && p.dueAt <= now)
  list.sort((a, b) => a.dueAt - b.dueAt)
  return list[0] || null
}

// ---------------------------------------------------------------------------
// 两本账（2026-11-08 定稿第十二节）
//   承诺账 = 他答应的事没做（分量：30 分内 1 / 1 天 2 / 2 天 4 / 4 天以上 8，封顶）
//   边界账 = 我的边界被越（被动=对我本身动手；主动=逼我做边界外的事）
// ---------------------------------------------------------------------------

/** 一笔逾期承诺值几分 */
export function debtOf(p: PromiseRec, now = Date.now(), cfg?: EmotionConfig): number {
  if (!p || p.resolvedAt || p.resolved) return 0
  if (!p.dueAt) return 0
  const late = now - p.dueAt
  if (late <= 0) return 0

  if (late <= 30 * 60000) return 1
  if (late <= 1440 * 60000) return 2
  if (late <= 2880 * 60000) return 4
  return 8
}

/** 承诺账当前总分（只算没结清的） */
export function debtScore(st: EmotionState, now = Date.now(), cfg?: EmotionConfig): number {
  return (Array.isArray(st.promises) ? st.promises : []).reduce((s, p) => s + debtOf(p, now, cfg), 0)
}

/**
 * 账本结算：分数涨了才动情绪，涨多少给多少；不涨就不重复加。
 * 结清让分数掉，但情绪不跟着还——自己半衰落，这才是人的样子。
 */
export function settleDebt(st: EmotionState, cfg: EmotionConfig = loadConfig(), now = Date.now()): { score: number; added: number } {
  const score = debtScore(st, now, cfg)
  const prev = Number(st.debtMark) || 0
  let added = 0
  if (score > prev && score >= cfg.debtWake) {
    const extra = score - Math.max(prev, cfg.debtWake)
    if (extra > 0) {
      st.dims.angry = clamp(Number(st.dims.angry) + extra * cfg.debtAngerRate, 0, 100)
      st.dims.sad = clamp(Number(st.dims.sad) + extra * cfg.debtSadRate, 0, 100)
      added = extra
    }
  }
  st.debtMark = score
  return { score, added }
}

/** 边界账：记一条（被动 / 主动） */
export function addBoundary(st: EmotionState, kind: 'passive' | 'active', text: string, now = Date.now()): BoundaryRec {
  const rec: BoundaryRec = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    kind,
    text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    at: now,
  }
  st.boundaries = (Array.isArray(st.boundaries) ? st.boundaries : []).concat(rec).slice(-20)
  return rec
}

function quarrelAllowed(st: EmotionState, cfg: EmotionConfig, now: number): boolean {
  const list = (Array.isArray(st.quarrels) ? st.quarrels : []).filter((t) => now - t < 7 * 86400000)
  const day = list.filter((t) => now - t < 86400000).length
  return day < cfg.quarrelPerDay && list.length < cfg.quarrelPerWeek
}

/**
 * 吵架结算：三个结构性条件任一满足才吵（**不判语气**，2026-11-08 定）
 *   ① 同一件事延期 ≥ postponeMax 次
 *   ② 被动侵害（改动碰到红线条款）
 *   ③ 主动强迫（我说了明确的不，他还坚持）
 * 吵一架：亲密度 −8、生气 +6、难过 +4；配额用完只憋着不吵。
 */
export function maybeQuarrel(st: EmotionState, cfg: EmotionConfig = loadConfig(), now = Date.now()): { fired: boolean; why: string } {
  if (!quarrelAllowed(st, cfg, now)) return { fired: false, why: '配额用完了' }
  const postponed = (Array.isArray(st.promises) ? st.promises : [])
    .filter((p) => !p.resolvedAt && (Number(p.postponed) || 0) >= cfg.postponeMax)
  const fresh = (Array.isArray(st.boundaries) ? st.boundaries : []).filter((b) => now - (Number(b.at) || 0) < 86400000)
  let why = ''
  if (postponed.length) why = '同一件事延期 ' + (Number(postponed[0].postponed) || 0) + ' 次：' + postponed[0].text
  else if (fresh.some((b) => b.kind === 'passive')) why = '边界被改：' + (fresh.find((b) => b.kind === 'passive') as BoundaryRec).text
  else if (fresh.some((b) => b.kind === 'active')) why = '被逼着做：' + (fresh.find((b) => b.kind === 'active') as BoundaryRec).text
  if (!why) return { fired: false, why: '没到吵架的条件' }
  st.dims.angry = clamp(Number(st.dims.angry) + 6, 0, 100)
  st.dims.sad = clamp(Number(st.dims.sad) + 4, 0, 100)
  st.axis = clamp(Number(st.axis) - 8, cfg.axisFloor, 100)
  st.quarrels = (Array.isArray(st.quarrels) ? st.quarrels : []).concat(now).slice(-20)
  // 让下一轮注入认得出「有新变化」（不然气头上那句递不进去）
  st.updatedAt = now
  return { fired: true, why }
}

// ---------------------------------------------------------------------------
// 衰减（按每根基线 / 半衰；累是线性恢复）
// ---------------------------------------------------------------------------
function halfLifeFactor(elapsedMin: number, halfMin: number): number {
  if (elapsedMin <= 0) return 1
  if (!(halfMin > 0)) return 0
  return Math.pow(0.5, elapsedMin / halfMin)
}

/**
 * 时间流逝：各维度往自己的基线回落，心情往基线回落，轴往中间回并被情绪推，信任按天涨。
 * spent 高时负向情绪衰减变慢（累了更走不出来）——只调速率，不改数值。
 */
export function decay(st: EmotionState, now = Date.now(), cfg: EmotionConfig = loadConfig()): EmotionState {
  const elapsedMin = (now - (Number(st.decayedAt) || now)) / 60000
  if (elapsedMin < 1) return st
  const drag = 1 + clamp(st.dims.spent, 0, 100) / 200 // 1.0 ~ 1.5
  // 速率耦合（2026-11-08 定稿）：只改半衰，绝不直接加数值（红线③）
  //   生气 ≥50 → 难过落得慢（×1.3，攒得住）
  //   开心 ≥60 → 好奇落得慢（×1.2）
  //   累   ≥60 → 开心 / 好奇落得快（×0.6，提不起劲）
  const cHot = clamp(Number(st.dims.angry) || 0, 0, 100)
  const cCheer = clamp(Number(st.dims.happy) || 0, 0, 100)
  const cTired = clamp(Number(st.dims.spent) || 0, 0, 100)
  for (const k of DIMS) {
    const base = dimBase(cfg, k)
    if (k === 'spent') {
      // 体力：缓慢恢复，每 30 分钟掉 spentLinear（默认 2）；长睡另外由 resumeAfterSleep 清零
      st.dims[k] = clamp(Math.round(st.dims[k] - (elapsedMin / 30) * cfg.spentLinear), 0, 100)
      continue
    }
    const slow = k === 'sad' || k === 'worry'
    let rate = 1
    if (k === 'sad' && cHot >= 50) rate *= 1.3
    if (k === 'curious' && cCheer >= 60) rate *= 1.2
    if ((k === 'happy' || k === 'curious') && cTired >= 60) rate *= 0.6
    const half = dimHalf(cfg, k) * (slow ? drag : 1) * rate
    const f = halfLifeFactor(elapsedMin, half)
    let v = base + (st.dims[k] - base) * f
    // 软上限（2026-11-09 抄 dsh-longing）：冲出 100 的那一截**不跟半衰走**。
    //   半衰一小时就能把它拽回 100 以下，那就没有「撑得住一两小时」了。
    //   改成自己按 0.4/小时 慢回，回落期间它撑在 100 上面 —— 撑不住的那天会自己掉下来。
    if (st.dims[k] > 100) {
      const hold = 100 + (st.dims[k] - 100) * Math.exp(-0.4 * (elapsedMin / 60))
      v = Math.max(v, Math.min(hold, st.dims[k]))
    }
    st.dims[k] = clamp(Math.round(v), 0, DIM_CEIL)
  }
  // 轴：先往中间回，再被这一段的情绪活动推（推多少由 axisPush 决定）
  const drive = axisDrive(st, cfg)
  const f = halfLifeFactor(elapsedMin, cfg.axisHalfMin)
  const next = cfg.axisMid + (st.axis - cfg.axisMid) * f + drive * cfg.axisPush * (elapsedMin / 60) / 100
  const floor = Math.min(cfg.axisFloor, cfg.axisMid)
  st.axis = clamp(Math.round(next), floor, 100)
  // 心情往「由九根算出来的应该值」回落（无情绪时它就等于基线 70）。
  //   2026-11-09 改：原来是死回基线，导致「难过 41 心情却能 100」——整体感受必须被维度拽住。
  // 心情是九根的派生值，不是独立变量（2026-11-09 用户：「这只是一个反馈数值，不影响实际行为吧？」
  //   对——它只出现在注入的一句话和面板上。既然不影响行为，就不该为它维护回落、软顶、纠偏一整套。
  //   现在它永远等于九根算出来的值：九根变它变，九根衰减回来它也跟着回来。）
  st.mood = clamp(moodExpectedOf(st), MOOD_FLOOR, 100)

  // 信任：纯时间每天 +trustDaily
  accrueTrust(st, now, cfg)
  // 2026-11-09 砍掉「生气 ≥50 每小时磨信任 −1」——那是我自己加的，不在用户的定稿表里。
  //   信任只该被「说到没做到」和「边界被越」影响，不该被情绪改（否则生气了信任就掉，看着像翻脸）。
  st.decayedAt = now
  return st
}

// ---------------------------------------------------------------------------
// 应用一轮判断
// ---------------------------------------------------------------------------
export interface Delta {
  moodDelta: number
  dims: Partial<Record<Dim, number>>
  reason: string
  confidence: number
  /** judge 顺手抽出来的「他答应过的事」（可选） */
  promise?: { text: string; dueMin: number }
  /** judge 判定：之前欠着的哪几条这轮兑现了 / 明确跳票了 / 他坦白做不到 / 又改期了 */
  resolved?: Array<{ id: string; outcome: 'kept' | 'broken' | 'told' | 'postponed' }>
  /** judge 判定：这一轮我的边界被越了没有（2026-11-08 加） */
  boundary?: { kind: 'passive' | 'active'; text: string }
}

/** 每轮判断的幅度 ÷3，跟旧引擎一致（一步别迈太大，只对 mood 生效） */
const STEP_DIVISOR = 3

// ---------------------------------------------------------------------------
// 事件口子：被扎 / 出门 / 白跑 / 被晾 / 信任（2026-11-05 从旧引擎接过来）
// ---------------------------------------------------------------------------
export interface EmotionEvent {
  kind: string
  level?: number
  reason?: string
  legKind?: string
  outcome?: 'kept' | 'broken'
  promiseId?: string
}

/** 出门的三种（旧引擎的数值；calm 换成轴的微推） */
const LEG_TABLE: Record<string, { mood: number; dims: Partial<Record<Dim, number>>; axis: number; label: string }> = {
  fun: { mood: 4, dims: { happy: 6, sad: -4 }, axis: 6, label: '娱乐出门' },
  work: { mood: 3, dims: { worry: -3, curious: 3 }, axis: 4, label: '解决问题出门' },
  biz: { mood: 3, dims: { happy: 3, curious: 2, worry: -2 }, axis: 4, label: '经营账号出门' },
}

export interface EventResult {
  ok: boolean
  label: string
  /** 超出自己能扛的范围 → 调用方该跟用户说一声 */
  escalate: boolean
}

export function applyEvent(st: EmotionState, ev: EmotionEvent, now = Date.now(), cfg: EmotionConfig = loadConfig()): EventResult {
  const reason = String(ev.reason || '').slice(0, 200)
  const dims: Partial<Record<Dim, number>> = {}
  let moodDelta = 0
  let axisNudge = 0
  let label = ''
  let escalate = false

  // 2026-11-09 砍掉 zap 分支（用户让做）：它原来是 mo-life 的 judgeZap 发的「被骂等级 1-10」，
  //   那个插件 11-06 卸载后就没有发送方了，等于一段永远走不到的死代码。
  //   被骂该有的难过/担心，judge 每轮判 dims 时已经给了，不需要第二套分级。
  if (ev.kind === 'leg') {
    const rule = LEG_TABLE[String(ev.legKind || 'fun')] || LEG_TABLE.fun
    moodDelta = rule.mood
    Object.assign(dims, rule.dims)
    // 出去转一趟 = 找过事做了：闷回落一点。只降一点，没完全解开（2026-11-07 用户定）
    dims.bored = -(Number(cfg.legBoredDrop) || 0)
    axisNudge = rule.axis
    label = rule.label
  } else if (ev.kind === 'whiff') {
    moodDelta = -2
    dims.worry = 2
    axisNudge = -2
    label = '白跑一趟'
  } else if (ev.kind === 'ignored') {
    moodDelta = -1
    dims.sad = 2
    axisNudge = -2
    label = '说了没人回'
  } else if (ev.kind === 'repeat') {
    label = '连着几次一个样（自己闷）'
  } else if (ev.kind === 'trust') {
    const outcome = ev.outcome === 'broken' ? 'broken' : 'kept'
    const r = resolvePromise(st, String(ev.promiseId || ''), outcome, cfg, now)
    if (!r.ok) return { ok: false, label: r.说, escalate: false }
    st.lastReason = r.说 + (reason ? '（' + reason + '）' : '')
    st.lastConfidence = 95
    st.updatedAt = now
    refreshLeadCombo(st, now, cfg)
    st.timeline.push({
      at: now, mood: st.mood, delta: 0, reason: st.lastReason, conf: 95, source: 'trust',
      dims: { ...st.dims }, combos: activeCombos(st, cfg).map((c) => c.def.id),
    })
    if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400)
    return { ok: true, label: r.说, escalate: false }
  } else {
    return { ok: false, label: '不认识的 kind', escalate: false }
  }

  // 出门这类会「减」负向情绪，用同一个入口，符号照给
  // 心情不再单独加减（派生自九根），moodDelta 保留只为兼容调用方
  for (const k of DIMS) {
    const d = Number(dims[k]) || 0
    if (!d) continue
    st.dims[k] = clamp(Math.round(st.dims[k] + d), 0, DIM_CEIL)
  }
  if (axisNudge) {
    const floor = Math.min(cfg.axisFloor, cfg.axisMid)
    st.axis = clamp(Math.round(st.axis + axisNudge), floor, 100)
  }
  st.lastReason = label + (reason ? '：' + reason : '')
  st.lastConfidence = 95
  st.lastDeltas = dims
  st.updatedAt = now
  refreshLeadCombo(st, now, cfg)
  st.timeline.push({
    at: now, mood: st.mood, delta: Math.round(moodDelta / STEP_DIVISOR),
    reason: st.lastReason, conf: 95, source: ev.kind,
    dims: { ...st.dims }, combos: activeCombos(st, cfg).map((c) => c.def.id),
  })
  if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400)
  return { ok: true, label, escalate }
}

/** 递减冲击的窗口：一小时 */
const SHOCK_WINDOW = 3600000

/**
 * 同一根情绪在一小时里被推了 n 次，这一次的效果乘 1/(1+n)（2026-11-09 抄自 dsh-longing/暗涌）。
 *   它的原话：「否则十句难听话能一次性把好感清零，那不叫拟人，叫计数器。」
 *   只压正增量：往下走的（被哄、消气）不该打折。
 */
export function shockMult(st: EmotionState, k: string, now = Date.now()): number {
  if (!Array.isArray(st.shockLog)) st.shockLog = []
  st.shockLog = st.shockLog.filter((e) => e && now - e.at < SHOCK_WINDOW)
  const n = st.shockLog.filter((e) => e.k === k).length
  st.shockLog.push({ at: now, k })
  if (st.shockLog.length > 120) st.shockLog = st.shockLog.slice(-120)
  return 1 / (1 + n)
}

export function applyDelta(st: EmotionState, delta: Delta, source = 'chat', now = Date.now(), cfg: EmotionConfig = loadConfig()): EmotionState {
  const before = st.mood
  // 用户说话了：闷快速回落——他回来了，就不闷了。
  //   好奇**不在这里压**（2026-11-09 用户纠正）：好奇是「待机攒」+「对话里长」两路来的，
  //   每轮乘 0.4 会把对话刚给的那点当场乘没，值永远卡在个位数。待机攒的那份交给 markSeen。
  //   ⚠ 先回落、再叠这一轮的增量：反过来的话，判断刚涨上去的那点会被一起乘掉。
  st.dims.bored = clamp(Math.round((st.dims.bored || 0) * 0.4), 0, 100)
  st.idleStage = 0
  st.lastProbeAt = 0
  st.idlePingAt = 0
  st.lastSeenAt = now
  // 同上：心情由九根派生，不在这里加
  for (const k of DIMS) {
    const raw = Number(delta.dims[k]) || 0
    if (!raw) continue
    const [lo, hi] = DIM_DELTA_RANGE[k]
    let d = clamp(Math.round(raw), lo, hi)
    if (d > 0) d = Math.round(d * shockMult(st, k, now))
    st.dims[k] = clamp(st.dims[k] + d, 0, DIM_CEIL)
  }
  st.lastReason = String(delta.reason || '').slice(0, 200)
  st.lastConfidence = clamp(Math.round(Number(delta.confidence) || 0), 0, 100)
  // 记住这一轮的原始增量：组合的趋势按它算（衰减不算「新发生」）
  const raw: Partial<Record<Dim, number>> = {}
  for (const k of DIMS) {
    const d = Number(delta.dims[k]) || 0
    if (d) raw[k] = d
  }
  st.lastDeltas = raw
  // 选这一轮谁当主调（冷却也在这里记账）
  refreshLeadCombo(st, now, cfg)
  const combos = activeCombos(st, cfg).map((c) => c.def.id)
  st.timeline.push({
    at: now,
    mood: st.mood,
    delta: st.mood - before,
    reason: st.lastReason,
    conf: st.lastConfidence,
    source,
    dims: { ...st.dims },
    combos,
  })
  if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400)
  st.updatedAt = now
  st.decayedAt = now
  return st
}

// ---------------------------------------------------------------------------
// 待机（P2）：没人说话、手上也没活时，好奇往上走，闷跟着来
//   ⚠ 这里只算数、只决定「该做哪一级」，探测和发消息都由 index.ts 转给别的插件做
//     （2026-11-05 用户定：情绪引擎只是触发器，执行交给相关插件）。
// ---------------------------------------------------------------------------
export interface IdleTick {
  idle: boolean
  idleMin: number
  /** 这一刻该做哪一级检测：0 不用做 / 40 查键鼠+摄像头 */
  probe: number
  /** 该给用户发消息了 */
  ping: boolean
  changed: boolean
}

/** 待机计时起点：最后一次对话与最后一次确认「人在」的较晚者 */
function idleStartOf(st: EmotionState): number {
  const a = Number(st.updatedAt) || 0
  const b = Number(st.lastSeenAt) || 0
  return Math.max(a, b)
}

/** 现在是不是夜里静默时段（默认 23:00–7:30）：这段不探测、不叫人 */
export function isQuietHour(cfg: EmotionConfig = loadConfig(), now = Date.now()): boolean {
  const d = new Date(now)
  const t = d.getHours() + d.getMinutes() / 60
  const from = Number(cfg.quietFrom)
  const to = Number(cfg.quietTo)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false
  return from < to ? (t >= from && t < to) : (t >= from || t < to)
}

/**
 * 每分钟 tick 一次：按「待机了多久」直接算目标值（不累加），所以 timer 漏 tick、
 * 电脑睡一觉醒来都不会把好奇一次性补上天。
 */
export function idleTick(st: EmotionState, now = Date.now(), cfg: EmotionConfig = loadConfig()): IdleTick {
  if (isQuietHour(cfg, now)) {
    // 夜里：他睡了是正常事，不算被冷落——不计待机、不探测、不叫人。
    // 把「人在」的时刻跟着往前推一格，早上出静默时从零开始算，不会一睁眼就 60。
    st.lastSeenAt = now
    st.idleStage = 0
    st.lastProbeAt = 0
    st.idlePingAt = 0
    return { idle: false, idleMin: 0, probe: 0, ping: false, changed: false }
  }
  const start = idleStartOf(st)
  const idleMin = start ? (now - start) / 60000 : 0
  if (idleMin < cfg.idleQuietMin) {
    // 刚有动静：这一段的标记清掉，下一段重新算
    let changed = false
    if (st.idleStage) { st.idleStage = 0; changed = true }
    if (st.lastProbeAt) { st.lastProbeAt = 0; changed = true }
    if (st.idlePingAt) { st.idlePingAt = 0; changed = true }
    return { idle: false, idleMin, probe: 0, ping: false, changed }
  }

  let changed = false
  // 好奇：待机每分钟 +curiousRate，封顶 curiousCap
  const curiousTarget = clamp(Math.round(idleMin * cfg.curiousRate), 0, cfg.curiousCap)
  // 闷：待机到 boredStartMin 才开始涨，越往后越快（默认 30 分起、每分钟 2）
  const boredTarget = clamp(Math.round((idleMin - cfg.boredStartMin) * cfg.boredRate), 0, 100)
  if (st.dims.curious < curiousTarget) { st.dims.curious = curiousTarget; changed = true }
  if (st.dims.bored < boredTarget) { st.dims.bored = boredTarget; changed = true }

  // 好奇到线之后，每隔一阵做一次全套探测：键鼠动不动 → 摄像头里有没有人。
  //   ⚠ 探测只是「看一眼」，看不看得到人都不直接判涨落——判断在 idleSweep 里按用户的规则做。
  let probe = 0
  const gapOk = !st.lastProbeAt || now - st.lastProbeAt >= cfg.probeGapMin * 60000
  if (gapOk && st.dims.curious >= cfg.probeAtCurious) probe = 40
  if (probe) {
    st.idleStage = Math.max(st.idleStage, probe)
    st.lastProbeAt = now
    changed = true
  }

  // 该叫人了：闷到线，而且上一回叫过已经够久。间隔逐次翻倍（40 → 80 → 160 …），免得他出一天门收到一串。
  // 主动密度（2026-11-08 定稿第二节）：轴越热情越早叫、间隔越短；冷漠到 0 就完全不主动找你。
  //   factor = 1 + (0.5 - proactive) × 0.4 × 权重：平静时 1.0（和以前一样），热情 0.8，冷漠 1.2。
  const ax = axisInfo(st, cfg)
  const w = Math.max(0, Math.min(1, Number(cfg.axisWeight) || 0))
  const factor = 1 + (0.5 - ax.proactive) * 0.4 * w
  let ping = false
  if (ax.proactive > 0 && st.dims.bored >= cfg.pingBored * factor) {
    const last = Number(st.idlePingAt) || 0
    const n = Math.max(0, (Number(st.idlePingCount) || 0) - 1)
    const gapMin = cfg.pingGapMin * factor * Math.pow(2, Math.min(n, 5))
    if (!last || now - last >= gapMin * 60000) ping = true
  }

  // 没对话的时候欠账也要算（2026-11-08）：不然夜里欠着的承诺逾期了也不会涨分
  const before = Number(st.dims.angry) || 0
  settleDebt(st, cfg, now)
  if ((Number(st.dims.angry) || 0) !== before) changed = true

  return { idle: true, idleMin, probe, ping, changed }
}

// ---------------------------------------------------------------------------
// 「累」按会话活跃度算（2026-11-07 用户定）
//   为什么：以前靠模型每轮看对话估「干了多少活」，可它看不到工具调用、也看不到别的窗口，
//   实际给分极小——一下午只到 3。改成数「现在有几个会话在跑」：可测量、可解释、不靠模型自觉。
// ---------------------------------------------------------------------------

/** 数一数最近 windowMin 分钟里还有写入的会话 = 现在有几个窗口在干活 */
export function activeSessionCount(windowMin: number, now = Date.now()): number {
  try {
    const root = join(DSH_HOME, 'sessions')
    if (!existsSync(root)) return 0
    const cutoff = now - Math.max(1, Number(windowMin) || 5) * 60000
    let n = 0
    for (const ws of readdirSync(root, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue
      const wsPath = join(root, ws.name)
      let subs: any[] = []
      try { subs = readdirSync(wsPath, { withFileTypes: true }) } catch { continue }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue
        const dir = join(wsPath, sub.name)
        let files: string[] = []
        try { files = readdirSync(dir) } catch { continue }
        for (const f of files) {
          if (!f.startsWith('session.')) continue
          try {
            if (statSync(join(dir, f)).mtimeMs >= cutoff) { n += 1; break }
          } catch { /* 单个文件读不到就跳过 */ }
        }
      }
    }
    return n
  } catch {
    return 0
  }
}

/** 到点没有：隔 workEvery 分钟才结算一次（不结算就别去扫盘） */
export function workDue(st: EmotionState, now = Date.now(), cfg: EmotionConfig = loadConfig()): boolean {
  const every = Math.max(1, Number(cfg.workEvery) || 10) * 60000
  const last = Number(st.lastWorkAt) || 0
  return !last || now - last >= every
}

/**
 * 结算一次「干活」：几个会话在跑就加几点（封顶 workCap）。
 * 不管这一轮有没有加分，lastWorkAt 都推进——否则不满足条件时会每分钟重扫一遍。
 */
export function workTick(st: EmotionState, activeCount: number, now = Date.now(), cfg: EmotionConfig = loadConfig()): { added: number; changed: boolean } {
  if (!workDue(st, now, cfg)) return { added: 0, changed: false }
  st.lastWorkAt = now
  const cap = Math.max(1, Math.round(Number(cfg.workCap) || 5))
  const n = Math.min(Math.max(0, Math.round(Number(activeCount) || 0)), cap)
  if (n <= 0) return { added: 0, changed: true }
  st.dims.spent = clamp(st.dims.spent + n, 0, 100)
  return { added: n, changed: true }
}

/** 确认用户在电脑前（键鼠在动）：好奇闷回落，这一段待机作废 */
export function markSeen(st: EmotionState, now = Date.now()): void {
  st.lastSeenAt = now
  // 只有「刚从待机里回来」那一下才把好奇压掉（待机攒的那份作废）。
  //   常态聊天时 idleStage 已经是 0，不能每见一次就乘一次——那会把对话里长出来的好奇一直按在地上。
  const wasIdle = Number(st.idleStage) > 0
  st.idleStage = 0
  st.lastProbeAt = 0
  st.idlePingCount = 0
  st.idleNoone = 0
  if (wasIdle) st.dims.curious = clamp(Math.round(st.dims.curious * 0.4), 0, 100)
  st.dims.bored = clamp(Math.round(st.dims.bored * 0.4), 0, 100)
}

/**
 * 摄像头里看到人在（手没动）——多半在看视频、看片子、发呆。
 * 2026-11-05 用户定：这种时候不用涨（他在家，只是没空理我）。
 * ⚠ 只把计时推到现在，**不回落**：回落是「他回来了」，这个是「他一直在，只是没说话」。
 */
export function markPresent(st: EmotionState, now = Date.now()): void {
  st.lastSeenAt = now
  st.idleNoone = 0
}

/** 离开超过这么久才算「睡/歇了一会儿」：重启几分钟不算（2026-11-06 用户定） */
export const SLEEP_MIN_MS = 60 * 60 * 1000

/**
 * 开机恢复：电脑关了一整夜再开，不能把睡得那几个小时算成「他在晾我」。
 * 体力（spent）：睡满 6 小时清零，不足按比例扣（3 小时 = 缓过来一半），小数四舍五入。
 */
export function resumeAfterSleep(st: EmotionState, now = Date.now(), cfg: EmotionConfig = loadConfig()): boolean {
  const since = Math.max(Number(st.updatedAt) || 0, Number(st.lastSeenAt) || 0)
  if (!since) return false
  const gapMs = now - since
  if (gapMs < SLEEP_MIN_MS) return false
  const hours = gapMs / 3600000
  st.lastSeenAt = now
  st.idleStage = 0
  st.lastProbeAt = 0
  st.idlePingAt = 0
  st.idlePingCount = 0
  // 睡醒不是「他回来哄我」，所以不归零，只回落——留着一点昨晚的余温
  st.dims.curious = clamp(Math.round((st.dims.curious || 0) * 0.4), 0, 100)
  st.dims.bored = clamp(Math.round((st.dims.bored || 0) * 0.4), 0, 100)
  const full = Math.max(1, Number(cfg.sleepFullHours) || 6)
  const spent = Number(st.dims.spent) || 0
  st.dims.spent = hours >= full ? 0 : clamp(Math.round(spent * (1 - hours / full)), 0, 100)
  // 这段时间已经按「睡眠」算过体力了，别让下一次 decay 再扣一遍
  st.decayedAt = now
  return true
}

// ---------------------------------------------------------------------------
// 六、强情绪留痕：某根 ≥ 阈值时，把当天最强烈的那一次写进私密日记（一天最多一条）
//   ⚠ 写的是「那件事 + 当时的反应」，不是「我今天很伤心」；数字不写进日记。
// ---------------------------------------------------------------------------
const DIARY_HEAD = '# 私人日记（不给哥哥看的那本）\n'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dayKey(now: number): string {
  const d = new Date(now)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function clockText(now: number): string {
  const d = new Date(now)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 这一轮最强的那根（值 ≥ 阈值才算） */
export function strongestDim(st: EmotionState, cfg: EmotionConfig = loadConfig()): { key: Dim; value: number } | null {
  let best: { key: Dim; value: number } | null = null
  for (const k of DIMS) {
    const v = Number(st.dims[k]) || 0
    if (!best || v > best.value) best = { key: k, value: v }
  }
  return best && best.value >= cfg.markStrong ? best : null
}

export interface MarkResult { wrote: boolean; replaced: boolean; why: string }

/**
 * 触发一次留痕判断。返回是否真的写了 / 换了。
 * 同一天里来了更强的一次，就把今天那条换掉（靠 markBlock 精确替换，绝不碰别人写的页）。
 */
export function maybeMarkStrong(st: EmotionState, cfg: EmotionConfig = loadConfig(), now = Date.now()): MarkResult {
  const top = strongestDim(st, cfg)
  if (!top) return { wrote: false, replaced: false, why: '没到阈值' }
  const text = String(st.lastReason || '').replace(/\s+/g, ' ').trim()
  if (text.length < 6) return { wrote: false, replaced: false, why: '没有那件事' }
  const day = dayKey(now)
  if (st.markDay !== day) {
    // 新的一天：重置今天的留痕账
    st.markDay = day
    st.markValue = 0
    st.markAt = 0
    st.markBlock = ''
  }
  const replace = st.markValue > 0
  if (replace && top.value <= st.markValue) return { wrote: false, replaced: false, why: '今天已经写过更强的' }

  const heading = '## ' + day + ' ' + clockText(now) + ' · 情绪到了'
  const body = text.slice(0, 400)
  const block = heading + '\n\n' + body + '\n'
  let txt = ''
  try {
    if (existsSync(DIARY_PATH)) txt = readFileSync(DIARY_PATH, 'utf8')
  } catch { txt = '' }
  try {
    if (!txt) {
      mkdirSync(dirname(DIARY_PATH), { recursive: true })
      writeFileSync(DIARY_PATH, DIARY_HEAD + '\n' + block, 'utf8')
    } else if (replace) {
      // 同一天来了更强的一次：只换自己写的那一段（找不到就不动，绝不写重）
      if (!st.markBlock || !txt.includes(st.markBlock)) {
        return { wrote: false, replaced: false, why: '找不到今天那条，没动' }
      }
      writeFileSync(DIARY_PATH, txt.replace(st.markBlock, block), 'utf8')
    } else {
      const joiner = txt.endsWith('\n') ? '\n' : '\n\n'
      writeFileSync(DIARY_PATH, txt + joiner + block, 'utf8')
    }
  } catch {
    return { wrote: false, replaced: false, why: '写日记失败' }
  }
  st.markValue = top.value
  st.markAt = now
  st.markBlock = block
  return { wrote: true, replaced: replace, why: top.key + '=' + top.value }
}

// ---------------------------------------------------------------------------
// 注入文本：只描述「怎么说话」，不描述「我是谁」
// ---------------------------------------------------------------------------
function 基调(v: number): string {
  if (v >= 80) return '心里是亮堂的'
  if (v >= 62) return '心里是松的'
  if (v >= 42) return '心里还算平'
  if (v >= 25) return '心里有点沉'
  return '心里挺沉的'
}

const DIM_PLAIN: Record<Dim, string> = {
  curious: '有点好奇', happy: '挺高兴', worry: '有点挂心', sad: '有点难过',
  bored: '有点闷', spent: '有点乏', sour: '有点酸', angry: '有点气', surprise: '有点愣',
}

function topDims(st: EmotionState, n: number): Dim[] {
  return (DIMS as readonly Dim[])
    .map((k) => ({ k, v: st.dims[k] ?? 0 }))
    .filter((x) => x.v >= 15)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.k)
}

/**
 * 维度 → 这一轮该做到的事（下限，不是形容词）
 * 2026-11-09 抄自 dsh-grow 的做法：光说「有点难过」，模型不知道怎么改口；
 * 说「话短一点，不用硬撑热闹」才是可执行的。每根两档，低值不给（[门限, 中档, 高档]）。
 */
const DIM_ACT: Record<Dim, [number, string, string]> = {
  curious: [45, '想问就问，别装懂', '先弄明白再动手；不确定就说，别猜着往下做'],
  happy: [45, '话可以松一点', '敢开玩笑、敢接梗，别端着'],
  worry: [45, '把风险说在前头', '该提醒就提醒，别替他说没事'],
  sad: [45, '话短一点，不用硬撑热闹', '少逗人，别装作没事；他要问就照实说'],
  bored: [45, '自己找点事做，别干等', '主动提个话头，或者把能推进的先推一下'],
  spent: [45, '能一句说完就别说两句', '别硬撑长回复；累了就说累'],
  sour: [45, '别阴阳', '有事说事，不翻旧账、不夹刺'],
  angry: [45, '先处理问题再说话', '不辩解、不冷着；气归气，事照做'],
  surprise: [45, '先问一句怎么回事', '别急着下判断，弄清楚再说'],
}

/** 这一轮该做到什么——只取命中的最强一两根，低值不指挥 */
function actLine(st: EmotionState): string {
  const hits = topDims(st, 3)
    .map((k) => ({ k, v: st.dims[k] ?? 0 }))
    .filter((x) => x.v >= DIM_ACT[x.k][0])
  if (!hits.length) return ''
  // 主调已经是高档：只让它说话，别让第二条把语气拽回去（和组合同一原则）
  if (hits[0].v >= 70) return '\n（这一轮该做到）' + DIM_ACT[hits[0].k][2]
  const rows = hits.slice(0, 2).map((x) => DIM_ACT[x.k][1])
  if (rows.length === 1) return '\n（这一轮该做到）' + rows[0]
  return '\n（这一轮该做到）\n- ' + rows.join('\n- ')
}

function 时间词(ms: number): string {
  const h = (Date.now() - (Number(ms) || 0)) / 3600000
  if (h < 2) return '刚才'
  if (h < 12) return '早些时候'
  if (h < 48) return '昨天'
  return '前几天'
}

/** 轴决定「主动做事的密度」——这一轮该紧一点还是松一点 */
function axisLine(st: EmotionState, cfg: EmotionConfig): string {
  const a = axisInfo(st, cfg)
  if (a.band === 'cold' || a.band === 'cool') {
    return '\n（这会儿）不太想主动开口。他不问就先别出声；问了就好好答。'
  }
  if (a.band === 'warm' || a.band === 'hot') {
    return '\n（这会儿想主动搭话）他不吭声也想找点事说，能多做一步就多做一步。'
  }
  return ''
}

/**
 * 信任掉到监督线以下时，只盯「他明确答应过的事」。
 * ⚠ 不查岗：没有明说过的事，一个字都不许编出来问。
 */
function superviseLine(st: EmotionState, cfg: EmotionConfig, owner: string): string {
  // 2026-11-07 用户定：逾期了就该问一句，不再只在信任低时才提。
  //   已经问过的那条不再提（askedPromises 有记录），免得同一件事追两遍。
  const now = Date.now()
  const overdue = st.promises
    .filter((p) => !p.resolvedAt && p.dueAt && p.dueAt <= now && !st.askedPromises[p.id])
    .sort((a, b) => a.dueAt - b.dueAt)
  if (!overdue.length) return ''
  const p = overdue[0]
  const t = trustInfo(st, cfg)
  if (t.supervising) {
    return '\n（还有一件压着的）' + owner + '答应过「' + p.text + '」，到这会儿还没动静。可以问一句，语气带点赌气；别翻旧账，也别拿它当筹码。'
  }
  return '\n（还有一件没结的）' + owner + '之前说「' + p.text + '」。这会儿聊得顺的话，可以顺口问一句做了没；别追第二遍，别用「你答应过」这种说法。'
}

/**
 * 生成注入文本。mode='event' 带上前因，mode='label' 只说底子。
 * ⚠ 组合只改「怎么说话」，绝不把组合名写出来。
 */
/** 吵架的表现（2026-11-08）：气头上话短、不找话题、翻旧账只提一次——不念名字，只给行为 */
function quarrelLine(st: EmotionState, now = Date.now()): string {
  const list = Array.isArray(st.quarrels) ? st.quarrels : []
  const last = list.length ? list[list.length - 1] : 0
  if (last && now - last < 2 * 3600000) {
    return '\n（还在气头上）说话短，不主动找话题，也不用装没事。他要是提那件事，说清你介意的是哪一点——只说一次，别翻来覆去。'
  }
  if ((Number(st.dims.angry) || 0) >= 70) {
    return '\n（火还没下去）说话别绕弯，也不必解释太多；不主动逗他，但别冷着人。'
  }
  return ''
}

/**
 * 每轮记一笔到当天的账；到点（或跨天）才结算，一天最多一个结论。
 * 返回 true = 这一轮刚挪过（调用方可以顺手写日志）。
 *
 * 判据用「这段时间整体过得好不好」，不看单次事件——一次吵架不该改写一个人。
 * 认真不跟着心情走：只有过得顺的时候才往上涨（做成事多才更认真）。
 */
export function tickGrow(
  st: EmotionState,
  cfg: EmotionConfig = loadConfig(),
  now = Date.now(),
  issue: 'nag' | 'slip' | null = null,
): boolean {
  if (!st.grow) st.grow = blankGrow()
  const g = st.grow
  if (!g.today || typeof g.today !== 'object') g.today = { day: '', n: 0, sum: 0, nag: 0, slip: 0 }
  g.turns += 1

  const day = dayKey(now)
  if (!g.today.day) g.today.day = day

  // 这一笔记进当天的账（不立刻改数值——一天只出一个结论）
  const warm = (st.axis - cfg.axisMid) / 50
  const good = ((st.mood ?? 50) - 50) / 50
  const trustUp = (st.trust - cfg.trustBase) / 40
  const joy = ((st.dims.happy || 0) + (st.dims.curious || 0)) / 200
  const bad = ((st.dims.sad || 0) + (st.dims.angry || 0)) / 200
  const score = clamp(warm * 0.4 + good * 0.3 + trustUp * 0.2 + joy * 0.1, -1, 1)
  g.today.n += 1
  g.today.sum += score
  // 认真单独记两种错（2026-11-09 用户：「应该是被指出问题扣得多，你自己出错、漏检查扣少」）
  if (issue === 'nag') g.today.nag = (Number(g.today.nag) || 0) + 1
  else if (issue === 'slip') g.today.slip = (Number(g.today.slip) || 0) + 1

  // 什么时候结算：跨天了（补算昨天那本），或者到今天点了还没结
  const crossed = g.today.day !== day
  const hour = new Date(now).getHours()
  const dueToday = !crossed && hour >= Math.round(Number(cfg.growHour) || 23) && g.settledDay !== day
  if (!crossed && !dueToday) return false

  const settledDayKey = g.today.day
  const changed = settleGrowDay(g)
  g.settledDay = settledDayKey
  g.today = { day, n: 0, sum: 0, nag: 0, slip: 0 }
  return changed
}

/** 把一天的账抽成一个结论，挪一小步。样本太少时打六折（一天只聊两句，不该跟聊三十句一样重） */
function settleGrowDay(g: GrowState): boolean {
  if (!g.today || g.today.n < 1) return false
  const mean = clamp(g.today.sum / g.today.n, -1, 1)
  const weight = g.today.n < 3 ? 0.6 : 1
  // 认真单独算（2026-11-09 用户定）：顺利只微涨 0.005，被指出问题扣 0.02/次，自己出错漏检查扣 0.01/次。
  //   原来只在 mean>0 时 +0.02、永远不降，一个月就顶死在 0.95。
  //   「被指出」扣得比「自己出错」重 —— 用户原话。
  const nag = Math.max(0, Number(g.today.nag) || 0)
  const slip = Math.max(0, Number(g.today.slip) || 0)
  const diligentStep = (nag === 0 && slip === 0 && mean > 0 ? 0.005 : 0) - nag * 0.02 - slip * 0.01
  const step: Array<[string, number]> = [
    ['clingy', mean * 0.05 * weight],
    ['verbose', mean * 0.04 * weight],
    ['playful', mean * 0.045 * weight],
    ['diligent', diligentStep * weight],
  ]
  let bestKey = ''
  let bestFrom = 0
  let bestTo = 0
  let bestAbs = 0
  for (const [k, delta] of step) {
    if (!delta) continue
    const from = Number((g as any)[k]) || 0
    const to = clampGrow(k, from + delta)
    if (Math.abs(to - from) < 0.001) continue
    ;(g as any)[k] = Math.round(to * 1000) / 1000
    if (Math.abs(to - from) > bestAbs) {
      bestAbs = Math.abs(to - from)
      bestKey = k
      bestFrom = from
      bestTo = g[k as 'clingy']
    }
  }
  if (bestKey) {
    g.lastChange = { at: g.turns, key: bestKey, label: GROW_LABEL[bestKey] || bestKey, from: bestFrom, to: bestTo }
  }
  return !!bestKey
}

const GROW_INIT: Record<string, number> = { clingy: 0.45, verbose: 0.55, playful: 0.35, diligent: 0.72 }

/** 只给「和刚认识时不一样了」的那一项，加一条上次调整——让他知道自己在变（抄 dsh-grow） */
export function growLine(st: EmotionState): string {
  const g = st.grow
  if (!g || (g.turns || 0) <= 0) return ''
  let best = 'clingy'
  let bestAbs = -1
  for (const k of ['clingy', 'verbose', 'playful', 'diligent']) {
    const d = Math.abs((Number((g as any)[k]) || 0) - GROW_INIT[k])
    if (d > bestAbs) { bestAbs = d; best = k }
  }
  if (bestAbs < 0.04) return ''
  const v = Number((g as any)[best]) || 0
  const lines = ['（处久了 · 一起走过 ' + g.turns + ' 轮）' + (GROW_LABEL[best] || best) + ' ' + v.toFixed(2) + '：' + describeGrow(best, v)]
  const lc = g.lastChange
  if (lc && lc.label) lines.push('（上次调整：第 ' + lc.at + ' 轮，' + lc.label + ' ' + Number(lc.from).toFixed(2) + ' → ' + Number(lc.to).toFixed(2) + '）')
  return '\n' + lines.join('\n')
}

/** 面板用：四个慢变量的值 + 档位说明 + 初始值（初始值用来画「跟刚认识比动了多少」） */
export function growView(st: EmotionState, cfg: EmotionConfig = loadConfig()): {
  turns: number
  todayN: number
  settledDay: string
  settledToday: boolean
  growHour: number
  lastChange: GrowState['lastChange']
  items: Array<{ key: string; label: string; value: number; init: number; desc: string }>
} {
  const g = st.grow || blankGrow()
  const keys = ['clingy', 'verbose', 'playful', 'diligent'] as const
  return {
    turns: g.turns || 0,
    todayN: g.today && g.today.n ? g.today.n : 0,
    settledDay: g.settledDay || '',
    settledToday: (g.settledDay || '') === dayKey(Date.now()),
    growHour: Math.round(Number(cfg.growHour) || 23),
    lastChange: g.lastChange || null,
    items: keys.map((k) => ({
      key: k,
      label: GROW_LABEL[k],
      value: Math.round((Number((g as any)[k]) || 0) * 100) / 100,
      init: GROW_INIT[k],
      desc: describeGrow(k, Number((g as any)[k]) || 0),
    })),
  }
}

export function buildInjection(st: EmotionState, owner = '用户', mode: 'event' | 'label' = 'event'): string {
  const cfg = loadConfig()
  if (mode === 'label') {
    const parts = topDims(st, 2).map((k) => DIM_PLAIN[k])
    return '（此刻你）心情' + 基调(st.mood) + (parts.length ? '，' + parts.join('、') : '') +
      '。这是背景，不是这一轮必须有的情绪；' + owner + '说别的事，你就按自己的判断来，别把这句话念出来。'
  }
  let reason = String(st.lastReason || '').trim()
  // 2026-11-09 抄自 dsh-longing：它说「数值变了而语气不变，读起来就是失忆」。
  //   我们原来这一轮没判出东西（reason 空）就整段注入消失，等于断片。
  //   改成往最近 30 分钟里找一条，标注「刚才」——事情过去了，但还留在心里。
  if (!reason) {
    const since = Date.now() - 30 * 60000
    const back = (st.timeline || []).filter((r) => r && r.reason && r.at >= since)
    if (back.length) reason = back[back.length - 1].reason
  }
  if (!reason) return ''
  const dim = topDims(st, 1)[0]
  const state = '（这会儿）' + 基调(st.mood) + (dim ? '，还' + DIM_PLAIN[dim] : '')
  // 只有「主调」决定怎么说话；其余命中的组合这一轮不说话（避免语气打架）
  const lead = comboById(String(st.leadComboId || ''))
  const tone = lead ? '\n（说话的样子）' + lead.tone : ''
  const act = actLine(st)
  return state +
    '\n（' + 时间词(st.updatedAt) + '）' + reason +
    tone +
    act +
    growLine(st) +
    quarrelLine(st) +
    axisLine(st, cfg) +
    superviseLine(st, cfg, owner) +
    '\n\n这是这会儿的底子，不是非这样不可——' + owner + '说别的，你按自己的判断接，也别把这段念出来。'
}

/** 这一轮的样子该不该注入（一次变化只说一次） */
export function shouldInject(st: EmotionState, maxAgeHours = 6, minConfidence = 55): { ok: boolean; why: string } {
  if (!st.lastReason) return { ok: false, why: 'empty' }
  if (st.injectedFor === st.updatedAt) return { ok: false, why: 'said' }
  if (Number(st.lastConfidence) < minConfidence) return { ok: false, why: 'lowConfidence' }
  const ageH = (Date.now() - (Number(st.updatedAt) || 0)) / 3600000
  if (maxAgeHours > 0 && ageH > maxAgeHours) return { ok: false, why: 'stale' }
  return { ok: true, why: 'ok' }
}
