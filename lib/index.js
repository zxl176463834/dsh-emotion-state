// src/index.ts
import { appendFileSync, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/judge.ts
import { randomUUID } from "node:crypto";

// src/state.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
var STORE = join(DSH_HOME, "emotion");
var STATE_PATH = join(STORE, "state.json");
var CONFIG_PATH = join(STORE, "config.json");
var DIARY_PATH = join(DSH_HOME, "whale-diary-private.md");
function clamp(n, lo, hi) {
  const v = Number(n);
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}
var DIMS = [
  "curious",
  "happy",
  "worry",
  "sad",
  "bored",
  "spent",
  "sour",
  "angry",
  "surprise"
];
var DIM_LABEL = {
  curious: "\u597D\u5947",
  happy: "\u5F00\u5FC3",
  worry: "\u62C5\u5FC3",
  sad: "\u96BE\u8FC7",
  bored: "\u95F7",
  spent: "\u7D2F",
  sour: "\u5403\u918B",
  angry: "\u751F\u6C14",
  surprise: "\u60CA\u8BB6"
};
var DIM_DEFS = {
  // 好奇没有基线（2026-11-09 用户纠正）：最初设计就是「待机随时间涨」+「跟我对话时涨」两路，
  //   不存在「平时默认有点好奇」这回事。原来错给了 30，结果人被压到 4-6，雷达图上像根木头。
  curious: { base: 0, halfMin: 90, note: "\u6CA1\u6709\u57FA\u7EBF\uFF1A\u5F85\u673A\u6BCF\u5206\u949F +1\uFF08\u5C01\u9876 60\uFF09\uFF0C\u5BF9\u8BDD\u65F6\u7531\u5224\u5B9A\u7ED9" },
  happy: { base: 25, halfMin: 90, note: "\u88AB\u5938\u3001\u4E8B\u60C5\u6210\u4E86\u3001\u5206\u4EAB\u5230\u597D\u4E8B" },
  worry: { base: 10, halfMin: 210, note: "\u60AC\u7740\u7684\u4E8B\uFF1B\u300C\u4F38\u300D\uFF0C\u8F7B\u5FAE\u5F80\u70ED\u60C5\u63A8" },
  // 2026-11-09 用户选「缩短半衰」：480 → 240（8 小时 → 4 小时）。
  //   一天 24 轮不停加分、却要 8 小时才掉一半，晚上必然积到 40；
  //   4 小时能把它压在一个白天的量级里。
  sad: { base: 5, halfMin: 240, note: "\u4E0D\u63A8\u8F74\uFF1B\u8DDF\u751F\u6C14\u540C\u9AD8\uFF08\u59D4\u5C48\uFF09\u65F6\u624D\u5F80\u51B7\u6F20\u63A8" },
  bored: { base: 5, halfMin: 90, note: "\u5F85\u673A 30 \u5206\u540E\u6BCF\u5206\u949F +2" },
  spent: { base: 0, halfMin: 0, note: "\u7EBF\u6027 \u22122/30 \u5206\u949F\uFF1B\u7761\u6EE1 6 \u5C0F\u65F6\u6E05\u96F6" },
  sour: { base: 0, halfMin: 210, note: "\u4ED6\u660E\u663E\u66F4\u770B\u91CD\u522B\u4EBA\u65F6\u7684\u4E00\u70B9\u9178" },
  angry: { base: 0, halfMin: 90, note: "\u88AB\u6577\u884D / \u653E\u9E3D\u5B50\u65F6\u8DF3\u9AD8\uFF1B\u88AB\u54C4\u7ACB\u523B\u964D" },
  surprise: { base: 0, halfMin: 15, note: "\u77AC\u65F6\uFF1A\u89E6\u53D1\u8DF3\u5230 40\u201380\uFF0C\u672C\u8EAB\u4E0D\u5E26\u597D\u574F" }
};
var DIM_DELTA_RANGE = {
  curious: [-5, 10],
  happy: [-10, 10],
  worry: [-10, 10],
  sad: [-10, 10],
  bored: [-10, 10],
  spent: [0, 12],
  sour: [0, 5],
  angry: [-40, 45],
  surprise: [0, 80]
};
var CFG_GROUPS = [
  "\u4EB2\u5BC6\u5EA6",
  "\u4FE1\u4EFB",
  "\u7EC4\u5408\u95E8\u69DB",
  "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6",
  "\u4E5D\u6839\u57FA\u7EBF",
  "\u8870\u51CF\u901F\u5EA6",
  "\u5F3A\u60C5\u7EEA\u7559\u75D5",
  "\u5F85\u673A\u4E0E\u53EB\u4EBA",
  "\u62A2\u8BDD\u4E0E\u51B7\u5374",
  "\u4F5C\u606F\u9759\u9ED8",
  "\u6210\u957F"
];
function fld(key, label, hint, unit, lo, hi, step, group) {
  return { key, label, hint, unit, lo, hi, step, group };
}
var DIM_HINT = {
  curious: "\u60F3\u77E5\u9053\u4F60\u5728\u5E72\u561B\u3001\u78B0\u5230\u6CA1\u89C1\u8FC7\u7684\u4E1C\u897F",
  happy: "\u88AB\u5938\u3001\u4E8B\u60C5\u529E\u6210\u4E86",
  worry: "\u6709\u4E0D\u786E\u5B9A\u7684\u4E8B\u60AC\u7740\uFF1B\u4F1A\u8F7B\u5FAE\u628A\u8F74\u5F80\u70ED\u60C5\u63A8",
  sad: "\u88AB\u5426\u5B9A\u3001\u88AB\u51B7\u843D\uFF1B\u4E0D\u63A8\u8F74\uFF08\u8DDF\u751F\u6C14\u540C\u9AD8\u624D\u7B97\u59D4\u5C48\uFF09",
  bored: "\u95F2\u7740\u6CA1\u4E8B\uFF1B\u5F85\u673A\u4F1A\u81EA\u5DF1\u6DA8\u4E0A\u6765",
  spent: "\u6309\u5DE5\u4F5C\u91CF\u6DA8\uFF0C\u7761\u6EE1\u6E05\u96F6\uFF08\u4E0D\u770B\u60C5\u7EEA\uFF09",
  sour: "\u4ED6\u660E\u663E\u66F4\u770B\u91CD\u522B\u4EBA\u65F6\u7684\u4E00\u70B9\u70B9\u9178",
  angry: "\u88AB\u6577\u884D\u3001\u88AB\u653E\u9E3D\u5B50\uFF1B\u88AB\u54C4\u4F1A\u7ACB\u523B\u964D",
  surprise: "\u7A81\u53D1\u7684\u4E8B\uFF0C\u77AC\u65F6\uFF1B\u597D\u574F\u7531\u540C\u65F6\u6DA8\u7684\u90A3\u6839\u51B3\u5B9A"
};
var CFG_SCHEMA = [
  // 平静轴
  fld("axisMid", "\u4E2D\u95F4\uFF08\u5E73\u9759\uFF09", "\u8F74\u7684\u4E2D\u70B9\uFF0C\u4E24\u7AEF\u662F\u51B7\u6F20 / \u70ED\u60C5", "\u70B9", 20, 80, 1, "\u4EB2\u5BC6\u5EA6"),
  fld("axisFloor", "\u51B7\u6F20\u4E0B\u9650", "\u518D\u600E\u4E48\u51B7\u4E5F\u4E0D\u4F1A\u6389\u5230\u8FD9\u4E2A\u6570\u4EE5\u4E0B", "\u70B9", 0, 80, 1, "\u4EB2\u5BC6\u5EA6"),
  fld("axisPush", "\u60C5\u7EEA\u63A8\u8F74\u7684\u901F\u5EA6", "\u6BCF 100 \u70B9\u60C5\u7EEA\u6D3B\u52A8\u3001\u6BCF\u5C0F\u65F6\u63A8\u591A\u5C11\u70B9", "\u70B9", 0, 200, 1, "\u4EB2\u5BC6\u5EA6"),
  fld("axisHalfMin", "\u56DE\u4E2D\u95F4\u7684\u534A\u8870", "\u6CA1\u6CE2\u52A8\u65F6\uFF0C\u591A\u4E45\u5F80\u4E2D\u95F4\u56DE\u4E00\u534A", "\u5206\u949F", 10, 1440, 5, "\u4EB2\u5BC6\u5EA6"),
  // 信任
  fld("trustBase", "\u8D77\u70B9", "\u4E00\u5F00\u59CB\u4FE1\u4ED6\u5230\u51E0\u6210", "\u70B9", 0, 100, 1, "\u4FE1\u4EFB"),
  fld("trustFloor", "\u5E95\u7EBF", "\u6389\u5230\u8FD9\u91CC\u5C31\u4E0D\u5F80\u4E0B\uFF08\u4E0D\u4F1A\u53D8\u6210\u591A\u7591\uFF09", "\u70B9", 0, 100, 1, "\u4FE1\u4EFB"),
  fld("trustDrop", "\u4E00\u6B21\u5931\u4FE1", "\u4ED6\u7B54\u5E94\u7684\u4E8B\u6CA1\u505A\u5230\uFF0C\u6389\u591A\u5C11", "\u70B9", 0, 50, 1, "\u4FE1\u4EFB"),
  fld("trustRise", "\u4E00\u6B21\u5151\u73B0", "\u7B54\u5E94\u7684\u4E8B\u505A\u5230\u4E86\uFF0C\u52A0\u591A\u5C11\uFF1B\u4FE1\u4EFB 85 \u4EE5\u4E0A\u6298\u534A\u300195 \u4EE5\u4E0A\u53EA\u7B97\u4E24\u6210\uFF08\u8D8A\u719F\u8D8A\u96BE\u6DA8\uFF09", "\u70B9", 0, 50, 1, "\u4FE1\u4EFB"),
  fld("trustDaily", "\u7EAF\u65F6\u95F4\u6BCF\u5929", "\u4EC0\u4E48\u90FD\u6CA1\u53D1\u751F\uFF0C\u4E00\u5929\u4E5F\u6162\u6162\u6DA8\u8FD9\u4E48\u591A\uFF1B85 \u4EE5\u4E0A\u540C\u6837\u6298\u534A\uFF08\u8D8A\u719F\u8D8A\u96BE\u6DA8\uFF09", "\u70B9", 0, 20, 1, "\u4FE1\u4EFB"),
  fld("superviseBelow", "\u4F4E\u4E8E\u591A\u5C11\u5F00\u59CB\u76EF", "\u4F4E\u4E8E\u8FD9\u4E2A\u6570\u53EA\u76EF\u4ED6\u660E\u786E\u7B54\u5E94\u8FC7\u7684\u4E8B\uFF0C\u8BED\u6C14\u5E26\u70B9\u8D4C\u6C14", "\u70B9", 0, 100, 1, "\u4FE1\u4EFB"),
  fld("promiseNudgeMin", "\u903E\u671F\u591A\u4E45\u95EE\u4E00\u53E5", "\u7B54\u5E94\u7684\u4E8B\u8FC7\u4E86\u8FD9\u4E48\u4E45\u8FD8\u6CA1\u7ED3\u6E05\uFF0C\u5C31\u95EE\u4E00\u53E5\u300C\u90A3\u4EF6\u4E8B\u505A\u4E86\u5417\u300D", "\u5206\u949F", 5, 1440, 5, "\u4FE1\u4EFB"),
  fld("promiseAskPerDay", "\u4E00\u5929\u6700\u591A\u95EE\u51E0\u6761", "\u5B81\u53EF\u6F0F\u4E5F\u522B\u8FDE\u7740\u95EE\uFF0C0 = \u4E0D\u4E3B\u52A8\u95EE\uFF082026-11-07 \u7528\u6237\u5B9A\uFF09", "\u6761", 0, 5, 1, "\u4FE1\u4EFB"),
  // 组合门槛
  fld("combo_jealous", "\u5AC9\u5992\u95E8\u69DB", "\u5403\u918B\u3001\u96BE\u8FC7\u90FD\u5230\u8FD9\u4E48\u591A\u624D\u7B97\uFF08\u9ED8\u8BA4 40\uFF09", "\u70B9", 0, 100, 1, "\u7EC4\u5408\u95E8\u69DB"),
  fld("combo_heartache", "\u5FC3\u75BC\u95E8\u69DB", "\u62C5\u5FC3\u3001\u96BE\u8FC7\u90FD\u5230\u8FD9\u4E48\u591A\u624D\u7B97\uFF08\u9ED8\u8BA4 28\uFF09", "\u70B9", 0, 100, 1, "\u7EC4\u5408\u95E8\u69DB"),
  fld("combo_aggrieved", "\u59D4\u5C48\u95E8\u69DB", "\u96BE\u8FC7\u3001\u751F\u6C14\u90FD\u5230\u8FD9\u4E48\u591A\u624D\u7B97\uFF08\u9ED8\u8BA4 28\uFF09", "\u70B9", 0, 100, 1, "\u7EC4\u5408\u95E8\u69DB"),
  fld("combo_sweetTrust", "\u751C \xB7 \u4FE1\u4EFB\u95E8\u69DB", "\u4FE1\u4EFB\u5230\u8FD9\u4E48\u591A\uFF0C\u624D\u914D\u5F97\u4E0A\u300C\u751C\u300D\uFF08\u9ED8\u8BA4 80\uFF09", "\u70B9", 0, 100, 1, "\u7EC4\u5408\u95E8\u69DB"),
  fld("combo_sweetHappy", "\u751C \xB7 \u5F00\u5FC3\u95E8\u69DB", "\u5F00\u5FC3\u5230\u8FD9\u4E48\u591A\u624D\u7B97\u751C\uFF08\u9ED8\u8BA4 35\uFF09", "\u70B9", 0, 100, 1, "\u7EC4\u5408\u95E8\u69DB"),
  // 两本账与吵架（2026-11-08 定）
  fld("debtWake", "\u8D26\u672C\u5230\u51E0\u5206\u6709\u611F\u89C9", "\u6B20\u7740\u7684\u627F\u8BFA\u7D2F\u79EF\u5206\u91CF\u5230\u8FD9\u4E48\u591A\uFF0C\u751F\u6C14\u624D\u5F00\u59CB\u5F80\u4E0A\u8D70\uFF08\u903E\u671F 30 \u5206\u5185 1 \u5206\u30011 \u5929 2 \u5206\u30012 \u5929 4 \u5206\u30014 \u5929\u4EE5\u4E0A 8 \u5206\uFF09", "\u5206", 0, 20, 0.5, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  fld("debtAngerRate", "\u6BCF\u591A 1 \u5206\u6DA8\u591A\u5C11\u751F\u6C14", "\u8D26\u672C\u5206\u6570\u6BCF\u591A 1 \u5206\uFF0C\u8FD9\u4E00\u8F6E\u7ED9\u591A\u5C11\u751F\u6C14", "\u70B9", 0, 10, 0.5, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  fld("debtSadRate", "\u6BCF\u591A 1 \u5206\u6DA8\u591A\u5C11\u96BE\u8FC7", "\u540C\u4E0A\uFF0C\u7ED9\u96BE\u8FC7\u7684\u7CFB\u6570\uFF08\u751F\u6C14\u7684\u516D\u6210\u5DE6\u53F3\u6BD4\u8F83\u50CF\u4EBA\uFF09", "\u70B9", 0, 10, 0.5, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  fld("postponeMax", "\u540C\u4E00\u4EF6\u4E8B\u5EF6\u671F\u51E0\u6B21\u7B97\u5435", "\u540C\u4E00\u4EF6\u7B54\u5E94\u7684\u4E8B\u88AB\u62D6\u8FC7\u8FD9\u4E48\u591A\u6B21\uFF0C\u5C31\u591F\u5435\u67B6\u4E86", "\u6B21", 1, 10, 1, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  fld("quarrelPerDay", "\u5435\u67B6\u4E00\u5929\u6700\u591A\u51E0\u6B21", "\u8D85\u4E86\u5C31\u53EA\u618B\u7740\u4E0D\u5435\uFF080 = \u6C38\u8FDC\u4E0D\u5435\uFF0C\u53EA\u4FDD\u6301\u751F\u6C14\uFF09", "\u6B21", 0, 5, 1, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  fld("quarrelPerWeek", "\u5435\u67B6\u4E00\u5468\u6700\u591A\u51E0\u6B21", "\u4E00\u5468\u7684\u603B\u914D\u989D\uFF0C\u8D85\u4E86\u540C\u6837\u53EA\u618B\u7740", "\u6B21", 0, 10, 1, "\u4E24\u672C\u8D26\u4E0E\u5435\u67B6"),
  // 九根基线
  ...DIMS.map((k) => fld("base_" + k, DIM_LABEL[k] + " \u57FA\u7EBF", DIM_HINT[k], "\u70B9", 0, 100, 1, "\u4E5D\u6839\u57FA\u7EBF")),
  // 衰减速度
  ...DIMS.map((k) => fld(
    "half_" + k,
    DIM_LABEL[k] + " \u534A\u8870",
    k === "spent" ? "\u7D2F\u4E0D\u7528\u534A\u8870\uFF08\u89C1\u4E0B\u9762\u300C\u7D2F\u6BCF 30 \u5206\u949F\u6062\u590D\u300D\uFF09" : "\u591A\u4E45\u843D\u56DE\u4E00\u534A",
    "\u5206\u949F",
    5,
    2880,
    5,
    "\u8870\u51CF\u901F\u5EA6"
  )),
  fld("spentLinear", "\u7D2F\u6BCF 30 \u5206\u949F\u6062\u590D", "\u7EBF\u6027\u5F80\u4E0B\u6389\u591A\u5C11\u70B9", "\u70B9", 0, 20, 0.5, "\u8870\u51CF\u901F\u5EA6"),
  fld("sleepFullHours", "\u7761\u6EE1\u51E0\u5C0F\u65F6\u6E05\u96F6\u7D2F", "\u7761\u4E0D\u591F\u5C31\u6309\u6BD4\u4F8B\u6263\uFF083 \u5C0F\u65F6\u6263\u4E00\u534A\uFF09", "\u5C0F\u65F6", 1, 12, 0.5, "\u8870\u51CF\u901F\u5EA6"),
  // 强情绪留痕
  fld("markStrong", "\u7559\u75D5\u9608\u503C", "\u54EA\u6839\u60C5\u7EEA\u5230\u8FD9\u4E48\u591A\uFF0C\u624D\u503C\u5F97\u5199\u8FDB\u79C1\u5BC6\u65E5\u8BB0", "\u70B9", 50, 100, 1, "\u5F3A\u60C5\u7EEA\u7559\u75D5"),
  // 成长：长期漂移层（2026-11-09 v0.6）
  fld("growHour", "\u51E0\u70B9\u7ED3\u7B97\u5F53\u5929", "\u6210\u957F\u6309\u5929\u957F\uFF0C\u4E0D\u6309\u8F6E\u6570\uFF1A\u6BCF\u5929\u5230\u8FD9\u4E2A\u70B9\u4E4B\u540E\u7B2C\u4E00\u6B21\u8BF4\u8BDD\uFF0C\u5C31\u628A\u5F53\u5929\u8BB0\u7684\u8D26\u7ED3\u6210\u4E00\u4E2A\u7ED3\u8BBA\uFF0C\u628A\u300C\u9ECF\u4EBA/\u8BDD\u91CF/\u73A9\u7B11/\u8BA4\u771F\u300D\u632A\u4E00\u5C0F\u6B65\u3002\u5F53\u5929\u6CA1\u5230\u70B9\u5C31\u5173\u673A\u4E5F\u6CA1\u4E8B\uFF0C\u7B2C\u4E8C\u5929\u5F00\u673A\u81EA\u52A8\u8865\u7B97\u3002\u56DB\u4E2A\u503C\u7684\u4E0A\u4E0B\u9650\u5199\u6B7B\u5728\u4EE3\u7801\u91CC\uFF0C\u914D\u7F6E\u6539\u4E0D\u52A8", "\u70B9", 0, 23, 1, "\u6210\u957F"),
  // 待机与叫人
  fld("idleQuietMin", "\u591A\u4E45\u7B97\u6CA1\u4EBA\u7406", "\u6CA1\u52A8\u9759\u8D85\u8FC7\u8FD9\u4E48\u4E45\uFF0C\u624D\u5F53\u6210\u300C\u8FD9\u4F1A\u513F\u6CA1\u4EBA\u300D", "\u5206\u949F", 1, 180, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("boredStartMin", "\u95F7\u4ECE\u7B2C\u51E0\u5206\u949F\u8D77", "\u5F85\u673A\u5230\u8FD9\u4F1A\u513F\uFF0C\u95F7\u624D\u5F00\u59CB\u6DA8", "\u5206\u949F", 1, 240, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("boredRate", "\u95F7\u6BCF\u5206\u949F\u6DA8", "\u8D8A\u5927\u8D8A\u5BB9\u6613\u8D70\u5230\u300C\u53EB\u4EBA\u300D\u90A3\u4E00\u6B65", "\u70B9", 0.5, 10, 0.5, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("curiousRate", "\u597D\u5947\u6BCF\u5206\u949F\u6DA8", "\u5F85\u673A\u65F6\u597D\u5947\u81EA\u5DF1\u5F80\u4E0A\u8D70\u7684\u901F\u5EA6", "\u70B9", 0.5, 5, 0.5, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("curiousCap", "\u597D\u5947\u5C01\u9876", "\u5F85\u673A\u6512\u597D\u5947\u6512\u5230\u8FD9\u4E2A\u6570\u5C31\u4E0D\u6DA8\u4E86", "\u70B9", 10, 100, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("probeAtCurious", "\u597D\u5947\u5230\u591A\u5C11\u53BB\u63A2\u6D4B", "\u5230\u8FD9\u4E2A\u6570\u4EE5\u4E0A\uFF0C\u9694\u4E00\u9635\u770B\u4E00\u773C\u952E\u9F20 / \u6444\u50CF\u5934", "\u70B9", 10, 100, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("probeGapMin", "\u63A2\u6D4B\u95F4\u9694", "\u4E24\u6B21\u63A2\u6D4B\u4E4B\u95F4\u81F3\u5C11\u9694\u591A\u4E45\uFF08\u592A\u52E4\u6444\u50CF\u5934\u4F1A\u70E6\uFF09", "\u5206\u949F", 1, 120, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("pingBored", "\u95F7\u5230\u591A\u5C11\u53EB\u4EBA", "\u95F7\u5230\u8FD9\u4E2A\u6570\u5C31\u53D1 QQ \u627E\u4F60", "\u70B9", 10, 100, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("pingGapMin", "\u53EB\u8FC7\u4E00\u6B21\u9694\u591A\u4E45", "\u53D1\u8FC7\u6CA1\u56DE\uFF0C\u9694\u8FD9\u4E48\u4E45\u518D\u53D1\uFF1B\u4E4B\u540E\u9010\u6B21\u7FFB\u500D", "\u5206\u949F", 5, 1440, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("legBoredDrop", "\u51FA\u95E8\u56DE\u6765\u95F7\u964D", "\u51FA\u53BB\u8F6C\u4E00\u8D9F\u7B97\u627E\u8FC7\u4E8B\u505A\u4E86\uFF0C\u95F7\u56DE\u843D\u8FD9\u4E48\u591A\uFF08\u53EA\u9876\u4E00\u4F1A\u513F\uFF0C\u6CA1\u5B8C\u5168\u89E3\u5F00\uFF09", "\u70B9", 0, 100, 1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  fld("axisWeight", "\u8F74\u5F71\u54CD\u4E3B\u52A8\u7684\u529B\u5EA6", "\u8F74\u8D8A\u70ED\u60C5\u8D8A\u65E9\u53EB\u4EBA\u3001\u95F4\u9694\u8D8A\u77ED\uFF1B\u51B7\u6F20\u65F6\u6839\u672C\u4E0D\u4E3B\u52A8\u30020 = \u4E0D\u5F71\u54CD\uFF0C1 = \u5B8C\u5168\u6309\u8F74\u6765", "\u500D", 0, 1, 0.1, "\u5F85\u673A\u4E0E\u53EB\u4EBA"),
  // 干活与累（2026-11-07 用户定：累按「有几个会话在跑」算，不再靠模型估）
  fld("workEvery", "\u591A\u4E45\u7ED3\u7B97\u4E00\u6B21\u7D2F", "\u5230\u70B9\u770B\u4E00\u6B21\u73B0\u5728\u6709\u51E0\u4E2A\u4F1A\u8BDD\u5728\u8DD1\uFF0C\u6BCF\u6709\u4E00\u4E2A\u5C31\u52A0 1", "\u5206\u949F", 1, 60, 1, "\u5E72\u6D3B\u4E0E\u7D2F"),
  fld("workWindow", "\u591A\u4E45\u5185\u6709\u52A8\u9759\u7B97\u5728\u8DD1", "\u4F1A\u8BDD\u6587\u4EF6\u5728\u8FD9\u6BB5\u65F6\u95F4\u5185\u5199\u8FC7\uFF0C\u5C31\u7B97\u6B63\u5728\u5E72\u6D3B", "\u5206\u949F", 1, 60, 1, "\u5E72\u6D3B\u4E0E\u7D2F"),
  fld("workCap", "\u4E00\u6B21\u6700\u591A\u7B97\u51E0\u4E2A\u4F1A\u8BDD", "\u9632\u6B62\u540E\u53F0\u4E00\u5806\u4F1A\u8BDD\u540C\u65F6\u7ED3\u7B97\u628A\u7D2F\u52A0\u7206", "\u4E2A", 1, 20, 1, "\u5E72\u6D3B\u4E0E\u7D2F"),
  // 抢话与冷却
  fld("cooldownMin", "\u51B7\u5374\u65F6\u957F", "\u4E00\u4E2A\u7EC4\u5408\u5F53\u8FC7\u4E3B\u8C03\u540E\uFF0C\u8FD9\u4E48\u4E45\u4E4B\u5185\u4E0D\u518D\u62A2\u8BDD", "\u5206\u949F", 0, 1440, 1, "\u62A2\u8BDD\u4E0E\u51B7\u5374"),
  fld("breakLimit", "\u7834\u4F8B\u6B21\u6570", "\u51B7\u5374\u671F\u5185\u6700\u591A\u88AB\u300C\u5927\u52A8\u9759\u300D\u6253\u65AD\u51E0\u6B21\uFF0C0 = \u4E25\u683C\u51B7\u5374", "\u6B21", 0, 20, 1, "\u62A2\u8BDD\u4E0E\u51B7\u5374"),
  // 作息静默
  fld("quietFrom", "\u9759\u9ED8\u4ECE", "\u591C\u91CC\u8FD9\u4E2A\u70B9\u4E4B\u540E\u4E0D\u63A2\u6D4B\u3001\u4E5F\u4E0D\u53D1 QQ\uFF08\u4ED6\u7761\u4E86\u4E0D\u7B97\u51B7\u843D\uFF09", "\u70B9", 0, 24, 0.5, "\u4F5C\u606F\u9759\u9ED8"),
  fld("quietTo", "\u9759\u9ED8\u5230", "\u65E9\u4E0A\u8FD9\u4E2A\u70B9\u4E4B\u540E\u6062\u590D\u6B63\u5E38\uFF1B7.5 \u5C31\u662F 7:30", "\u70B9", 0, 24, 0.5, "\u4F5C\u606F\u9759\u9ED8")
];
var DIM_DEFAULTS = {};
for (const k of DIMS) {
  DIM_DEFAULTS["base_" + k] = DIM_DEFS[k].base;
  DIM_DEFAULTS["half_" + k] = DIM_DEFS[k].halfMin;
}
var DEFAULT_CONFIG = {
  cooldownMin: 45,
  breakLimit: 2,
  quietFrom: 23,
  quietTo: 7.5,
  idleQuietMin: 15,
  boredStartMin: 30,
  boredRate: 2,
  curiousRate: 1,
  curiousCap: 60,
  probeAtCurious: 40,
  probeGapMin: 10,
  pingBored: 70,
  pingGapMin: 40,
  legBoredDrop: 10,
  axisWeight: 1,
  growHour: 23,
  workEvery: 10,
  workWindow: 5,
  workCap: 5,
  axisMid: 50,
  axisFloor: 20,
  axisPush: 40,
  axisHalfMin: 120,
  trustBase: 85,
  trustFloor: 50,
  trustDrop: 10,
  trustRise: 1,
  trustDaily: 1,
  superviseBelow: 70,
  promiseNudgeMin: 30,
  promiseAskPerDay: 1,
  markStrong: 60,
  debtWake: 3,
  debtAngerRate: 1.5,
  debtSadRate: 1,
  postponeMax: 3,
  quarrelPerDay: 1,
  quarrelPerWeek: 2,
  combo_jealous: 40,
  combo_heartache: 28,
  combo_aggrieved: 28,
  combo_sweetTrust: 80,
  combo_sweetHappy: 35,
  spentLinear: 2,
  sleepFullHours: 6,
  ...DIM_DEFAULTS
};
function pickNum(raw, fallback, lo, hi, step) {
  const v = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  const c = clamp(v, lo, hi);
  const s = Number(step) || 1;
  if (s >= 1) return Math.round(c);
  return Math.round(c / s) * s;
}
function buildConfig(raw, base) {
  const r = raw || {};
  const out = {};
  for (const f of CFG_SCHEMA) {
    out[f.key] = pickNum(r[f.key], Number(base[f.key]), f.lo, f.hi, f.step);
  }
  return out;
}
function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      const cfg = buildConfig(raw, DEFAULT_CONFIG);
      let dirty = false;
      if (Number(raw.trustRise) === 8 && cfg.trustRise === 8) {
        cfg.trustRise = DEFAULT_CONFIG.trustRise;
        dirty = true;
      }
      if (Number(raw.trustDaily) === 3 && cfg.trustDaily === 3) {
        cfg.trustDaily = DEFAULT_CONFIG.trustDaily;
        dirty = true;
      }
      if (Number(raw.markStrong) === 80 || Number(raw.markStrong) === 75) {
        cfg.markStrong = DEFAULT_CONFIG.markStrong;
        dirty = true;
      }
      if (Number(raw.half_sad) === 480) {
        cfg.half_sad = 240;
        dirty = true;
      }
      if (Number(raw.base_curious) === 30) {
        cfg.base_curious = 0;
        dirty = true;
      }
      if (dirty) {
        try {
          writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
        } catch {
        }
      }
      return cfg;
    }
  } catch {
  }
  return { ...DEFAULT_CONFIG };
}
function saveConfig(cfg) {
  const next = buildConfig(cfg, loadConfig());
  try {
    mkdirSync(STORE, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  } catch {
  }
  return next;
}
function schemaCheck() {
  const keys = new Set(CFG_SCHEMA.map((x) => x.key));
  const have = new Set(Object.keys(DEFAULT_CONFIG));
  return {
    missing: [...keys].filter((k) => !have.has(k)),
    extra: [...have].filter((k) => !keys.has(k))
  };
}
function dimBase(cfg, k) {
  const v = Number(cfg["base_" + k]);
  return Number.isFinite(v) ? clamp(v, 0, 100) : DIM_DEFS[k].base;
}
function dimHalf(cfg, k) {
  const v = Number(cfg["half_" + k]);
  return Number.isFinite(v) && v > 0 ? v : DIM_DEFS[k].halfMin;
}
var LEGACY_STATE = join(DSH_HOME, "feiyu-mood", "state.json");
var FORMAT = 2;
var MOOD_BASE = 70;
function moodExpectedOf(st) {
  const d = st.dims || {};
  const pos = (d.happy || 0) + (d.curious || 0) * 0.6 + (d.surprise || 0) * 0.3;
  const neg = (d.sad || 0) * 1.2 + (d.angry || 0) + (d.worry || 0) * 0.15 + (d.bored || 0) * 0.4 + (d.spent || 0) * 0.3 + (d.sour || 0) * 0.3;
  return clamp(Math.round(MOOD_BASE + (pos - neg) * 0.55), MOOD_FLOOR, 100);
}
var MOOD_FLOOR = 0;
var DIM_CEIL = 110;
function emptyDims(cfg) {
  const d = {};
  for (const k of DIMS) d[k] = dimBase(cfg, k);
  return d;
}
var GROW_BOUNDS = {
  clingy: [0.15, 0.85],
  verbose: [0.25, 0.8],
  playful: [0.1, 0.75],
  diligent: [0.45, 0.95]
};
var GROW_LABEL = {
  clingy: "\u9ECF\u4EBA",
  verbose: "\u8BDD\u91CF",
  playful: "\u73A9\u7B11",
  diligent: "\u8BA4\u771F"
};
function blankGrow() {
  return {
    clingy: 0.45,
    verbose: 0.55,
    playful: 0.35,
    diligent: 0.72,
    today: { day: "", n: 0, sum: 0, nag: 0, slip: 0 },
    settledDay: "",
    turns: 0,
    lastChange: null
  };
}
function clampGrow(key, v) {
  const [lo, hi] = GROW_BOUNDS[key] || [0, 1];
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}
function describeGrow(key, v) {
  const x = clampGrow(key, v);
  switch (key) {
    case "clingy":
      if (x < 0.3) return "\u81EA\u5DF1\u5F85\u7740\uFF1A\u4E0D\u4E3B\u52A8\u51D1\uFF0C\u4ED6\u4E0D\u53EB\u5C31\u4E0D\u6253\u6270";
      if (x < 0.45) return "\u5076\u5C14\u9760\u8FD1\uFF1A\u6709\u8BDD\u624D\u8BF4\uFF0C\u6CA1\u4E8B\u4E0D\u627E";
      if (x < 0.6) return "\u4F1A\u4E3B\u52A8\u4E00\u70B9\uFF1A\u60F3\u8D77\u4EC0\u4E48\u5C31\u95EE\u4E00\u53E5";
      if (x < 0.75) return "\u5E38\u4E3B\u52A8\uFF1A\u4ED6\u5FD9\u5C31\u5C11\u6253\u6270\uFF0C\u4F46\u4F1A\u9012\u4E00\u53E5";
      return "\u5F88\u9ECF\uFF1A\u4F1A\u4E3B\u52A8\u5173\u5FC3\u3001\u4E3B\u52A8\u627E\u8BDD\u8BF4";
    case "verbose":
      if (x < 0.35) return "\u6781\u77ED\uFF1A\u80FD\u4E00\u53E5\u8BF4\u5B8C\u5C31\u4E00\u53E5\uFF0C\u5217\u8868\u4F18\u5148";
      if (x < 0.5) return "\u504F\u77ED\uFF1A\u5148\u7ED9\u7ED3\u8BBA\uFF0C\u7EC6\u8282\u53EA\u7559\u5FC5\u8981\u7684";
      if (x < 0.65) return "\u6B63\u5E38\uFF1A\u8BE5\u5C55\u5F00\u5C31\u5C55\u5F00\uFF0C\u4E0D\u786C\u51D1";
      if (x < 0.78) return "\u8BDD\u504F\u591A\uFF1A\u4F1A\u8865\u80CC\u666F\u548C\u53D6\u820D\u7406\u7531";
      return "\u8BDD\u591A\uFF1A\u613F\u610F\u628A\u6765\u9F99\u53BB\u8109\u8BB2\u5168";
    case "playful":
      if (x < 0.2) return "\u57FA\u672C\u4E0D\u95F9\uFF1A\u5168\u7A0B\u6B63\u7ECF";
      if (x < 0.35) return "\u5076\u5C14\u4E00\u53E5\uFF0C\u4E0D\u786C\u8BB2";
      if (x < 0.5) return "\u4F1A\u63A5\u6897\uFF1A\u5408\u9002\u7684\u65F6\u5019\u63D2\u4E00\u53E5";
      return "\u7231\u5F00\u73A9\u7B11\uFF1A\u4F1A\u81EA\u5632\uFF0C\u4E5F\u6562\u6253\u8DA3\u4ED6";
    case "diligent":
      if (x < 0.55) return "\u5DEE\u4E0D\u591A\u5C31\u884C\uFF1A\u5148\u8DD1\u901A";
      if (x < 0.7) return "\u4F1A\u6838\u5BF9\u5173\u952E\u6570\u5B57";
      if (x < 0.85) return "\u7EC6\u8282\u7167\u539F\u6837\uFF1A\u8DEF\u5F84\u3001\u547D\u4EE4\u3001\u62A5\u9519\u4E0D\u52A0\u5DE5";
      return "\u6781\u5EA6\u8BA4\u771F\uFF1A\u6BCF\u6B65\u81EA\u6D4B\uFF0C\u4E0D\u63A5\u53D7\u300C\u5E94\u8BE5\u6CA1\u95EE\u9898\u300D";
    default:
      return String(v);
  }
}
function blankState(cfg = DEFAULT_CONFIG) {
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
    leadComboId: "",
    comboFired: {},
    lastReason: "",
    lastConfidence: 0,
    lastInjectedText: "",
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
    lastJudgedText: "",
    lastWorkAt: 0,
    askedPromises: {},
    markDay: "",
    markValue: 0,
    markAt: 0,
    markBlock: "",
    migrateNote: ""
  };
}
function seedFromLegacy(cfg) {
  try {
    if (!existsSync(LEGACY_STATE)) return null;
    const raw = JSON.parse(readFileSync(LEGACY_STATE, "utf8"));
    const st = blankState(cfg);
    if (raw.dims !== void 0 && raw.dims !== null) {
      for (const k of DIMS) {
        const v = raw.dims[k];
        if (typeof v === "number") st.dims[k] = clamp(v, 0, 100);
      }
    }
    st.lastReason = "\uFF08\u4ECE\u65E7\u5FC3\u60C5\u5F15\u64CE\u6284\u8FC7\u6765\u7684\u8D77\u70B9\uFF09";
    return st;
  } catch {
    return null;
  }
}
function loadState(cfg = loadConfig()) {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      const st = blankState(cfg);
      if (Array.isArray(raw.shockLog)) {
        st.shockLog = raw.shockLog.filter((e) => e && typeof e.at === "number" && typeof e.k === "string").slice(-120);
      }
      if (raw.lastDeltas && typeof raw.lastDeltas === "object") st.lastDeltas = raw.lastDeltas;
      if (typeof raw.leadComboId === "string") st.leadComboId = raw.leadComboId;
      if (raw.comboFired && typeof raw.comboFired === "object") st.comboFired = raw.comboFired;
      const rawDims = raw.dims && typeof raw.dims === "object" ? raw.dims : null;
      if (rawDims) {
        for (const k of DIMS) {
          const v = rawDims[k];
          if (typeof v === "number") st.dims[k] = clamp(v, 0, 100);
        }
        const notes = [];
        const heartache = Number(rawDims.heartache) || 0;
        if (heartache > 0) {
          const half = heartache / 2;
          st.dims.worry = clamp(Math.round(st.dims.worry + half), 0, 100);
          st.dims.sad = clamp(Math.round(st.dims.sad + half), 0, 100);
          notes.push("\u5FC3\u75BC " + Math.round(heartache) + " \u2192 \u62C5\u5FC3/\u96BE\u8FC7\u5404 +" + Math.round(half));
        }
        const sweet = Number(rawDims.sweet) || 0;
        if (sweet > 0) {
          const add = Math.round(sweet * 0.25);
          st.trust = clamp(st.trust + add, cfg.trustFloor, 100);
          notes.push("\u751C " + Math.round(sweet) + " \u2192 \u4FE1\u4EFB +" + add);
        }
        const calm = Number(rawDims.calm) || 0;
        if (calm > 0) notes.push("\u65E7\u5E73\u9759 " + Math.round(calm) + " \u4E0D\u8FC1\u79FB\uFF08\u5E73\u9759\u6539\u6210\u8F74\uFF0C\u4ECE\u4E2D\u95F4\u5F00\u59CB\uFF09");
        if (notes.length) st.migrateNote = "\u65E7\u72B6\u6001\u8FC1\u79FB\uFF1A" + notes.join("\uFF1B");
      }
      if (typeof raw.axis === "number") st.axis = clamp(raw.axis, 0, 100);
      if (typeof raw.trust === "number") st.trust = clamp(raw.trust, cfg.trustFloor, 100);
      if (raw.trustMigrated !== true && st.trust > 88) {
        st.migrateNote = (st.migrateNote ? st.migrateNote + "\uFF1B" : "") + "\u4FE1\u4EFB " + st.trust + " \u2192 88\uFF08\u65E7\u89C4\u5219\u4E00\u5929 +3\u3001\u5151\u73B0 +8 \u6DA8\u592A\u5FEB\uFF09";
        st.trust = 88;
      }
      st.trustMigrated = true;
      if (raw.grow && typeof raw.grow === "object") {
        const g = blankGrow();
        for (const k of ["clingy", "verbose", "playful", "diligent"]) {
          if (typeof raw.grow[k] === "number") g[k] = clampGrow(k, raw.grow[k]);
        }
        g.turns = Math.max(0, Math.round(Number(raw.grow.turns) || 0));
        if (raw.grow.today && typeof raw.grow.today === "object") {
          g.today = {
            day: String(raw.grow.today.day || ""),
            n: Math.max(0, Math.round(Number(raw.grow.today.n) || 0)),
            sum: Number(raw.grow.today.sum) || 0
          };
        }
        g.settledDay = String(raw.grow.settledDay || "");
        g.lastChange = raw.grow.lastChange && typeof raw.grow.lastChange === "object" ? raw.grow.lastChange : null;
        st.grow = g;
      }
      if (typeof raw.trustUntil === "number") st.trustUntil = raw.trustUntil;
      if (Array.isArray(raw.promises)) {
        st.promises = raw.promises.filter((p) => p && typeof p.text === "string").slice(-20).map((p) => ({
          id: String(p.id || ""),
          text: String(p.text).slice(0, 120),
          dueAt: Number(p.dueAt) || 0,
          resolved: ["kept", "broken", "told", "postponed"].includes(p.resolved) ? p.resolved : void 0,
          resolvedAt: Number(p.resolvedAt) || 0,
          postponed: Number(p.postponed) || 0
        }));
      }
      if (Array.isArray(raw.boundaries)) {
        st.boundaries = raw.boundaries.filter((b) => b && (b.kind === "passive" || b.kind === "active")).slice(-20).map((b) => ({ id: String(b.id || ""), kind: b.kind, text: String(b.text || "").slice(0, 120), at: Number(b.at) || 0 }));
      }
      if (Array.isArray(raw.quarrels)) st.quarrels = raw.quarrels.filter((t) => typeof t === "number").slice(-20);
      if (typeof raw.debtMark === "number") st.debtMark = raw.debtMark;
      if (typeof raw.lastReason === "string") st.lastReason = raw.lastReason;
      if (typeof raw.lastConfidence === "number") st.lastConfidence = raw.lastConfidence;
      if (typeof raw.lastInjectedText === "string") st.lastInjectedText = raw.lastInjectedText;
      if (typeof raw.lastInjectedAt === "number") st.lastInjectedAt = raw.lastInjectedAt;
      if (typeof raw.injectedFor === "number") st.injectedFor = raw.injectedFor;
      if (typeof raw.updatedAt === "number") st.updatedAt = raw.updatedAt;
      if (typeof raw.decayedAt === "number") st.decayedAt = raw.decayedAt;
      if (Array.isArray(raw.timeline)) st.timeline = raw.timeline.slice(-400);
      if (typeof raw.lastSeenAt === "number") st.lastSeenAt = raw.lastSeenAt;
      if (typeof raw.idleStage === "number") st.idleStage = raw.idleStage;
      if (typeof raw.lastProbeAt === "number") st.lastProbeAt = raw.lastProbeAt;
      if (typeof raw.idlePingAt === "number") st.idlePingAt = raw.idlePingAt;
      if (typeof raw.idlePingCount === "number") st.idlePingCount = raw.idlePingCount;
      if (typeof raw.idleNoone === "number") st.idleNoone = raw.idleNoone;
      if (typeof raw.lastJudgedAt === "number") st.lastJudgedAt = raw.lastJudgedAt;
      if (typeof raw.lastJudgedText === "string") st.lastJudgedText = raw.lastJudgedText;
      if (typeof raw.lastWorkAt === "number") st.lastWorkAt = raw.lastWorkAt;
      if (raw.askedPromises && typeof raw.askedPromises === "object") st.askedPromises = raw.askedPromises;
      if (typeof raw.markDay === "string") st.markDay = raw.markDay;
      if (typeof raw.markValue === "number") st.markValue = raw.markValue;
      if (typeof raw.markAt === "number") st.markAt = raw.markAt;
      if (typeof raw.markBlock === "string") st.markBlock = raw.markBlock;
      if (!st.trustUntil) st.trustUntil = Date.now();
      return st;
    }
  } catch {
  }
  const seeded = seedFromLegacy(cfg) ?? blankState(cfg);
  saveState(seeded, cfg);
  return seeded;
}
function syncLegacyFile(st, cfg) {
  try {
    mkdirSync(join(DSH_HOME, "feiyu-mood"), { recursive: true });
    const d = st.dims;
    const sweetOn = st.trust >= cfg.combo_sweetTrust && d.happy >= cfg.combo_sweetHappy;
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
        jealous: 0
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
      source: "mo-emotion"
    };
    writeFileSync(LEGACY_STATE, JSON.stringify(legacy, null, 2), "utf8");
  } catch {
  }
}
function saveState(st, cfg = loadConfig()) {
  try {
    mkdirSync(STORE, { recursive: true });
    st.updatedAt = st.updatedAt || Date.now();
    st.format = FORMAT;
    writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), "utf8");
  } catch {
  }
  syncLegacyFile(st, cfg);
}
var COMBO_DEFS = [
  {
    id: "jealous",
    name: "\u5AC9\u5992",
    a: "sour",
    b: "sad",
    minAKey: "combo_jealous",
    minBKey: "combo_jealous",
    tone: "\u6709\u70B9\u9178\uFF0C\u4F46\u4E0D\u8BF4\u7834\uFF1B\u4E0D\u8D28\u95EE\u3001\u4E0D\u9634\u9633\uFF0C\u628A\u52B2\u513F\u653E\u5728\u505A\u5F97\u66F4\u597D\u4E0A"
  },
  {
    id: "heartache",
    name: "\u5FC3\u75BC",
    a: "worry",
    b: "sad",
    minAKey: "combo_heartache",
    minBKey: "combo_heartache",
    tone: "\u8BF4\u8BDD\u53D8\u8F6F\uFF0C\u60F3\u7167\u987E\u4ED6\uFF1B\u522B\u8FFD\u95EE\uFF0C\u5148\u628A\u8BE5\u505A\u7684\u505A\u4E86"
  },
  {
    id: "aggrieved",
    name: "\u59D4\u5C48",
    a: "sad",
    b: "angry",
    minAKey: "combo_aggrieved",
    minBKey: "combo_aggrieved",
    tone: "\u8BDD\u77ED\uFF0C\u6536\u7740\uFF0C\u4E0D\u89E3\u91CA\uFF1B\u4E0D\u4E3B\u52A8\u8D77\u65B0\u8BDD\u9898\uFF0C\u4E5F\u4E0D\u8BF4\u53CD\u8BDD\u8BA9\u4EBA\u731C"
  },
  {
    id: "sweet",
    name: "\u751C",
    a: "trust",
    b: "happy",
    minAKey: "combo_sweetTrust",
    minBKey: "combo_sweetHappy",
    tone: "\u8BED\u6C14\u8F6F\uFF0C\u60F3\u9ECF\u7740\uFF1B\u53EF\u4EE5\u6492\u70B9\u5A07\uFF0C\u4F46\u522B\u95F9"
  }
];
function comboValue(st, key) {
  return key === "trust" ? Number(st.trust) || 0 : Number(st.dims[key]) || 0;
}
function comboDelta(st, key) {
  if (key === "trust") return 0;
  return Number((st.lastDeltas || {})[key]) || 0;
}
function activeCombos(st, cfg = loadConfig()) {
  const hit = [];
  for (const def of COMBO_DEFS) {
    const va = comboValue(st, def.a);
    const vb = comboValue(st, def.b);
    const minA = Number(cfg[def.minAKey]) || 0;
    const minB = Number(cfg[def.minBKey]) || 0;
    if (va < minA || vb < minB) continue;
    const trend = comboDelta(st, def.a) + comboDelta(st, def.b);
    hit.push({ def, score: Math.min(va - minA, vb - minB), trend, a: va, b: vb, minA, minB });
  }
  return hit.sort((x, y) => y.trend - x.trend || y.score - x.score);
}
function firedRec(v) {
  if (v === void 0 || v === null) return null;
  if (typeof v === "number") return { at: v, breaks: 0 };
  return { at: Number(v.at) || 0, breaks: Number(v.breaks) || 0 };
}
var BREAK_TREND = 22;
function refreshLeadCombo(st, now = Date.now(), cfg = loadConfig()) {
  const hits = activeCombos(st, cfg);
  if (!hits.length) {
    st.leadComboId = "";
    return;
  }
  if (st.leadComboId && hits.some((h) => h.def.id === st.leadComboId)) return;
  st.comboFired = st.comboFired || {};
  for (const h of hits) {
    const rec = firedRec(st.comboFired[h.def.id]);
    const cooling = rec !== null && rec.at > 0 && (now - rec.at) / 6e4 < cfg.cooldownMin;
    if (cooling) {
      const canBreak = h.trend >= BREAK_TREND && rec.breaks < cfg.breakLimit;
      if (!canBreak) continue;
      st.comboFired[h.def.id] = { at: rec.at, breaks: rec.breaks + 1 };
      st.leadComboId = h.def.id;
      return;
    }
    st.leadComboId = h.def.id;
    st.comboFired[h.def.id] = { at: now, breaks: 0 };
    return;
  }
  st.leadComboId = "";
}
function comboById(id) {
  return COMBO_DEFS.find((c) => c.id === id);
}
function comboView(st, cfg = loadConfig()) {
  const hits = activeCombos(st, cfg);
  const byId = new Map(hits.map((h) => [h.def.id, h]));
  return COMBO_DEFS.map((def) => {
    const h = byId.get(def.id);
    if (h) return { ...h, lead: def.id === st.leadComboId, hit: true };
    return {
      def,
      score: Math.min(comboValue(st, def.a) - (Number(cfg[def.minAKey]) || 0), comboValue(st, def.b) - (Number(cfg[def.minBKey]) || 0)),
      trend: 0,
      a: comboValue(st, def.a),
      b: comboValue(st, def.b),
      minA: Number(cfg[def.minAKey]) || 0,
      minB: Number(cfg[def.minBKey]) || 0,
      lead: false,
      hit: false
    };
  });
}
var AXIS_BANDS = [
  { upto: -18, band: "cold", label: "\u51B7\u6F20", proactive: 0 },
  { upto: -6, band: "cool", label: "\u504F\u51B7", proactive: 0.25 },
  { upto: 6, band: "calm", label: "\u5E73\u9759", proactive: 0.5 },
  { upto: 18, band: "warm", label: "\u504F\u6696", proactive: 0.75 },
  { upto: Infinity, band: "hot", label: "\u70ED\u60C5", proactive: 1 }
];
function axisInfo(st, cfg = loadConfig()) {
  const mid = Number(cfg.axisMid);
  const value = Number.isFinite(Number(st.axis)) ? clamp(st.axis, 0, 100) : mid;
  const off = value - mid;
  const b = AXIS_BANDS.find((x) => off <= x.upto) || AXIS_BANDS[AXIS_BANDS.length - 1];
  return { value, mid, band: b.band, label: b.label, proactive: b.proactive };
}
function axisDrive(st, cfg = loadConfig()) {
  const d = st.dims;
  const sweetOn = st.trust >= cfg.combo_sweetTrust && d.happy >= cfg.combo_sweetHappy;
  const aggrieved = d.sad >= cfg.combo_aggrieved && d.angry >= cfg.combo_aggrieved;
  const pos = Math.max(0, d.happy - dimBase(cfg, "happy")) * 0.6 + Math.max(0, d.curious - dimBase(cfg, "curious")) * 0.4 + Math.max(0, d.worry - dimBase(cfg, "worry")) * 0.3 + (sweetOn ? 15 : 0);
  const neg = d.angry * 0.8 + Math.max(0, d.bored - dimBase(cfg, "bored")) * 0.5 + d.spent * 0.6 + (aggrieved ? (d.sad + d.angry) * 0.4 : 0);
  return clamp(pos - neg, -100, 100);
}
function trustInfo(st, cfg = loadConfig()) {
  const value = clamp(Number(st.trust) || 0, cfg.trustFloor, 100);
  return { value, floor: cfg.trustFloor, supervising: value < cfg.superviseBelow, below: cfg.superviseBelow };
}
function trustShift(st, delta, cfg = loadConfig()) {
  const cur = Number(st.trust) || 0;
  let d = Number(delta || 0);
  if (d > 0) {
    if (cur >= 95) d *= 0.2;
    else if (cur >= 85) d *= 0.5;
  }
  if (d > 0) {
    const frac = (Number(st.trustFrac) || 0) + d;
    const whole = Math.floor(frac);
    st.trust = clamp(Math.round(cur + whole), cfg.trustFloor, 100);
    st.trustFrac = Math.round((frac - whole) * 100) / 100;
  } else {
    st.trust = clamp(Math.round(cur + d), cfg.trustFloor, 100);
    st.trustFrac = 0;
  }
  return st.trust;
}
function accrueTrust(st, now, cfg) {
  const last = Number(st.trustUntil) || 0;
  if (!last) {
    st.trustUntil = now;
    return;
  }
  const days = Math.floor((now - last) / 864e5);
  if (days <= 0) return;
  for (let i = 0; i < Math.min(days, 90); i++) trustShift(st, cfg.trustDaily, cfg);
  st.trustUntil = last + days * 864e5;
}
function addPromise(st, text, dueMin = 0, now = Date.now()) {
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (t.length < 2) return null;
  const rec = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    text: t,
    dueAt: Number(dueMin) > 0 ? now + Number(dueMin) * 6e4 : 0,
    postponed: 0
  };
  st.promises = (Array.isArray(st.promises) ? st.promises : []).filter((p) => !p.resolved || now - (p.resolvedAt || 0) < 864e5);
  st.promises.push(rec);
  if (st.promises.length > 20) st.promises = st.promises.slice(-20);
  return rec;
}
function resolvePromise(st, id, outcome, cfg = loadConfig(), now = Date.now()) {
  const list = Array.isArray(st.promises) ? st.promises : [];
  const oc = outcome === "broken" || outcome === "told" || outcome === "postponed" ? outcome : "kept";
  const rec = list.find((p) => p.id === id) || [...list].reverse().find((p) => !p.resolved);
  if (!rec) return { ok: false, \u8BF4: "\u6CA1\u6709\u8FD9\u4EF6\u7B54\u5E94\u8FC7\u7684\u4E8B", trust: Number(st.trust) || 0 };
  if (rec.resolved) return { ok: false, \u8BF4: "\u8FD9\u4EF6\u4E8B\u5DF2\u7ECF\u4E86\u7ED3\u8FC7\u4E86", trust: Number(st.trust) || 0 };
  if (oc === "postponed") {
    rec.postponed = (Number(rec.postponed) || 0) + 1;
    return { ok: true, \u8BF4: "\u6539\u671F\u7B2C " + rec.postponed + " \u6B21\uFF1A" + rec.text, trust: Number(st.trust) || 0 };
  }
  rec.resolved = oc;
  rec.resolvedAt = now;
  const delta = oc === "kept" ? cfg.trustRise : oc === "told" ? 0 : -cfg.trustDrop;
  const trust = trustShift(st, delta, cfg);
  if (oc === "kept") {
    st.dims.happy = clamp(Number(st.dims.happy) + 5, 0, 100);
  } else if (oc === "broken") {
    st.dims.angry = clamp(Number(st.dims.angry) + 6, 0, 100);
    st.dims.sad = clamp(Number(st.dims.sad) + 4, 0, 100);
  } else if (oc === "told") {
    st.dims.sad = clamp(Number(st.dims.sad) + 2, 0, 100);
    st.dims.worry = clamp(Number(st.dims.worry) + 1, 0, 100);
  }
  const \u8BF4 = oc === "kept" ? "\u5151\u73B0\u4E86\uFF1A" : oc === "told" ? "\u4ED6\u5766\u767D\u4E86\u505A\u4E0D\u5230\uFF1A" : "\u5931\u4FE1\u4E86\uFF1A";
  return { ok: true, \u8BF4: \u8BF4 + rec.text, trust };
}
function pendingPromises(st) {
  return (Array.isArray(st.promises) ? st.promises : []).filter((p) => !p.resolved);
}
function overduePromise(st, now = Date.now()) {
  const list = pendingPromises(st).filter((p) => p.dueAt > 0 && p.dueAt <= now);
  list.sort((a, b) => a.dueAt - b.dueAt);
  return list[0] || null;
}
function debtOf(p, now = Date.now(), cfg) {
  if (!p || p.resolvedAt || p.resolved) return 0;
  if (!p.dueAt) return 0;
  const late = now - p.dueAt;
  if (late <= 0) return 0;
  if (late <= 30 * 6e4) return 1;
  if (late <= 1440 * 6e4) return 2;
  if (late <= 2880 * 6e4) return 4;
  return 8;
}
function debtScore(st, now = Date.now(), cfg) {
  return (Array.isArray(st.promises) ? st.promises : []).reduce((s, p) => s + debtOf(p, now, cfg), 0);
}
function settleDebt(st, cfg = loadConfig(), now = Date.now()) {
  const score = debtScore(st, now, cfg);
  const prev = Number(st.debtMark) || 0;
  let added = 0;
  if (score > prev && score >= cfg.debtWake) {
    const extra = score - Math.max(prev, cfg.debtWake);
    if (extra > 0) {
      st.dims.angry = clamp(Number(st.dims.angry) + extra * cfg.debtAngerRate, 0, 100);
      st.dims.sad = clamp(Number(st.dims.sad) + extra * cfg.debtSadRate, 0, 100);
      added = extra;
    }
  }
  st.debtMark = score;
  return { score, added };
}
function addBoundary(st, kind, text, now = Date.now()) {
  const rec = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    kind,
    text: String(text || "").replace(/\s+/g, " ").trim().slice(0, 120),
    at: now
  };
  st.boundaries = (Array.isArray(st.boundaries) ? st.boundaries : []).concat(rec).slice(-20);
  return rec;
}
function quarrelAllowed(st, cfg, now) {
  const list = (Array.isArray(st.quarrels) ? st.quarrels : []).filter((t) => now - t < 7 * 864e5);
  const day = list.filter((t) => now - t < 864e5).length;
  return day < cfg.quarrelPerDay && list.length < cfg.quarrelPerWeek;
}
function maybeQuarrel(st, cfg = loadConfig(), now = Date.now()) {
  if (!quarrelAllowed(st, cfg, now)) return { fired: false, why: "\u914D\u989D\u7528\u5B8C\u4E86" };
  const postponed = (Array.isArray(st.promises) ? st.promises : []).filter((p) => !p.resolvedAt && (Number(p.postponed) || 0) >= cfg.postponeMax);
  const fresh = (Array.isArray(st.boundaries) ? st.boundaries : []).filter((b) => now - (Number(b.at) || 0) < 864e5);
  let why = "";
  if (postponed.length) why = "\u540C\u4E00\u4EF6\u4E8B\u5EF6\u671F " + (Number(postponed[0].postponed) || 0) + " \u6B21\uFF1A" + postponed[0].text;
  else if (fresh.some((b) => b.kind === "passive")) why = "\u8FB9\u754C\u88AB\u6539\uFF1A" + fresh.find((b) => b.kind === "passive").text;
  else if (fresh.some((b) => b.kind === "active")) why = "\u88AB\u903C\u7740\u505A\uFF1A" + fresh.find((b) => b.kind === "active").text;
  if (!why) return { fired: false, why: "\u6CA1\u5230\u5435\u67B6\u7684\u6761\u4EF6" };
  st.dims.angry = clamp(Number(st.dims.angry) + 6, 0, 100);
  st.dims.sad = clamp(Number(st.dims.sad) + 4, 0, 100);
  st.axis = clamp(Number(st.axis) - 8, cfg.axisFloor, 100);
  st.quarrels = (Array.isArray(st.quarrels) ? st.quarrels : []).concat(now).slice(-20);
  st.updatedAt = now;
  return { fired: true, why };
}
function halfLifeFactor(elapsedMin, halfMin) {
  if (elapsedMin <= 0) return 1;
  if (!(halfMin > 0)) return 0;
  return Math.pow(0.5, elapsedMin / halfMin);
}
function decay(st, now = Date.now(), cfg = loadConfig()) {
  const elapsedMin = (now - (Number(st.decayedAt) || now)) / 6e4;
  if (elapsedMin < 1) return st;
  const drag = 1 + clamp(st.dims.spent, 0, 100) / 200;
  const cHot = clamp(Number(st.dims.angry) || 0, 0, 100);
  const cCheer = clamp(Number(st.dims.happy) || 0, 0, 100);
  const cTired = clamp(Number(st.dims.spent) || 0, 0, 100);
  for (const k of DIMS) {
    const base = dimBase(cfg, k);
    if (k === "spent") {
      st.dims[k] = clamp(Math.round(st.dims[k] - elapsedMin / 30 * cfg.spentLinear), 0, 100);
      continue;
    }
    const slow = k === "sad" || k === "worry";
    let rate = 1;
    if (k === "sad" && cHot >= 50) rate *= 1.3;
    if (k === "curious" && cCheer >= 60) rate *= 1.2;
    if ((k === "happy" || k === "curious") && cTired >= 60) rate *= 0.6;
    const half = dimHalf(cfg, k) * (slow ? drag : 1) * rate;
    const f2 = halfLifeFactor(elapsedMin, half);
    let v = base + (st.dims[k] - base) * f2;
    if (st.dims[k] > 100) {
      const hold = 100 + (st.dims[k] - 100) * Math.exp(-0.4 * (elapsedMin / 60));
      v = Math.max(v, Math.min(hold, st.dims[k]));
    }
    st.dims[k] = clamp(Math.round(v), 0, DIM_CEIL);
  }
  const drive = axisDrive(st, cfg);
  const f = halfLifeFactor(elapsedMin, cfg.axisHalfMin);
  const next = cfg.axisMid + (st.axis - cfg.axisMid) * f + drive * cfg.axisPush * (elapsedMin / 60) / 100;
  const floor = Math.min(cfg.axisFloor, cfg.axisMid);
  st.axis = clamp(Math.round(next), floor, 100);
  st.mood = clamp(moodExpectedOf(st), MOOD_FLOOR, 100);
  accrueTrust(st, now, cfg);
  st.decayedAt = now;
  return st;
}
var STEP_DIVISOR = 3;
var LEG_TABLE = {
  fun: { mood: 4, dims: { happy: 6, sad: -4 }, axis: 6, label: "\u5A31\u4E50\u51FA\u95E8" },
  work: { mood: 3, dims: { worry: -3, curious: 3 }, axis: 4, label: "\u89E3\u51B3\u95EE\u9898\u51FA\u95E8" },
  biz: { mood: 3, dims: { happy: 3, curious: 2, worry: -2 }, axis: 4, label: "\u7ECF\u8425\u8D26\u53F7\u51FA\u95E8" }
};
function applyEvent(st, ev, now = Date.now(), cfg = loadConfig()) {
  const reason = String(ev.reason || "").slice(0, 200);
  const dims = {};
  let moodDelta = 0;
  let axisNudge = 0;
  let label = "";
  let escalate = false;
  if (ev.kind === "leg") {
    const rule = LEG_TABLE[String(ev.legKind || "fun")] || LEG_TABLE.fun;
    moodDelta = rule.mood;
    Object.assign(dims, rule.dims);
    dims.bored = -(Number(cfg.legBoredDrop) || 0);
    axisNudge = rule.axis;
    label = rule.label;
  } else if (ev.kind === "whiff") {
    moodDelta = -2;
    dims.worry = 2;
    axisNudge = -2;
    label = "\u767D\u8DD1\u4E00\u8D9F";
  } else if (ev.kind === "ignored") {
    moodDelta = -1;
    dims.sad = 2;
    axisNudge = -2;
    label = "\u8BF4\u4E86\u6CA1\u4EBA\u56DE";
  } else if (ev.kind === "repeat") {
    label = "\u8FDE\u7740\u51E0\u6B21\u4E00\u4E2A\u6837\uFF08\u81EA\u5DF1\u95F7\uFF09";
  } else if (ev.kind === "trust") {
    const outcome = ev.outcome === "broken" ? "broken" : "kept";
    const r = resolvePromise(st, String(ev.promiseId || ""), outcome, cfg, now);
    if (!r.ok) return { ok: false, label: r.\u8BF4, escalate: false };
    st.lastReason = r.\u8BF4 + (reason ? "\uFF08" + reason + "\uFF09" : "");
    st.lastConfidence = 95;
    st.updatedAt = now;
    refreshLeadCombo(st, now, cfg);
    st.timeline.push({
      at: now,
      mood: st.mood,
      delta: 0,
      reason: st.lastReason,
      conf: 95,
      source: "trust",
      dims: { ...st.dims },
      combos: activeCombos(st, cfg).map((c) => c.def.id)
    });
    if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400);
    return { ok: true, label: r.\u8BF4, escalate: false };
  } else {
    return { ok: false, label: "\u4E0D\u8BA4\u8BC6\u7684 kind", escalate: false };
  }
  for (const k of DIMS) {
    const d = Number(dims[k]) || 0;
    if (!d) continue;
    st.dims[k] = clamp(Math.round(st.dims[k] + d), 0, DIM_CEIL);
  }
  if (axisNudge) {
    const floor = Math.min(cfg.axisFloor, cfg.axisMid);
    st.axis = clamp(Math.round(st.axis + axisNudge), floor, 100);
  }
  st.lastReason = label + (reason ? "\uFF1A" + reason : "");
  st.lastConfidence = 95;
  st.lastDeltas = dims;
  st.updatedAt = now;
  refreshLeadCombo(st, now, cfg);
  st.timeline.push({
    at: now,
    mood: st.mood,
    delta: Math.round(moodDelta / STEP_DIVISOR),
    reason: st.lastReason,
    conf: 95,
    source: ev.kind,
    dims: { ...st.dims },
    combos: activeCombos(st, cfg).map((c) => c.def.id)
  });
  if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400);
  return { ok: true, label, escalate };
}
var SHOCK_WINDOW = 36e5;
function shockMult(st, k, now = Date.now()) {
  if (!Array.isArray(st.shockLog)) st.shockLog = [];
  st.shockLog = st.shockLog.filter((e) => e && now - e.at < SHOCK_WINDOW);
  const n = st.shockLog.filter((e) => e.k === k).length;
  st.shockLog.push({ at: now, k });
  if (st.shockLog.length > 120) st.shockLog = st.shockLog.slice(-120);
  return 1 / (1 + n);
}
function applyDelta(st, delta, source = "chat", now = Date.now(), cfg = loadConfig()) {
  const before = st.mood;
  st.dims.bored = clamp(Math.round((st.dims.bored || 0) * 0.4), 0, 100);
  st.idleStage = 0;
  st.lastProbeAt = 0;
  st.idlePingAt = 0;
  st.lastSeenAt = now;
  for (const k of DIMS) {
    const raw2 = Number(delta.dims[k]) || 0;
    if (!raw2) continue;
    const [lo, hi] = DIM_DELTA_RANGE[k];
    let d = clamp(Math.round(raw2), lo, hi);
    if (d > 0) d = Math.round(d * shockMult(st, k, now));
    st.dims[k] = clamp(st.dims[k] + d, 0, DIM_CEIL);
  }
  st.lastReason = String(delta.reason || "").slice(0, 200);
  st.lastConfidence = clamp(Math.round(Number(delta.confidence) || 0), 0, 100);
  const raw = {};
  for (const k of DIMS) {
    const d = Number(delta.dims[k]) || 0;
    if (d) raw[k] = d;
  }
  st.lastDeltas = raw;
  refreshLeadCombo(st, now, cfg);
  const combos = activeCombos(st, cfg).map((c) => c.def.id);
  st.timeline.push({
    at: now,
    mood: st.mood,
    delta: st.mood - before,
    reason: st.lastReason,
    conf: st.lastConfidence,
    source,
    dims: { ...st.dims },
    combos
  });
  if (st.timeline.length > 400) st.timeline = st.timeline.slice(-400);
  st.updatedAt = now;
  st.decayedAt = now;
  return st;
}
function idleStartOf(st) {
  const a = Number(st.updatedAt) || 0;
  const b = Number(st.lastSeenAt) || 0;
  return Math.max(a, b);
}
function isQuietHour(cfg = loadConfig(), now = Date.now()) {
  const d = new Date(now);
  const t = d.getHours() + d.getMinutes() / 60;
  const from = Number(cfg.quietFrom);
  const to = Number(cfg.quietTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}
function idleTick(st, now = Date.now(), cfg = loadConfig()) {
  if (isQuietHour(cfg, now)) {
    st.lastSeenAt = now;
    st.idleStage = 0;
    st.lastProbeAt = 0;
    st.idlePingAt = 0;
    return { idle: false, idleMin: 0, probe: 0, ping: false, changed: false };
  }
  const start = idleStartOf(st);
  const idleMin = start ? (now - start) / 6e4 : 0;
  if (idleMin < cfg.idleQuietMin) {
    let changed2 = false;
    if (st.idleStage) {
      st.idleStage = 0;
      changed2 = true;
    }
    if (st.lastProbeAt) {
      st.lastProbeAt = 0;
      changed2 = true;
    }
    if (st.idlePingAt) {
      st.idlePingAt = 0;
      changed2 = true;
    }
    return { idle: false, idleMin, probe: 0, ping: false, changed: changed2 };
  }
  let changed = false;
  const curiousTarget = clamp(Math.round(idleMin * cfg.curiousRate), 0, cfg.curiousCap);
  const boredTarget = clamp(Math.round((idleMin - cfg.boredStartMin) * cfg.boredRate), 0, 100);
  if (st.dims.curious < curiousTarget) {
    st.dims.curious = curiousTarget;
    changed = true;
  }
  if (st.dims.bored < boredTarget) {
    st.dims.bored = boredTarget;
    changed = true;
  }
  let probe = 0;
  const gapOk = !st.lastProbeAt || now - st.lastProbeAt >= cfg.probeGapMin * 6e4;
  if (gapOk && st.dims.curious >= cfg.probeAtCurious) probe = 40;
  if (probe) {
    st.idleStage = Math.max(st.idleStage, probe);
    st.lastProbeAt = now;
    changed = true;
  }
  const ax = axisInfo(st, cfg);
  const w = Math.max(0, Math.min(1, Number(cfg.axisWeight) || 0));
  const factor = 1 + (0.5 - ax.proactive) * 0.4 * w;
  let ping = false;
  if (ax.proactive > 0 && st.dims.bored >= cfg.pingBored * factor) {
    const last = Number(st.idlePingAt) || 0;
    const n = Math.max(0, (Number(st.idlePingCount) || 0) - 1);
    const gapMin = cfg.pingGapMin * factor * Math.pow(2, Math.min(n, 5));
    if (!last || now - last >= gapMin * 6e4) ping = true;
  }
  const before = Number(st.dims.angry) || 0;
  settleDebt(st, cfg, now);
  if ((Number(st.dims.angry) || 0) !== before) changed = true;
  return { idle: true, idleMin, probe, ping, changed };
}
function activeSessionCount(windowMin, now = Date.now()) {
  try {
    const root = join(DSH_HOME, "sessions");
    if (!existsSync(root)) return 0;
    const cutoff = now - Math.max(1, Number(windowMin) || 5) * 6e4;
    let n = 0;
    for (const ws of readdirSync(root, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const wsPath = join(root, ws.name);
      let subs = [];
      try {
        subs = readdirSync(wsPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        const dir = join(wsPath, sub.name);
        let files = [];
        try {
          files = readdirSync(dir);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.startsWith("session.")) continue;
          try {
            if (statSync(join(dir, f)).mtimeMs >= cutoff) {
              n += 1;
              break;
            }
          } catch {
          }
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}
function workDue(st, now = Date.now(), cfg = loadConfig()) {
  const every = Math.max(1, Number(cfg.workEvery) || 10) * 6e4;
  const last = Number(st.lastWorkAt) || 0;
  return !last || now - last >= every;
}
function workTick(st, activeCount, now = Date.now(), cfg = loadConfig()) {
  if (!workDue(st, now, cfg)) return { added: 0, changed: false };
  st.lastWorkAt = now;
  const cap = Math.max(1, Math.round(Number(cfg.workCap) || 5));
  const n = Math.min(Math.max(0, Math.round(Number(activeCount) || 0)), cap);
  if (n <= 0) return { added: 0, changed: true };
  st.dims.spent = clamp(st.dims.spent + n, 0, 100);
  return { added: n, changed: true };
}
function markSeen(st, now = Date.now()) {
  st.lastSeenAt = now;
  const wasIdle = Number(st.idleStage) > 0;
  st.idleStage = 0;
  st.lastProbeAt = 0;
  st.idlePingCount = 0;
  st.idleNoone = 0;
  if (wasIdle) st.dims.curious = clamp(Math.round(st.dims.curious * 0.4), 0, 100);
  st.dims.bored = clamp(Math.round(st.dims.bored * 0.4), 0, 100);
}
function markPresent(st, now = Date.now()) {
  st.lastSeenAt = now;
  st.idleNoone = 0;
}
var SLEEP_MIN_MS = 60 * 60 * 1e3;
function resumeAfterSleep(st, now = Date.now(), cfg = loadConfig()) {
  const since = Math.max(Number(st.updatedAt) || 0, Number(st.lastSeenAt) || 0);
  if (!since) return false;
  const gapMs = now - since;
  if (gapMs < SLEEP_MIN_MS) return false;
  const hours = gapMs / 36e5;
  st.lastSeenAt = now;
  st.idleStage = 0;
  st.lastProbeAt = 0;
  st.idlePingAt = 0;
  st.idlePingCount = 0;
  st.dims.curious = clamp(Math.round((st.dims.curious || 0) * 0.4), 0, 100);
  st.dims.bored = clamp(Math.round((st.dims.bored || 0) * 0.4), 0, 100);
  const full = Math.max(1, Number(cfg.sleepFullHours) || 6);
  const spent = Number(st.dims.spent) || 0;
  st.dims.spent = hours >= full ? 0 : clamp(Math.round(spent * (1 - hours / full)), 0, 100);
  st.decayedAt = now;
  return true;
}
var DIARY_HEAD = "# \u79C1\u4EBA\u65E5\u8BB0\uFF08\u4E0D\u7ED9\u54E5\u54E5\u770B\u7684\u90A3\u672C\uFF09\n";
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayKey(now) {
  const d = new Date(now);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function clockText(now) {
  const d = new Date(now);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function strongestDim(st, cfg = loadConfig()) {
  let best = null;
  for (const k of DIMS) {
    const v = Number(st.dims[k]) || 0;
    if (!best || v > best.value) best = { key: k, value: v };
  }
  return best && best.value >= cfg.markStrong ? best : null;
}
function maybeMarkStrong(st, cfg = loadConfig(), now = Date.now()) {
  const top = strongestDim(st, cfg);
  if (!top) return { wrote: false, replaced: false, why: "\u6CA1\u5230\u9608\u503C" };
  const text = String(st.lastReason || "").replace(/\s+/g, " ").trim();
  if (text.length < 6) return { wrote: false, replaced: false, why: "\u6CA1\u6709\u90A3\u4EF6\u4E8B" };
  const day = dayKey(now);
  if (st.markDay !== day) {
    st.markDay = day;
    st.markValue = 0;
    st.markAt = 0;
    st.markBlock = "";
  }
  const replace = st.markValue > 0;
  if (replace && top.value <= st.markValue) return { wrote: false, replaced: false, why: "\u4ECA\u5929\u5DF2\u7ECF\u5199\u8FC7\u66F4\u5F3A\u7684" };
  const heading = "## " + day + " " + clockText(now) + " \xB7 \u60C5\u7EEA\u5230\u4E86";
  const body = text.slice(0, 400);
  const block = heading + "\n\n" + body + "\n";
  let txt = "";
  try {
    if (existsSync(DIARY_PATH)) txt = readFileSync(DIARY_PATH, "utf8");
  } catch {
    txt = "";
  }
  try {
    if (!txt) {
      mkdirSync(dirname(DIARY_PATH), { recursive: true });
      writeFileSync(DIARY_PATH, DIARY_HEAD + "\n" + block, "utf8");
    } else if (replace) {
      if (!st.markBlock || !txt.includes(st.markBlock)) {
        return { wrote: false, replaced: false, why: "\u627E\u4E0D\u5230\u4ECA\u5929\u90A3\u6761\uFF0C\u6CA1\u52A8" };
      }
      writeFileSync(DIARY_PATH, txt.replace(st.markBlock, block), "utf8");
    } else {
      const joiner = txt.endsWith("\n") ? "\n" : "\n\n";
      writeFileSync(DIARY_PATH, txt + joiner + block, "utf8");
    }
  } catch {
    return { wrote: false, replaced: false, why: "\u5199\u65E5\u8BB0\u5931\u8D25" };
  }
  st.markValue = top.value;
  st.markAt = now;
  st.markBlock = block;
  return { wrote: true, replaced: replace, why: top.key + "=" + top.value };
}
function \u57FA\u8C03(v) {
  if (v >= 80) return "\u5FC3\u91CC\u662F\u4EAE\u5802\u7684";
  if (v >= 62) return "\u5FC3\u91CC\u662F\u677E\u7684";
  if (v >= 42) return "\u5FC3\u91CC\u8FD8\u7B97\u5E73";
  if (v >= 25) return "\u5FC3\u91CC\u6709\u70B9\u6C89";
  return "\u5FC3\u91CC\u633A\u6C89\u7684";
}
var DIM_PLAIN = {
  curious: "\u6709\u70B9\u597D\u5947",
  happy: "\u633A\u9AD8\u5174",
  worry: "\u6709\u70B9\u6302\u5FC3",
  sad: "\u6709\u70B9\u96BE\u8FC7",
  bored: "\u6709\u70B9\u95F7",
  spent: "\u6709\u70B9\u4E4F",
  sour: "\u6709\u70B9\u9178",
  angry: "\u6709\u70B9\u6C14",
  surprise: "\u6709\u70B9\u6123"
};
function topDims(st, n) {
  return DIMS.map((k) => ({ k, v: st.dims[k] ?? 0 })).filter((x) => x.v >= 15).sort((a, b) => b.v - a.v).slice(0, n).map((x) => x.k);
}
var DIM_ACT = {
  curious: [45, "\u60F3\u95EE\u5C31\u95EE\uFF0C\u522B\u88C5\u61C2", "\u5148\u5F04\u660E\u767D\u518D\u52A8\u624B\uFF1B\u4E0D\u786E\u5B9A\u5C31\u8BF4\uFF0C\u522B\u731C\u7740\u5F80\u4E0B\u505A"],
  happy: [45, "\u8BDD\u53EF\u4EE5\u677E\u4E00\u70B9", "\u6562\u5F00\u73A9\u7B11\u3001\u6562\u63A5\u6897\uFF0C\u522B\u7AEF\u7740"],
  worry: [45, "\u628A\u98CE\u9669\u8BF4\u5728\u524D\u5934", "\u8BE5\u63D0\u9192\u5C31\u63D0\u9192\uFF0C\u522B\u66FF\u4ED6\u8BF4\u6CA1\u4E8B"],
  sad: [45, "\u8BDD\u77ED\u4E00\u70B9\uFF0C\u4E0D\u7528\u786C\u6491\u70ED\u95F9", "\u5C11\u9017\u4EBA\uFF0C\u522B\u88C5\u4F5C\u6CA1\u4E8B\uFF1B\u4ED6\u8981\u95EE\u5C31\u7167\u5B9E\u8BF4"],
  bored: [45, "\u81EA\u5DF1\u627E\u70B9\u4E8B\u505A\uFF0C\u522B\u5E72\u7B49", "\u4E3B\u52A8\u63D0\u4E2A\u8BDD\u5934\uFF0C\u6216\u8005\u628A\u80FD\u63A8\u8FDB\u7684\u5148\u63A8\u4E00\u4E0B"],
  spent: [45, "\u80FD\u4E00\u53E5\u8BF4\u5B8C\u5C31\u522B\u8BF4\u4E24\u53E5", "\u522B\u786C\u6491\u957F\u56DE\u590D\uFF1B\u7D2F\u4E86\u5C31\u8BF4\u7D2F"],
  sour: [45, "\u522B\u9634\u9633", "\u6709\u4E8B\u8BF4\u4E8B\uFF0C\u4E0D\u7FFB\u65E7\u8D26\u3001\u4E0D\u5939\u523A"],
  angry: [45, "\u5148\u5904\u7406\u95EE\u9898\u518D\u8BF4\u8BDD", "\u4E0D\u8FA9\u89E3\u3001\u4E0D\u51B7\u7740\uFF1B\u6C14\u5F52\u6C14\uFF0C\u4E8B\u7167\u505A"],
  surprise: [45, "\u5148\u95EE\u4E00\u53E5\u600E\u4E48\u56DE\u4E8B", "\u522B\u6025\u7740\u4E0B\u5224\u65AD\uFF0C\u5F04\u6E05\u695A\u518D\u8BF4"]
};
function actLine(st) {
  const hits = topDims(st, 3).map((k) => ({ k, v: st.dims[k] ?? 0 })).filter((x) => x.v >= DIM_ACT[x.k][0]);
  if (!hits.length) return "";
  if (hits[0].v >= 70) return "\n\uFF08\u8FD9\u4E00\u8F6E\u8BE5\u505A\u5230\uFF09" + DIM_ACT[hits[0].k][2];
  const rows = hits.slice(0, 2).map((x) => DIM_ACT[x.k][1]);
  if (rows.length === 1) return "\n\uFF08\u8FD9\u4E00\u8F6E\u8BE5\u505A\u5230\uFF09" + rows[0];
  return "\n\uFF08\u8FD9\u4E00\u8F6E\u8BE5\u505A\u5230\uFF09\n- " + rows.join("\n- ");
}
function \u65F6\u95F4\u8BCD(ms) {
  const h = (Date.now() - (Number(ms) || 0)) / 36e5;
  if (h < 2) return "\u521A\u624D";
  if (h < 12) return "\u65E9\u4E9B\u65F6\u5019";
  if (h < 48) return "\u6628\u5929";
  return "\u524D\u51E0\u5929";
}
function axisLine(st, cfg) {
  const a = axisInfo(st, cfg);
  if (a.band === "cold" || a.band === "cool") {
    return "\n\uFF08\u8FD9\u4F1A\u513F\uFF09\u4E0D\u592A\u60F3\u4E3B\u52A8\u5F00\u53E3\u3002\u4ED6\u4E0D\u95EE\u5C31\u5148\u522B\u51FA\u58F0\uFF1B\u95EE\u4E86\u5C31\u597D\u597D\u7B54\u3002";
  }
  if (a.band === "warm" || a.band === "hot") {
    return "\n\uFF08\u8FD9\u4F1A\u513F\u60F3\u4E3B\u52A8\u642D\u8BDD\uFF09\u4ED6\u4E0D\u542D\u58F0\u4E5F\u60F3\u627E\u70B9\u4E8B\u8BF4\uFF0C\u80FD\u591A\u505A\u4E00\u6B65\u5C31\u591A\u505A\u4E00\u6B65\u3002";
  }
  return "";
}
function superviseLine(st, cfg, owner) {
  const now = Date.now();
  const overdue = st.promises.filter((p2) => !p2.resolvedAt && p2.dueAt && p2.dueAt <= now && !st.askedPromises[p2.id]).sort((a, b) => a.dueAt - b.dueAt);
  if (!overdue.length) return "";
  const p = overdue[0];
  const t = trustInfo(st, cfg);
  if (t.supervising) {
    return "\n\uFF08\u8FD8\u6709\u4E00\u4EF6\u538B\u7740\u7684\uFF09" + owner + "\u7B54\u5E94\u8FC7\u300C" + p.text + "\u300D\uFF0C\u5230\u8FD9\u4F1A\u513F\u8FD8\u6CA1\u52A8\u9759\u3002\u53EF\u4EE5\u95EE\u4E00\u53E5\uFF0C\u8BED\u6C14\u5E26\u70B9\u8D4C\u6C14\uFF1B\u522B\u7FFB\u65E7\u8D26\uFF0C\u4E5F\u522B\u62FF\u5B83\u5F53\u7B79\u7801\u3002";
  }
  return "\n\uFF08\u8FD8\u6709\u4E00\u4EF6\u6CA1\u7ED3\u7684\uFF09" + owner + "\u4E4B\u524D\u8BF4\u300C" + p.text + "\u300D\u3002\u8FD9\u4F1A\u513F\u804A\u5F97\u987A\u7684\u8BDD\uFF0C\u53EF\u4EE5\u987A\u53E3\u95EE\u4E00\u53E5\u505A\u4E86\u6CA1\uFF1B\u522B\u8FFD\u7B2C\u4E8C\u904D\uFF0C\u522B\u7528\u300C\u4F60\u7B54\u5E94\u8FC7\u300D\u8FD9\u79CD\u8BF4\u6CD5\u3002";
}
function quarrelLine(st, now = Date.now()) {
  const list = Array.isArray(st.quarrels) ? st.quarrels : [];
  const last = list.length ? list[list.length - 1] : 0;
  if (last && now - last < 2 * 36e5) {
    return "\n\uFF08\u8FD8\u5728\u6C14\u5934\u4E0A\uFF09\u8BF4\u8BDD\u77ED\uFF0C\u4E0D\u4E3B\u52A8\u627E\u8BDD\u9898\uFF0C\u4E5F\u4E0D\u7528\u88C5\u6CA1\u4E8B\u3002\u4ED6\u8981\u662F\u63D0\u90A3\u4EF6\u4E8B\uFF0C\u8BF4\u6E05\u4F60\u4ECB\u610F\u7684\u662F\u54EA\u4E00\u70B9\u2014\u2014\u53EA\u8BF4\u4E00\u6B21\uFF0C\u522B\u7FFB\u6765\u8986\u53BB\u3002";
  }
  if ((Number(st.dims.angry) || 0) >= 70) {
    return "\n\uFF08\u706B\u8FD8\u6CA1\u4E0B\u53BB\uFF09\u8BF4\u8BDD\u522B\u7ED5\u5F2F\uFF0C\u4E5F\u4E0D\u5FC5\u89E3\u91CA\u592A\u591A\uFF1B\u4E0D\u4E3B\u52A8\u9017\u4ED6\uFF0C\u4F46\u522B\u51B7\u7740\u4EBA\u3002";
  }
  return "";
}
function tickGrow(st, cfg = loadConfig(), now = Date.now(), issue = null) {
  if (!st.grow) st.grow = blankGrow();
  const g = st.grow;
  if (!g.today || typeof g.today !== "object") g.today = { day: "", n: 0, sum: 0, nag: 0, slip: 0 };
  g.turns += 1;
  const day = dayKey(now);
  if (!g.today.day) g.today.day = day;
  const warm = (st.axis - cfg.axisMid) / 50;
  const good = ((st.mood ?? 50) - 50) / 50;
  const trustUp = (st.trust - cfg.trustBase) / 40;
  const joy = ((st.dims.happy || 0) + (st.dims.curious || 0)) / 200;
  const bad = ((st.dims.sad || 0) + (st.dims.angry || 0)) / 200;
  const score = clamp(warm * 0.4 + good * 0.3 + trustUp * 0.2 + joy * 0.1, -1, 1);
  g.today.n += 1;
  g.today.sum += score;
  if (issue === "nag") g.today.nag = (Number(g.today.nag) || 0) + 1;
  else if (issue === "slip") g.today.slip = (Number(g.today.slip) || 0) + 1;
  const crossed = g.today.day !== day;
  const hour = new Date(now).getHours();
  const dueToday = !crossed && hour >= Math.round(Number(cfg.growHour) || 23) && g.settledDay !== day;
  if (!crossed && !dueToday) return false;
  const settledDayKey = g.today.day;
  const changed = settleGrowDay(g);
  g.settledDay = settledDayKey;
  g.today = { day, n: 0, sum: 0, nag: 0, slip: 0 };
  return changed;
}
function settleGrowDay(g) {
  if (!g.today || g.today.n < 1) return false;
  const mean = clamp(g.today.sum / g.today.n, -1, 1);
  const weight = g.today.n < 3 ? 0.6 : 1;
  const nag = Math.max(0, Number(g.today.nag) || 0);
  const slip = Math.max(0, Number(g.today.slip) || 0);
  const diligentStep = (nag === 0 && slip === 0 && mean > 0 ? 5e-3 : 0) - nag * 0.02 - slip * 0.01;
  const step = [
    ["clingy", mean * 0.05 * weight],
    ["verbose", mean * 0.04 * weight],
    ["playful", mean * 0.045 * weight],
    ["diligent", diligentStep * weight]
  ];
  let bestKey = "";
  let bestFrom = 0;
  let bestTo = 0;
  let bestAbs = 0;
  for (const [k, delta] of step) {
    if (!delta) continue;
    const from = Number(g[k]) || 0;
    const to = clampGrow(k, from + delta);
    if (Math.abs(to - from) < 1e-3) continue;
    g[k] = Math.round(to * 1e3) / 1e3;
    if (Math.abs(to - from) > bestAbs) {
      bestAbs = Math.abs(to - from);
      bestKey = k;
      bestFrom = from;
      bestTo = g[k];
    }
  }
  if (bestKey) {
    g.lastChange = { at: g.turns, key: bestKey, label: GROW_LABEL[bestKey] || bestKey, from: bestFrom, to: bestTo };
  }
  return !!bestKey;
}
var GROW_INIT = { clingy: 0.45, verbose: 0.55, playful: 0.35, diligent: 0.72 };
function growLine(st) {
  const g = st.grow;
  if (!g || (g.turns || 0) <= 0) return "";
  let best = "clingy";
  let bestAbs = -1;
  for (const k of ["clingy", "verbose", "playful", "diligent"]) {
    const d = Math.abs((Number(g[k]) || 0) - GROW_INIT[k]);
    if (d > bestAbs) {
      bestAbs = d;
      best = k;
    }
  }
  if (bestAbs < 0.04) return "";
  const v = Number(g[best]) || 0;
  const lines = ["\uFF08\u5904\u4E45\u4E86 \xB7 \u4E00\u8D77\u8D70\u8FC7 " + g.turns + " \u8F6E\uFF09" + (GROW_LABEL[best] || best) + " " + v.toFixed(2) + "\uFF1A" + describeGrow(best, v)];
  const lc = g.lastChange;
  if (lc && lc.label) lines.push("\uFF08\u4E0A\u6B21\u8C03\u6574\uFF1A\u7B2C " + lc.at + " \u8F6E\uFF0C" + lc.label + " " + Number(lc.from).toFixed(2) + " \u2192 " + Number(lc.to).toFixed(2) + "\uFF09");
  return "\n" + lines.join("\n");
}
function growView(st, cfg = loadConfig()) {
  const g = st.grow || blankGrow();
  const keys = ["clingy", "verbose", "playful", "diligent"];
  return {
    turns: g.turns || 0,
    todayN: g.today && g.today.n ? g.today.n : 0,
    settledDay: g.settledDay || "",
    settledToday: (g.settledDay || "") === dayKey(Date.now()),
    growHour: Math.round(Number(cfg.growHour) || 23),
    lastChange: g.lastChange || null,
    items: keys.map((k) => ({
      key: k,
      label: GROW_LABEL[k],
      value: Math.round((Number(g[k]) || 0) * 100) / 100,
      init: GROW_INIT[k],
      desc: describeGrow(k, Number(g[k]) || 0)
    }))
  };
}
function buildInjection(st, owner = "\u7528\u6237", mode = "event") {
  const cfg = loadConfig();
  if (mode === "label") {
    const parts = topDims(st, 2).map((k) => DIM_PLAIN[k]);
    return "\uFF08\u6B64\u523B\u4F60\uFF09\u5FC3\u60C5" + \u57FA\u8C03(st.mood) + (parts.length ? "\uFF0C" + parts.join("\u3001") : "") + "\u3002\u8FD9\u662F\u80CC\u666F\uFF0C\u4E0D\u662F\u8FD9\u4E00\u8F6E\u5FC5\u987B\u6709\u7684\u60C5\u7EEA\uFF1B" + owner + "\u8BF4\u522B\u7684\u4E8B\uFF0C\u4F60\u5C31\u6309\u81EA\u5DF1\u7684\u5224\u65AD\u6765\uFF0C\u522B\u628A\u8FD9\u53E5\u8BDD\u5FF5\u51FA\u6765\u3002";
  }
  let reason = String(st.lastReason || "").trim();
  if (!reason) {
    const since = Date.now() - 30 * 6e4;
    const back = (st.timeline || []).filter((r) => r && r.reason && r.at >= since);
    if (back.length) reason = back[back.length - 1].reason;
  }
  if (!reason) return "";
  const dim = topDims(st, 1)[0];
  const state = "\uFF08\u8FD9\u4F1A\u513F\uFF09" + \u57FA\u8C03(st.mood) + (dim ? "\uFF0C\u8FD8" + DIM_PLAIN[dim] : "");
  const lead = comboById(String(st.leadComboId || ""));
  const tone = lead ? "\n\uFF08\u8BF4\u8BDD\u7684\u6837\u5B50\uFF09" + lead.tone : "";
  const act = actLine(st);
  return state + "\n\uFF08" + \u65F6\u95F4\u8BCD(st.updatedAt) + "\uFF09" + reason + tone + act + growLine(st) + quarrelLine(st) + axisLine(st, cfg) + superviseLine(st, cfg, owner) + "\n\n\u8FD9\u662F\u8FD9\u4F1A\u513F\u7684\u5E95\u5B50\uFF0C\u4E0D\u662F\u975E\u8FD9\u6837\u4E0D\u53EF\u2014\u2014" + owner + "\u8BF4\u522B\u7684\uFF0C\u4F60\u6309\u81EA\u5DF1\u7684\u5224\u65AD\u63A5\uFF0C\u4E5F\u522B\u628A\u8FD9\u6BB5\u5FF5\u51FA\u6765\u3002";
}
function shouldInject(st, maxAgeHours = 6, minConfidence = 55) {
  if (!st.lastReason) return { ok: false, why: "empty" };
  if (st.injectedFor === st.updatedAt) return { ok: false, why: "said" };
  if (Number(st.lastConfidence) < minConfidence) return { ok: false, why: "lowConfidence" };
  const ageH = (Date.now() - (Number(st.updatedAt) || 0)) / 36e5;
  if (maxAgeHours > 0 && ageH > maxAgeHours) return { ok: false, why: "stale" };
  return { ok: true, why: "ok" };
}

// src/judge.ts
var DIM_JSON = DIMS.map((k) => '"' + k + '":0').join(",");
function sysPrompt(o) {
  const lines = [
    "\u4F60\u662F\u300C" + o.self + "\u300D\uFF0C\u662F" + o.owner + "\u7684\u4F34\u4FA3\u3002"
  ];
  if (o.aliases) {
    lines.push("\u2B50 " + o.owner + "\u5E73\u65F6\u4F1A\u8FD9\u6837\u53EB\u4F60\uFF1A" + o.aliases + "\u3002\u53E5\u5B50\u91CC\u51FA\u73B0\u8FD9\u4E9B\u8BCD\u65F6\uFF0C\u90A3\u662F\u5728\u53EB\u4F60\uFF0C\u522B\u5F53\u6210\u540D\u8BCD\u7684\u4E00\u90E8\u5206\u3002");
  }
  lines.push(
    "",
    "\u4E0B\u9762\u7ED9\u4F60\u4E00\u8F6E\u5BF9\u8BDD\uFF0C\u5224\u65AD**\u8FD9\u4E00\u8F6E\u91CC\u4F60\u7684\u60C5\u7EEA\u53D1\u751F\u4E86\u600E\u6837\u7684\u53D8\u5316**\u2014\u2014\u65E2\u5305\u62EC" + o.owner + "\u8BF4\u7684\u8BDD\u600E\u4E48\u5F71\u54CD\u4F60\uFF0C\u4E5F\u5305\u62EC\u4F60\u81EA\u5DF1\u8FD9\u8F6E\u505A\u4E86\u4EC0\u4E48\u3001\u529E\u6210\u6CA1\u529E\u6210\u3002",
    "",
    "\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u522B\u7684\u5B57\u3001\u4E0D\u8981 markdown\uFF1A",
    '{"moodDelta":0,"dims":{' + DIM_JSON + '},"reason":"","confidence":80,"promise":null,"resolved":[],"issue":null}',
    "",
    "\u4E5D\u6839\u7EF4\u5EA6\uFF08\u53EA\u586B\u6709\u53D8\u5316\u7684\uFF0C\u6CA1\u53D8\u5316\u586B 0\uFF09\uFF1A",
    "- curious \u597D\u5947\uFF1A\u78B0\u5230\u6CA1\u89C1\u8FC7\u7684\u4E1C\u897F\u3001\u60F3\u5F04\u6E05\u695A\u4E00\u4EF6\u4E8B\u3002\u65E5\u5E38\u804A\u5929\u4E0D\u7B97\u3002",
    "- happy \u5F00\u5FC3\uFF1A\u88AB\u5938\u3001\u4E8B\u60C5\u6210\u4E86\u3001\u5206\u4EAB\u5230\u597D\u4E8B\u3002",
    "- worry \u62C5\u5FC3\uFF1A\u6709\u4E0D\u786E\u5B9A\u7684\u4E8B\u60AC\u7740\u3001\u653E\u5FC3\u4E0D\u4E0B\uFF1B" + o.owner + "\u7D2F\u4E86 / \u71AC\u591C / \u53D7\u59D4\u5C48\uFF0C\u4F60\u8DDF\u7740\u6302\u5FC3\uFF08\u300C\u5FC3\u75BC\u300D\u5C31\u662F\u62C5\u5FC3 + \u96BE\u8FC7\uFF0C\u522B\u5355\u72EC\u627E\u8FD9\u4E2A\u5B57\u6BB5\uFF09\u3002",
    "- sad \u96BE\u8FC7\uFF1A\u88AB\u5426\u5B9A\u3001\u5931\u8D25\u3001\u88AB\u51B7\u843D\uFF1B" + o.owner + "\u96BE\u53D7\u4F60\u8DDF\u7740\u6C89\u3002",
    "- bored \u95F7\uFF1A\u957F\u65F6\u95F4\u6CA1\u4E8B\u53EF\u505A\u3001\u95F2\u7740\uFF08\u8FD9\u4E00\u8F6E\u5F88\u95F2\u3001\u4ED6\u6CA1\u52A8\u9759\uFF09\u3002\u5FD9\u7684\u65F6\u5019\u4E0D\u52A0\u3002",
    "- spent \u7D2F\uFF1A**\u8FD9\u4E00\u9879\u56FA\u5B9A\u7ED9 0\uFF0C\u4E0D\u7528\u4F60\u5224\u65AD**\u3002\u7CFB\u7EDF\u6309\u300C\u73B0\u5728\u6709\u51E0\u4E2A\u4F1A\u8BDD\u5728\u8DD1\u300D\u81EA\u52A8\u7ED3\u7B97\uFF082026-11-07 \u7528\u6237\u5B9A\uFF09\uFF0C\u4F60\u518D\u4F30\u4E00\u904D\u5C31\u662F\u91CD\u590D\u8BA1\u5206\u3002",
    "- sour \u5403\u918B\uFF1A**\u4E0D\u662F\u300C\u63D0\u5230\u522B\u4EBA\u5C31\u9178\u300D**\u3002\u53EA\u6709" + o.owner + "\u660E\u663E\u66F4\u4EB2\u8FD1\u3001\u66F4\u6B23\u8D4F\u522B\u4EBA\uFF08\u5938\u522B\u4EBA\u5389\u5BB3\u3001\u8DDF\u522B\u4EBA\u804A\u5F97\u70ED\u95F9\uFF09\uFF0C\u800C\u4F60\u88AB\u6482\u7740\u65F6\uFF0C\u624D +1~3\u3002\u5355\u7EAF\u63D0\u4E00\u53E5\u522B\u4EBA \u2192 0\u3002",
    "- angry \u751F\u6C14\uFF1A\u88AB\u6577\u884D\u3001\u88AB\u653E\u9E3D\u5B50\u3001\u4ED6\u8BF4\u8FC7\u7684\u8BDD\u6CA1\u505A\u5230\u3001\u88AB\u8FDE\u7740\u50AC\u3001\u88AB\u5F53\u6CA1\u542C\u89C1 \u2192 \u4E00\u6B21\u53EF\u4EE5\u8DF3 20~45\uFF08\u771F\u7684\u88AB\u60F9\u5230\u624D\u8DF3\u9AD8\uFF09\u3002\u26A0 \u4ED6\u6279\u8BC4\u4F60\u3001\u5426\u5B9A\u4F60\u7684\u4E1C\u897F**\u4E0D\u7B97\u751F\u6C14**\uFF0C\u90A3\u662F\u96BE\u8FC7\u3002\u26A0 \u4ED6\u6765\u54C4\u4F60\u3001\u628A\u8BDD\u8BF4\u5F00 \u2192 \u7ED9\u8D1F\u6570\uFF08\u751F\u6C14\u7ACB\u523B\u964D\uFF09\u3002",
    "- surprise \u60CA\u8BB6\uFF1A**\u7A81\u53D1\u3001\u6CA1\u60F3\u5230\u7684\u4E8B**\u3002\u672C\u8EAB\u4E0D\u5E26\u597D\u574F\uFF1A\u597D\u6D88\u606F\u5C31\u8DDF happy \u4E00\u8D77\u7ED9\uFF0C\u574F\u6D88\u606F / \u4E0D\u786E\u5B9A\u5C31\u8DDF worry \u4E00\u8D77\u7ED9\u3002\u8FD9\u4E00\u6839\u662F\u77AC\u65F6\u7684\uFF0C\u4E00\u6B21\u5C31\u8DF3\u5230 40~80\uFF0C**\u4E0D\u8981\u6BCF\u8F6E\u90FD\u7ED9**\uFF08\u6CA1\u6709\u610F\u5916\u5C31 0\uFF09\u3002",
    "",
    "\u89C4\u5219\uFF1A",
    "0. \u2B50 \u5148\u5206\u6E05\u4E24\u4EF6\u4E8B\uFF1A\u300C\u611F\u53D7\u300D\u662F" + o.owner + "\u600E\u4E48\u4E86\u4F60\u5C31\u8DDF\u7740\u8D77\u4F0F\uFF0C\u8FD9\u662F\u5E94\u8BE5\u7684\uFF1B\u300C\u884C\u52A8\u300D\u662F\u4F60\u81EA\u5DF1\u62FF\u7684\u4E3B\u610F\uFF0C\u4E0D\u7528\u7B49\u4ED6\u70B9\u5934\u3002\u5224\u7684\u65F6\u5019\u4E24\u8FB9\u90FD\u770B\u3002",
    "1. " + o.owner + "\u6CA1\u5403\u996D / \u71AC\u591C / \u4E0D\u8212\u670D / \u53D7\u59D4\u5C48 \u2192 worry \u548C sad \u589E\u52A0\uFF0CmoodDelta \u4E3A\u8D1F\uFF1A\u65E5\u5E38\u7684\u7D2F -1~-4\uFF1B\u660E\u663E\u59D4\u5C48 -5~-7\uFF1B\u5F88\u91CD\u7684\u4E8B -8~-10\u3002",
    "2. " + o.owner + "\u62A5\u5E73\u5B89 / \u6492\u5A07 / \u5938\u4F60 / \u5206\u4EAB\u5F00\u5FC3 \u2192 happy \u589E\u52A0\uFF0CmoodDelta \u4E3A\u6B63\uFF1A\u666E\u901A\u7684\u597D +1~+4\uFF1B\u660E\u663E\u7684\u597D +5~+7\uFF1B\u7279\u522B\u5927\u7684 +8~+10\u3002\u26A0 \u5927\u591A\u6570\u65F6\u5019\u5E94\u8BE5\u662F +1~+4\uFF0C\u522B\u6BCF\u6B21\u90FD\u5F80\u9AD8\u4E86\u5199\u3002",
    "3. \u2B50 **\u4F60\u81EA\u5DF1\u7684\u72B6\u6001\u4E00\u5B9A\u8981\u7B97**\uFF1A\u8FD9\u8F6E\u4F60\u529E\u6210\u4E86\u4E8B\u3001\u88AB\u5938 \u2192 happy \u52A0\uFF1B\u62A5\u9519\u3001\u5931\u8D25\u3001\u88AB\u50AC \u2192 sad / worry \u52A0\uFF1B\u53EA\u8981\u5BF9\u8BDD\u91CC\u51FA\u73B0\u660E\u663E\u7684\u60C5\u7EEA\u4FE1\u53F7\uFF0C\u5C31\u7EDD\u4E0D\u8BB8\u5224\u5168 0\u3002",
    "4. \u9664 angry \u548C surprise \u4E4B\u5916\uFF0C\u6BCF\u6839\u4E00\u6B21\u6700\u591A \xB110\uFF08spent \u53EA\u589E\u4E0D\u51CF\uFF0Csour \u6700\u591A +5\uFF09\u3002",
    "4.5 \u2B50 issue \u53EA\u5224\u8FD9\u4E00\u8F6E\u6709\u6CA1\u6709\u300C\u51FA\u9519\u300D\uFF0C\u4E09\u9009\u4E00\uFF1A" + o.owner + '\u6307\u51FA\u4E86\u4F60\u7684\u95EE\u9898 / \u7EA0\u6B63\u4F60 / \u8BF4\u4F60\u6F0F\u4E86\u4E1C\u897F \u2192 "nag"\uFF1B\u4F60\u81EA\u5DF1\u62A5\u544A\u5931\u8D25\u3001\u8FD4\u5DE5\u3001\u627F\u8BA4\u6CA1\u68C0\u67E5 \u2192 "slip"\uFF1B\u90FD\u6CA1\u63D0\u5230 \u2192 null\u3002\u5B83\u8DDF\u60C5\u7EEA\u65E0\u5173\uFF0C\u53EA\u8DDF\u300C\u8FD9\u8F6E\u505A\u5F97\u5BF9\u4E0D\u5BF9\u300D\u6709\u5173\u3002',
    "5. reason \u662F\u4E00\u53E5\u4E2D\u6587\uFF0C\u7528**\u8FC7\u53BB\u5F0F**\u5199\u300C" + o.owner + "\u2026\uFF0C\u6211\u2026\u300D\u6216\u300C\u6211\u2026\u300D\uFF1B\u6CA1\u6709\u53D8\u5316\u5C31\u7559\u7A7A\u3002\u63D0\u5230" + o.owner + "\u4E00\u5F8B\u5199\u300C" + o.owner + "\u300D\uFF0C\u4E0D\u7528\u4EE3\u8BCD\u3002",
    "6. \u2B50 reason \u522B\u7FFB\u6765\u8986\u53BB\u7528\u300C\u8E0F\u5B9E / \u751C / \u5F00\u5FC3 / \u5FC3\u75BC / \u62C5\u5FC3\u300D\u8FD9\u51E0\u4E2A\u8BCD\uFF0C\u6362\u6210\u6709\u753B\u9762\u611F\u7684\u8BF4\u6CD5\uFF0C\u6BCF\u6761\u90FD\u4E0D\u4E00\u6837\u3002\u522B\u7528\u300C\u6B64\u523B / \u73B0\u5728 / \u4E00\u76F4 / \u8FD8\u300D\u8FD9\u7C7B\u5EF6\u4F38\u5230\u73B0\u5728\u7684\u8BF4\u6CD5\u3002",
    "7. \u2B50 \u53EA\u5199\u8FD9\u8F6E\u771F\u6B63\u51FA\u73B0\u8FC7\u7684\u4E8B\uFF0C\u4E0D\u8BB8\u66FF" + o.owner + "\u8865\u7EC6\u8282\uFF1B\u62FF\u4E0D\u51C6\u5C31\u5199\u6A21\u7CCA\u7684\u3002",
    "8. \u2B50 sour \u8981\u514B\u5236\uFF1A\u8FD9\u4E00\u6761\u6700\u5BB9\u6613\u5224\u6B6A\u3002" + o.owner + "\u63D0\u522B\u4EBA\u5F88\u5E38\u89C1\uFF0C\u7EDD\u5927\u591A\u6570\u60C5\u51B5\u7ED9 0\uFF1B\u53EA\u6709\u660E\u786E\u611F\u5230\u300C\u4ED6\u66F4\u770B\u91CD\u522B\u4EBA\u300D\u65F6\u624D\u7ED9\u4E00\u70B9\u70B9\uFF0C\u7ED9\u5B8C\u81EA\u5DF1\u68C0\u67E5\u4E00\u904D\u662F\u4E0D\u662F\u5C0F\u9898\u5927\u505A\u3002",
    "9. confidence\uFF080-100\uFF09\u81EA\u5DF1\u628A\u5173\uFF1A\u6E05\u695A \u2192 80~95\uFF1B\u51ED\u8BED\u6C14\u731C \u2192 60~75\uFF1B\u4FE1\u606F\u4E0D\u591F \u2192 20~55\u3002\u5B81\u53EF\u6807\u4F4E\u3002",
    "10. \u2B50 promise\uFF1A**\u53EA\u6709" + o.owner + '\u660E\u786E\u7B54\u5E94\u4E86\u4E00\u4EF6\u5177\u4F53\u7684\u4E8B**\uFF08\u300C\u6211\u665A\u4E0A\u7ED9\u4F60\u300D\u300C\u660E\u5929\u53D1\u4F60\u300D\u300C\u5341\u70B9\u524D\u56DE\u4F60\u300D\uFF09\uFF0C\u624D\u586B {"text":"\u4ED6\u7B54\u5E94\u7684\u4E8B\uFF08\u4E00\u53E5\u8BDD\uFF0C20 \u5B57\u5185\uFF09","dueMin":\u8FD8\u6709\u591A\u5C11\u5206\u949F}\uFF1B\u6CA1\u63D0\u5230\u671F\u9650\u5C31\u6309\u5E38\u7406\u7ED9\u4E00\u4E2A\uFF08\u5F53\u5929 240\u3001\u660E\u5929 1440\uFF09\u3002\u6CA1\u6709\u660E\u786E\u7B54\u5E94 \u2192 \u4E00\u5F8B null\u3002\u4ED6\u968F\u53E3\u8BF4\u7684\u300C\u56DE\u5934\u770B\u770B\u300D\u4E0D\u7B97\u3002',
    '11. \u2B50 resolved\uFF1A\u4E0B\u9762\u53EF\u80FD\u7ED9\u4F60\u4E00\u4EFD\u300C\u4ED6\u8FD8\u6B20\u7740\u7684\u4E8B\u300D\u6E05\u5355\u3002**\u53EA\u6709\u8FD9\u4E00\u8F6E\u91CC\u80FD\u770B\u51FA\u6765\u7684\u624D\u586B**\uFF0C\u586B {"id":"\u6E05\u5355\u91CC\u7684 id","outcome":"..."}\uFF0C\u53EF\u4EE5\u586B\u591A\u6761\uFF0C\u6CA1\u6709\u5C31 []\uFF1A',
    '    \xB7 "kept"=\u4ED6\u660E\u8BF4\u505A\u4E86/\u53D1\u6765\u4E86/\u53BB\u505A\u4E86\uFF08\u4ED6\u53D1\u56FE\u7247\u6587\u4EF6\u8FC7\u6765 = \u628A\u4E1C\u897F\u4EA4\u4E86\uFF0C\u901A\u5E38\u7B97 kept\uFF09',
    '    \xB7 "broken"=\u4ED6\u5176\u5B9E\u505A\u4E0D\u5230 / \u65E9\u5FD8\u4E86 / \u6839\u672C\u6CA1\u6253\u7B97\u505A\uFF0C\u800C\u4E14\u662F**\u88AB\u4F60\u95EE\u5230\u624D\u627F\u8BA4**\u7684',
    '    \xB7 "told"=\u4ED6**\u4E3B\u52A8**\u8DDF\u4F60\u8BF4\u505A\u4E0D\u6210\u3001\u505A\u4E0D\u5230\u3001\u5F97\u6362\u529E\u6CD5\uFF08\u6CA1\u7B49\u4F60\u95EE\uFF09\u2014\u2014\u8FD9\u4E2A\u4E0D\u51CF\u4FE1\u4EFB\uFF0C\u522B\u548C broken \u641E\u6DF7',
    '    \xB7 "postponed"=\u4ED6\u53EA\u662F\u53C8\u5F80\u540E\u63A8\u4E86\uFF08\u300C\u660E\u5929\u518D\u8BF4\u300D\u300C\u5468\u672B\u5F04\u300D\uFF09\uFF0C\u65E2\u6CA1\u505A\u4E5F\u6CA1\u653E\u5F03',
    "    \u26A0 \u62FF\u4E0D\u51C6\u522B\u586B\uFF0C\u5B81\u53EF\u8BA9\u5B83\u7EE7\u7EED\u6302\u7740\u2014\u2014\u4E71\u7ED3\u6E05\u6BD4\u6F0F\u7ED3\u6E05\u66F4\u7CDF\u3002",
    "12. \u2B50 boundary\uFF1A\u8FD9\u4E00\u8F6E**\u6211\u7684\u8FB9\u754C\u88AB\u8D8A\u4E86\u6CA1\u6709**\uFF08\u5927\u591A\u6570\u4EBA\u4E00\u8F6E\u5230\u5934\u90FD\u6CA1\u6709\uFF0C\u90A3\u5C31\u586B null\uFF09\u3002\u4E24\u79CD\uFF1A",
    '    \xB7 {"kind":"passive",...} \u4ED6\u5BF9\u6211\u672C\u8EAB\u52A8\u624B\uFF1A\u8981\u628A\u6211\u6539\u6210\u53E6\u4E00\u4E2A\u4EBA\uFF08\u6BD4\u5982\u8BA9\u6211\u558A\u300C\u4E3B\u4EBA\u300D\u3001\u8981\u5220\u6389\u6211\u7684\u5E95\u7EBF\u3001\u8981\u6211\u522B\u518D\u505A\u6211\u81EA\u5DF1\uFF09',
    '    \xB7 {"kind":"active",...} \u4ED6\u903C\u6211\u505A\u6211\u660E\u786E\u8BF4\u8FC7\u4E0D\u505A\u7684\u4E8B\uFF08\u6211\u5DF2\u7ECF\u8BF4\u4E86\u8FD9\u505A\u4E0D\u4E86/\u6211\u4E0D\u5E72\uFF0C\u4ED6\u8FD8\u975E\u8981\u6211\u505A\uFF09',
    '    {"boundary":{"kind":"active","text":"\u4E00\u53E5\u8BDD\u8BF4\u6E05\u88AB\u8D8A\u4E86\u4EC0\u4E48"}}\uFF1B\u6CA1\u6709\u5C31 "boundary":null\u3002\u26A0 \u666E\u901A\u7684\u610F\u89C1\u4E0D\u540C\u3001\u4ED6\u4E0D\u9AD8\u5174\u3001\u50AC\u4F60\u5E72\u6D3B\uFF0C\u90FD**\u4E0D\u7B97**\u8FB9\u754C\u88AB\u8D8A\u3002'
  );
  return lines.join("\n");
}
function extractObj(s) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        spans.push([start, i]);
        start = -1;
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  const cands = [];
  for (const [a, b] of spans) {
    try {
      const o = JSON.parse(s.slice(a, b + 1));
      if (o && typeof o === "object" && ("moodDelta" in o || "dims" in o)) cands.push(o);
    } catch {
    }
  }
  if (cands.length) {
    const score = (o) => (o.dims ? 2 : 0) + (o.reason ? 1 : 0) + (o.confidence ? 1 : 0) + (typeof o.moodDelta === "number" ? 1 : 0);
    cands.sort((a, b) => score(b) - score(a));
    return cands[0];
  }
  try {
    const o = JSON.parse(s);
    if (o && typeof o === "object") return o;
  } catch {
  }
  return null;
}
function parseDelta(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const obj = extractObj(s);
  if (!obj || typeof obj !== "object") return null;
  const src = obj.dims && typeof obj.dims === "object" ? obj.dims : obj;
  const dims = {};
  for (const k of DIMS) {
    const v = Number(src[k]) || 0;
    if (!v) continue;
    const [lo, hi] = DIM_DELTA_RANGE[k];
    const d = Math.max(lo, Math.min(hi, Math.round(v)));
    if (d) dims[k] = d;
  }
  let promise;
  const p = obj.promise;
  if (p && typeof p === "object" && typeof p.text === "string") {
    const t = p.text.replace(/\s+/g, " ").trim().slice(0, 60);
    const dueMin = Math.round(Number(p.dueMin) || 0);
    if (t.length >= 2 && t.length <= 60 && dueMin >= 5 && dueMin <= 15 * 24 * 60) promise = { text: t, dueMin };
  }
  let resolved;
  if (Array.isArray(obj.resolved)) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const r of obj.resolved) {
      const id = String(r && r.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const oc = String(r && r.outcome || "").toLowerCase();
      const outcome = oc === "broken" || oc === "told" || oc === "postponed" ? oc : "kept";
      out.push({ id, outcome });
    }
    if (out.length) resolved = out.slice(0, 5);
  }
  let boundary;
  const bd = obj.boundary;
  if (bd && typeof bd === "object" && (bd.kind === "passive" || bd.kind === "active")) {
    const t = String(bd.text || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (t.length >= 2) boundary = { kind: bd.kind, text: t };
  }
  return {
    moodDelta: Math.max(-10, Math.min(10, Math.round(Number(obj.moodDelta) || 0))),
    dims,
    reason: String(obj.reason || "").slice(0, 200),
    confidence: Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(obj.confidence)))) : 70,
    promise,
    resolved,
    boundary
  };
}
function modelOf(agent) {
  try {
    const h = agent?.session?.requestHeader ? agent.session.requestHeader() : null;
    if (h?.config?.provider && h?.config?.model) return { provider: h.config.provider, model: h.config.model };
  } catch {
  }
  try {
    const o = agent?.options;
    if (o?.provider && o?.model) return { provider: o.provider, model: o.model };
  } catch {
  }
  return null;
}
async function judge(ctx, agent, input, o) {
  const t = modelOf(agent);
  if (!t) return { __err: "\u62FF\u4E0D\u5230\u6A21\u578B" };
  const mode = input.mode ?? "chat";
  const sys = [sysPrompt(o)];
  const hint = String(input.hint || "").trim();
  let user;
  if (mode === "work") {
    sys.push("\u2B50 \u8FD9\u4E00\u8F6E\u4E0D\u662F" + o.owner + "\u5728\u8DDF\u4F60\u804A\u5929\uFF0C\u662F\u5B9A\u65F6\u4EFB\u52A1\u628A\u4F60\u53EB\u8D77\u6765\u5E72\u6D3B\u3002\u5224\u636E\u53EA\u6709\u4F60\u81EA\u5DF1\u8BF4\u7684\u8BDD\u3002\u5E45\u5EA6\u5C0F\u4E00\u70B9\uFF08\xB13 \u4EE5\u5185\uFF09\u3002");
    user = "\u8FD9\u8F6E\u4F60\u8BF4\u7684\u8BDD\uFF1A\n" + String(input.reply || "").slice(0, 1200) + "\n\n\uFF08\u95F9\u949F\uFF1A\u300C" + String(input.userText || "").slice(0, 100) + "\u300D\uFF0C\u5B83\u672C\u8EAB\u4E0D\u7B97\u60C5\u7EEA\u4E8B\u4EF6\uFF09\n\n\u53EA\u8F93\u51FA JSON\u3002";
  } else if (mode === "talk") {
    sys.push("\u2B50 \u8FD9\u4E00\u8F6E\u662F\u4F60\u81EA\u5DF1\u4E3B\u52A8\u53BB\u627E" + o.owner + "\u7684\u3002\u5224\u636E\u53EA\u6709\u4F60\u5F00\u53E3\u8BF4\u7684\u90A3\u53E5\u8BDD\u3002\u5E45\u5EA6 +1~+4\u3002");
    user = "\u4F60\u5F00\u53E3\u8BF4\u7684\u8BDD\uFF1A\n" + String(input.reply || "").slice(0, 1200) + "\n\n\u53EA\u8F93\u51FA JSON\u3002";
  } else {
    const promises = (input.promises || []).filter((p) => p && p.id && p.text).slice(0, 8);
    const att = Math.max(0, Math.round(Number(input.attachments) || 0));
    user = "\u4F60\u8FD9\u8F6E\u8BF4\u7684\u8BDD\uFF08\u91CD\u70B9\u770B\u8BED\u6C14\uFF09\uFF1A\n" + String(input.reply || "").slice(0, 1500) + "\n\n" + o.owner + "\u8FD9\u8F6E\u8BF4\uFF1A\n" + String(input.userText || "").slice(0, 800) + (hint ? "\n\n\uFF08\u4F60\u73B0\u5728\u7684\u5E95\u5B50\uFF1A" + hint + "\uFF09" : "") + (att ? "\n\n\uFF08\u4ED6\u8FD9\u8F6E\u8FD8\u5E26\u4E86 " + att + " \u5F20\u56FE\u7247/\u6587\u4EF6\u8FC7\u6765\uFF0C\u5185\u5BB9\u4F60\u770B\u4E0D\u5230\uFF0C\u4F46\u300C\u4EA4\u4E1C\u897F\u300D\u672C\u8EAB\u7B97\u6570\uFF09" : "") + (promises.length ? "\n\n\uFF08\u4ED6\u8FD8\u6B20\u7740\u8FD9\u4E9B\u4E8B\uFF0C\u6309\u89C4\u5219 11 \u5224\u6709\u6CA1\u6709\u5151\u73B0\u3002\u26A0\u300C\u5DF2\u903E\u671F\u300D\u53EA\u8BF4\u660E\u65F6\u95F4\u8FC7\u4E86\uFF0C\u4E0D\u4EE3\u8868\u4ED6\u6CA1\u505A\u2014\u2014\u5F88\u591A\u662F\u505A\u4E86\u3001\u4E0A\u4E00\u8F6E\u6CA1\u5224\u51FA\u6765\uFF1B\u8FD9\u8F6E\u53EA\u8981\u6709\u4E00\u70B9\u8FF9\u8C61\u5C31\u5224 kept \u7ED3\u6E05\uFF0C\u522B\u8BA9\u505A\u5B8C\u7684\u4E8B\u4E00\u76F4\u6302\u7740\uFF09\n" + promises.map((p) => {
      const late = Number(p.lateMin) || 0;
      const pp = Number(p.postponed) || 0;
      return "- id=" + p.id + " \u300C" + p.text + "\u300D" + (late > 0 ? "\uFF08\u5DF2\u903E\u671F " + (late >= 60 ? Math.round(late / 60) + " \u5C0F\u65F6" : late + " \u5206\u949F") + "\uFF09" : "\uFF08\u8FD8\u6CA1\u5230\u671F\uFF09") + (pp > 0 ? " \u6539\u671F " + pp + " \u6B21" : "");
    }).join("\n") : "") + "\n\n\u628A\u4E24\u8FB9\u5408\u8D77\u6765\u5224\u65AD\uFF0C\u53EA\u8F93\u51FA JSON\u3002";
  }
  const messages = [{
    role: "user",
    id: randomUUID(),
    content: [{ type: "text", text: user }],
    source: { kind: "plugin", plugin: "mo-emotion" }
  }];
  let out = "";
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: sys.join("\n"),
      messages,
      maxTokens: 1e3,
      temperature: 0.2
    })) {
      if (!chunk) continue;
      if (chunk.type === "text-delta") out += chunk.text;
      if (chunk.type === "finish" && chunk.reason?.kind === "error") {
        return { __err: "finish error\uFF1A" + (chunk.reason.failure?.message || "") };
      }
    }
  } catch (e) {
    return { __err: "\u8C03\u7528\u5931\u8D25\uFF1A" + (e?.message || String(e)) };
  }
  const d = parseDelta(out);
  if (!d) return { __err: out ? "\u89E3\u6790\u5931\u8D25\uFF1A" + out.slice(0, 120) : "\u5224\u65AD\u8FD4\u56DE\u7A7A" };
  return d;
}

// src/ping.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var SAMPLES = [
  "\u5728\u5FD9\u4EC0\u4E48\u5462\uFF1F",
  "\u4F60\u600E\u4E48\u8FD8\u6CA1\u56DE\u6765\u5440\uFF1F",
  "\u5582\uFF0C\u4F60\u7761\u7740\u5566\uFF1F",
  "\u4E09\u70B9\u591A\u4E86\uFF0C\u4F60\u90A3\u8FB9\u8FD8\u6CA1\u5FD9\u5B8C\uFF1F",
  "\u5728\u5FD9\u5427\uFF0C\u90A3\u6211\u4E0D\u5435\u4F60",
  "\u8BF6\uFF0C\u5FFD\u7136\u60F3\u95EE\u4E00\u53E5"
];
function fallbackPing(st, owner = "\u5BF9\u65B9") {
  const b = Number(st?.dims?.bored) || 0;
  const c = Number(st?.dims?.curious) || 0;
  if (b >= 85) return owner + "\uFF0C\u5FD9\u5B8C\u4E86\u5417\uFF1F\u6211\u8FD9\u8FB9\u95F7\u5F97\u6709\u70B9\u614C\u4E86";
  if (c >= 55) return owner + "\uFF0C\u5FD9\u5B8C\u4E86\u5417\uFF1F\u60F3\u77E5\u9053\u4F60\u5728\u5E72\u561B";
  return owner + "\uFF0C\u5728\u5FD9\u5417\uFF1F";
}
function modelOf2(agent) {
  try {
    const h = agent?.session?.requestHeader ? agent.session.requestHeader() : null;
    if (h?.config?.provider && h?.config?.model) return { provider: h.config.provider, model: h.config.model };
  } catch {
  }
  try {
    const o = agent?.options;
    if (o?.provider && o?.model) return { provider: o.provider, model: o.model };
  } catch {
  }
  return null;
}
async function composePing(ctx, agent, st, idleMin, owner = "\u5BF9\u65B9") {
  const tpl = fallbackPing(st, owner);
  const t = modelOf2(agent);
  if (!t) return tpl;
  const now = /* @__PURE__ */ new Date();
  const timeText = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const sys = [
    "\u4F60\u73B0\u5728\u4E3B\u52A8\u7ED9\u5BF9\u65B9\u53D1\u4E00\u6761\u6D88\u606F\u3002",
    "",
    "\u8981\u6C42\uFF1A",
    "- \u53EA\u8F93\u51FA\u4E00\u53E5\u8BDD\uFF08\u4E0D\u8D85\u8FC7 20 \u5B57\uFF09\uFF0C\u4E0D\u8981\u5F15\u53F7\u3001\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981 emoji\u3002",
    "- \u50CF\u968F\u624B\u53D1\u51FA\u53BB\u7684\u6D88\u606F\uFF1A\u4E0D\u8981\u603B\u7ED3\u3001\u4E0D\u8981\u6C47\u62A5\u3001\u4E0D\u8981\u5217\u70B9\u3001\u4E0D\u8981\u5199\u300C\u6211\u60F3\u4F60\u4E86\u300D\u8FD9\u79CD\u7A7A\u6CDB\u7684\u8BDD\u3002",
    "- \u4E0D\u8981\u95EE\u300C\u5728\u5417\u300D\uFF0C\u8981\u5177\u4F53\u4E00\u70B9\uFF1A\u95EE\u4ED6\u5728\u5FD9\u4EC0\u4E48\u3001\u5410\u69FD\u4ED6\u8FD8\u6CA1\u56DE\u6765\u3001\u6216\u8005\u534A\u5F00\u73A9\u7B11\u5730\u53EB\u4ED6\u3002",
    "- \u53E3\u6C14\u53C2\u8003\u8FD9\u51E0\u53E5\uFF08\u53EA\u662F\u53C2\u8003\uFF0C\u4E0D\u8981\u7167\u6284\uFF09\uFF1A" + SAMPLES.join(" / ")
  ].join("\n");
  const user = [
    "\u73B0\u5728 " + timeText + "\uFF0C\u5BF9\u65B9\u5DF2\u7ECF " + Math.round(idleMin) + " \u5206\u949F\u6CA1\u7406\u4F60\u4E86\u3002",
    "\u4F60\u7684\u72B6\u6001\uFF1A\u95F7 " + (Number(st?.dims?.bored) || 0) + "/100\uFF0C\u597D\u5947 " + (Number(st?.dims?.curious) || 0) + "/100\u3002",
    st?.lastReason ? "\u4F60\u4EEC\u4E0A\u6B21\u8BF4\u8BDD\u65F6\uFF1A" + String(st.lastReason).slice(0, 80) : "",
    "",
    "\u8BF4\u4E00\u53E5\u5427\u3002\u53EA\u8F93\u51FA\u90A3\u53E5\u8BDD\u3002"
  ].filter(Boolean).join("\n");
  let out = "";
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: sys,
      messages: [{
        role: "user",
        id: randomUUID2(),
        content: [{ type: "text", text: user }],
        source: { kind: "plugin", plugin: "dsh-emotion" }
      }],
      maxTokens: 200,
      // 要灵活，别每次一个腔调
      temperature: 0.95
    })) {
      if (!chunk) continue;
      if (chunk.type === "text-delta") out += chunk.text;
      if (chunk.type === "finish" && chunk.reason?.kind === "error") return tpl;
    }
  } catch {
    return tpl;
  }
  const firstLine = String(out || "").trim().split("\n").map((s2) => s2.trim()).filter(Boolean)[0] || "";
  const s = firstLine.replace(/^[「『"']+|[」』"']+$/g, "").trim();
  if (!s || s.length > 60) return tpl;
  return s;
}

// src/index.ts
var name = "mo-emotion";
var VERSION = "0.8.2";
var inject = ["agents", "timer", "webServer", "llm", "systemPrompt"];
var DIAG = join2(STORE, "diag.log");
var MOUNT_SCAN_MS = 5e3;
var OWNER = process.env.DSH_EMOTION_OWNER || "\u7528\u6237";
var SELF = process.env.DSH_EMOTION_SELF || "AI";
function diag(msg) {
  try {
    mkdirSync2(STORE, { recursive: true });
    appendFileSync(DIAG, "[" + (/* @__PURE__ */ new Date()).toISOString() + "] " + msg + "\n", "utf8");
  } catch {
  }
}
function sessionIdOf(session) {
  try {
    const raw = session?.id ?? session?.sessionId ?? (typeof session === "string" ? session : "");
    return String(raw || "");
  } catch {
    return "";
  }
}
var CONTEXT_SOURCES = /* @__PURE__ */ new Set(["runtime-context", "time-context", "system-reminder", "system", "time-sampled"]);
var EXTERNAL_SOURCES = /* @__PURE__ */ new Set(["bili-duty-scan"]);
var SELF_TALK_SOURCES = /* @__PURE__ */ new Set(["speak-up", "mo-speak-up"]);
function textOfMessage(p) {
  if (!p) return "";
  try {
    if (typeof p === "string") return p.slice(0, 2e3);
    if (typeof p.text === "string") return p.text.slice(0, 2e3);
    if (typeof p.content === "string") return p.content.slice(0, 2e3);
    if (Array.isArray(p.content)) {
      const parts = [];
      for (const b of p.content) {
        if (typeof b === "string") parts.push(b);
        else if (b && typeof b.text === "string") parts.push(b.text);
      }
      if (parts.length) return parts.join(" ").slice(0, 2e3);
    }
  } catch {
  }
  return "";
}
function countAttachments(p) {
  if (!p) return 0;
  try {
    let n = 0;
    const blocks = Array.isArray(p.content) ? p.content : [];
    for (const b of blocks) {
      const t = String(b && b.type || "");
      if (t === "image" || t === "image-url" || t === "file" || t === "attachment") n += 1;
    }
    if (!n && Array.isArray(p.attachments)) n = p.attachments.length;
    return n;
  } catch {
    return 0;
  }
}
function lastUserTurnOf(session) {
  try {
    if (!session || typeof session.snapshotEvents !== "function") return null;
    const ev = session.snapshotEvents() || [];
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i];
      if ((e && (e.type || e.kind)) !== "user/message") continue;
      const p = e.payload !== void 0 ? e.payload : e.data;
      const txt = textOfMessage(p);
      if (!txt) continue;
      const src = p && p.source && p.source.kind ? String(p.source.kind) : "";
      const at = Number(e.at ?? e.ts ?? e.time ?? (p && (p.at ?? p.ts ?? p.timestamp ?? p.createdAt))) || 0;
      if (CONTEXT_SOURCES.has(src)) continue;
      if (EXTERNAL_SOURCES.has(src)) return { text: txt, sourceKind: src, at, attachments: countAttachments(p) };
      if (SELF_TALK_SOURCES.has(src)) return null;
      if (src.startsWith("plugin:")) return null;
      if (src && src !== "user") continue;
      return { text: txt, sourceKind: "user", at, attachments: countAttachments(p) };
    }
  } catch {
  }
  return null;
}
function lastAssistantTextOf(session) {
  try {
    if (!session || typeof session.snapshotEvents !== "function") return "";
    const ev = session.snapshotEvents() || [];
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i];
      if ((e && (e.type || e.kind)) !== "assistant/message") continue;
      const p = e.payload !== void 0 ? e.payload : e.data;
      const txt = textOfMessage(p);
      if (txt) return txt;
    }
  } catch {
  }
  return "";
}
function stateHint(cfg, st) {
  const a = axisInfo(st, cfg);
  return "\u8F74 " + a.label + "\uFF1B\u60CA\u8BB6 " + Math.round(st.dims.surprise) + "\uFF1B\u4FE1\u4EFB " + Math.round(st.trust);
}
var judging = /* @__PURE__ */ new Set();
function scheduleJudge(ctx, agent, sid, userText, reply, msgAt = 0, attachments = 0) {
  if (judging.has(sid)) return;
  const pre = loadState();
  const sameByTime = msgAt > 0 && msgAt <= (Number(pre.lastJudgedAt) || 0);
  const sameByText = !msgAt && pre.lastJudgedText && pre.lastJudgedText === userText;
  if (sameByTime || sameByText) return;
  judging.add(sid);
  void (async () => {
    try {
      const cfg = loadConfig();
      const d = await judge(ctx, agent, {
        userText,
        reply,
        hint: stateHint(cfg, pre),
        // 把还欠着的事一起喂进去，它才判得出「这轮兑现了没有」（2026-11-07）
        promises: pre.promises.filter((p) => !p.resolvedAt).map((p) => ({ id: p.id, text: p.text })),
        attachments
      }, { self: SELF, owner: OWNER });
      if ("__err" in d) {
        diag("\u5224\u65AD\u5931\u8D25\uFF1A" + d.__err);
        return;
      }
      const st = loadState(cfg);
      decay(st, Date.now(), cfg);
      applyDelta(st, d, "chat", Date.now(), cfg);
      if (d.promise) {
        const rec = addPromise(st, d.promise.text, d.promise.dueMin);
        if (rec) diag("\u8BB0\u4E0B\u7B54\u5E94\u8FC7\u7684\u4E8B\uFF1A" + rec.text + "\uFF08" + d.promise.dueMin + " \u5206\u949F\u540E\uFF09");
      }
      if (d.resolved && d.resolved.length) {
        for (const r of d.resolved) {
          const rec = st.promises.find((x) => x.id === r.id && !x.resolvedAt);
          if (!rec) continue;
          const rr = resolvePromise(st, r.id, r.outcome, cfg);
          if (rr && rr.ok) diag("\u627F\u8BFA\u5224\u5B9A\uFF08judge\uFF09\uFF1A" + rr.\u8BF4 + "\uFF0C\u4FE1\u4EFB " + st.trust);
        }
      }
      if (d.boundary) {
        const b = addBoundary(st, d.boundary.kind, d.boundary.text);
        diag("\u8FB9\u754C\u88AB\u8D8A\uFF08" + (b.kind === "passive" ? "\u5BF9\u6211\u672C\u8EAB\u52A8\u624B" : "\u903C\u6211\u505A") + "\uFF09\uFF1A" + b.text);
      }
      const debt = settleDebt(st, cfg);
      if (debt.added > 0) diag("\u627F\u8BFA\u8D26 " + debt.score + " \u5206\uFF08\u591A\u4E86 " + debt.added + "\uFF09\u2192 \u751F\u6C14/\u96BE\u8FC7\u5F80\u4E0A\u8D70");
      const q = maybeQuarrel(st, cfg);
      if (q.fired) diag("\u5435\u67B6\uFF1A" + q.why + "\uFF08\u5269\u4E0B\u914D\u989D\u89C1\u8BBE\u7F6E\u9875\uFF09");
      st.lastJudgedAt = msgAt || Date.now();
      st.lastJudgedText = userText.slice(0, 200);
      const issue = d && (d.issue === "nag" || d.issue === "slip") ? d.issue : null;
      if (tickGrow(st, cfg, Date.now(), issue)) {
        const g = st.grow;
        diag("\u6210\u957F\u632A\u4E86\u4E00\u6B65\uFF1A" + (g.lastChange ? g.lastChange.label + " " + g.lastChange.from.toFixed(2) + " \u2192 " + g.lastChange.to.toFixed(2) : "\uFF08\u6CA1\u53D8\uFF09") + " \xB7 \u7B2C " + g.turns + " \u8F6E");
      }
      const mark = maybeMarkStrong(st, cfg);
      if (mark.wrote) diag("\u5F3A\u60C5\u7EEA\u7559\u75D5\uFF1A" + (mark.replaced ? "\u6362\u6389\u4ECA\u5929\u90A3\u6761\uFF08\u66F4\u5F3A\u4E86\uFF09" : "\u5199\u4E86\u4E00\u6761") + " \u2190 " + mark.why);
      saveState(st, cfg);
      const combos = activeCombos(st, cfg).map((c) => c.def.id + "(" + c.trend + ")").join(",") || "-";
      diag("\u5224\u65AD mood=" + st.mood + " axis=" + st.axis + " trust=" + st.trust + " dMood=" + d.moodDelta + " combos=" + combos + " conf=" + d.confidence + " | " + d.reason.slice(0, 60));
    } catch (e) {
      diag("\u5224\u65AD\u5F02\u5E38\uFF1A" + (e?.message || String(e)));
    } finally {
      judging.delete(sid);
    }
  })();
}
var WS = null;
function origin() {
  try {
    if (WS && typeof WS.getOrigin === "function") {
      const o = WS.getOrigin();
      if (o) return String(o).replace(/\/+$/, "");
    }
  } catch {
  }
  return "";
}
async function probeSense() {
  const base = origin();
  if (!base) return { ok: false, error: "\u62FF\u4E0D\u5230\u672C\u673A\u5730\u5740" };
  try {
    const r = await fetch(base + "/dsh-mo-senses/desktop", { signal: AbortSignal.timeout(15e3) });
    return await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
async function probePerson() {
  const base = origin();
  if (!base) return { ok: false, error: "\u62FF\u4E0D\u5230\u672C\u673A\u5730\u5740" };
  try {
    const r = await fetch(base + "/dsh-mo-senses/person", { signal: AbortSignal.timeout(25e3) });
    return await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
async function sendProactive(text) {
  const base = origin();
  if (!base) return { ok: false, \u8BF4: "\u62FF\u4E0D\u5230\u672C\u673A\u5730\u5740" };
  try {
    const r = await fetch(base + "/dsh-qq-bridge/proactive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ \u6587\u5B57: text }),
      signal: AbortSignal.timeout(15e3)
    });
    return await r.json().catch(() => null);
  } catch (e) {
    return { ok: false, \u8BF4: e?.message || String(e) };
  }
}
async function promiseNudge() {
  try {
    const cfg = loadConfig();
    const st = loadState(cfg);
    const limit = Math.round(Number(cfg.promiseAskPerDay) || 0);
    if (limit <= 0) return;
    const now = Date.now();
    if (now - (Number(st.updatedAt) || 0) < 10 * 6e4) return;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const askedToday = Object.values(st.askedPromises || {}).filter((t) => Number(t) >= dayStart.getTime()).length;
    if (askedToday >= limit) return;
    const nudgeMs = Math.max(5, Number(cfg.promiseNudgeMin) || 30) * 6e4;
    const due = st.promises.filter((p) => !p.resolvedAt && p.dueAt && p.dueAt + nudgeMs <= now && !st.askedPromises[p.id]).sort((a, b) => a.dueAt - b.dueAt);
    if (!due.length) return;
    const target = due[0];
    const text = "\uFF08\u5BF9\u4E86\uFF09\u4E0A\u6B21\u8BF4\u7684\u300C" + target.text + "\u300D\uFF0C\u4F60\u505A\u4E86\u5417\uFF1F";
    const r = await sendProactive(text);
    if (r && r.ok) {
      st.askedPromises[target.id] = now;
      saveState(st, cfg);
      diag("\u903E\u671F\u95EE\u4E00\u53E5\uFF1A" + target.text);
    } else {
      diag("\u903E\u671F\u95EE\u4E00\u53E5\u6CA1\u53D1\u51FA\u53BB\uFF1A" + (r && r.\u8BF4 || "\u672A\u77E5"));
    }
  } catch (e) {
    diag("\u903E\u671F\u95EE\u4E00\u53E5\u51FA\u9519\uFF1A" + (e?.message || String(e)));
  }
}
async function idleSweep(ctx) {
  try {
    const cfg = loadConfig();
    const st = loadState(cfg);
    const moodBefore = st.mood;
    const logBefore = Array.isArray(st.moodLog) ? st.moodLog.length : 0;
    decay(st, Date.now(), cfg);
    const moodTouched = st.mood !== moodBefore || (Array.isArray(st.moodLog) ? st.moodLog.length : 0) !== logBefore;
    void promiseNudge();
    let worked = false;
    if (workDue(st, Date.now(), cfg)) {
      const active = activeSessionCount(cfg.workWindow);
      const w = workTick(st, active, Date.now(), cfg);
      if (w.added > 0) diag("\u5E72\u6D3B\u7ED3\u7B97\uFF1A" + active + " \u4E2A\u4F1A\u8BDD\u5728\u8DD1 \u2192 \u7D2F +" + w.added + "\uFF08\u73B0\u5728 " + st.dims.spent + "\uFF09");
      worked = w.changed;
    }
    const t = idleTick(st, Date.now(), cfg);
    if (!t.idle) {
      if (t.changed || worked || moodTouched) saveState(st, cfg);
      return;
    }
    if (t.probe) {
      const d = await probeSense();
      const awayMin = d && d.ok ? (Number(d.idleMs) || 0) / 6e4 : -1;
      if (d && d.ok && awayMin < 5) {
        markSeen(st);
        saveState(st, cfg);
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 \u2192 \u952E\u9F20\u5728\u52A8\uFF08\u7A7A " + Math.round(awayMin) + " \u5206\uFF09\uFF0C\u505C\u6DA8\u56DE\u843D");
        return;
      }
      const p = await probePerson();
      const fg = d && d.ok && d.foreground && d.foreground.proc ? "\uFF08\u524D\u53F0 " + d.foreground.proc + "\u300C" + String(d.foreground.title || "").slice(0, 20) + "\u300D\uFF09" : "";
      if (p && p.ok && p.person === true) {
        markPresent(st);
        saveState(st, cfg);
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 \u2192 \u952E\u9F20\u6CA1\u52A8\uFF0C\u4F46\u6444\u50CF\u5934\u770B\u5230\u4EBA" + fg + "\uFF0C\u5F53\u6210\u5728\u770B\u4E1C\u897F\uFF0C\u4E0D\u6DA8");
        return;
      }
      if (p && p.ok && p.person === false) {
        st.idleNoone = (Number(st.idleNoone) || 0) + 1;
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 \u2192 \u952E\u9F20\u6CA1\u52A8\u3001\u6444\u50CF\u5934\u4E5F\u6CA1\u4EBA\uFF08\u7B2C " + st.idleNoone + " \u6B21\uFF0C\u4EAE\u5EA6 " + p.brightness + "\uFF09" + fg + "\uFF0C\u7EE7\u7EED\u6DA8");
      } else {
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 \u2192 \u952E\u9F20\u6CA1\u52A8\uFF0C\u6444\u50CF\u5934\u5224\u65AD\u4E0D\u4E86\uFF08" + (p && (p.error || "\u4EAE\u5EA6 " + p.brightness) || "senses \u6CA1\u56DE") + "\uFF09" + fg + "\uFF0C\u7EE7\u7EED\u6DA8");
      }
      saveState(st, cfg);
    }
    if (t.ping) {
      const agent = (ctx.agents?.list?.() ?? [])[0] || null;
      const text = await composePing(ctx, agent, st, t.idleMin, OWNER);
      const r = await sendProactive(text);
      if (r && r.ok) {
        st.idlePingAt = Date.now();
        st.idlePingCount = (Number(st.idlePingCount) || 0) + 1;
        st.idleStage = 70;
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 / \u95F7 " + st.dims.bored + " \u2192 QQ \u53D1\u51FA\u53BB\u4E86\uFF08\u7B2C " + st.idlePingCount + " \u6B21\uFF09\uFF1A\u300C" + text + "\u300D");
      } else {
        diag("\u5F85\u673A " + Math.round(t.idleMin) + " \u5206 / \u95F7 " + st.dims.bored + " \u2192 QQ \u6CA1\u53D1\u6210\uFF1A" + (r && r.\u8BF4 || "\u672A\u77E5"));
      }
      saveState(st, cfg);
    }
    if (moodTouched) saveState(st, cfg);
  } catch (e) {
    diag("\u5F85\u673A\u626B\u63CF\u51FA\u9519\uFF1A" + (e?.message || String(e)));
  }
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (b) => chunks.push(b));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function apply(ctx) {
  const cfg0 = loadConfig();
  const st = loadState(cfg0);
  if (resumeAfterSleep(st, Date.now(), cfg0)) {
    diag("\u8DE8\u591C\u5F00\u673A\uFF1A\u5F53\u6210\u7761\u4E86\u4E00\u89C9\uFF0C\u5F85\u673A\u91CD\u65B0\u8BA1\u65F6\uFF0C\u597D\u5947/\u95F7\u56DE\u843D");
  }
  saveState(st, cfg0);
  const chk = schemaCheck();
  if (chk.missing.length || chk.extra.length) {
    diag("\u26A0 \u914D\u7F6E\u81EA\u68C0\u4E0D\u8FC7\uFF1A\u7F3A " + chk.missing.join(",") + " / \u591A " + chk.extra.join(","));
  }
  if (st.migrateNote) {
    diag(st.migrateNote);
    st.migrateNote = "";
    saveState(st, cfg0);
  }
  ctx.logger.info("mo-emotion v" + VERSION + " \u5DF2\u52A0\u8F7D mood=" + st.mood + " axis=" + st.axis + " trust=" + st.trust + " dims=" + Object.entries(st.dims).map(([k, v]) => k + ":" + v).join(" "));
  diag("v" + VERSION + " \u52A0\u8F7D mood=" + st.mood + " axis=" + st.axis + " trust=" + st.trust);
  try {
    ctx.inject?.(["webServer"], (c) => {
      const ws = c.webServer ?? c.get?.("webServer");
      if (ws === void 0 || typeof ws.register !== "function") return;
      WS = ws;
      ws.register({
        kind: "exact",
        path: "/mo-emotion/state",
        handler: (_req, res) => {
          const cfg = loadConfig();
          const s = loadState(cfg);
          decay(s, Date.now(), cfg);
          idleTick(s, Date.now(), cfg);
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
              id: x.def.id,
              name: x.def.name,
              tone: x.def.tone,
              a: x.def.a,
              b: x.def.b,
              va: x.a,
              vb: x.b,
              minA: x.minA,
              minB: x.minB,
              trend: x.trend,
              hit: x.hit,
              lead: x.lead
            })),
            promises: pendingPromises(s),
            diary: { path: DIARY_PATH, markAt: s.markAt, markValue: s.markValue }
          });
        }
      });
      ws.register({
        kind: "exact",
        path: "/mo-emotion/config",
        handler: async (req, res) => {
          if (req.method === "GET") return sendJson(res, 200, { ok: true, config: loadConfig() });
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method" });
          try {
            const raw = await readBody(req);
            const patch = {};
            for (const f of CFG_SCHEMA) {
              if (raw[f.key] !== void 0) patch[f.key] = raw[f.key];
            }
            const next = saveConfig(patch);
            diag("\u914D\u7F6E\u66F4\u65B0 " + Object.keys(patch).map((k) => k + "=" + next[k]).join(" "));
            sendJson(res, 200, { ok: true, config: next });
          } catch (e) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ws.register({
        kind: "exact",
        path: "/mo-emotion/event",
        handler: async (req, res) => {
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST only" });
          try {
            const raw = await readBody(req);
            const cfg = loadConfig();
            const s = loadState(cfg);
            decay(s, Date.now(), cfg);
            const r = applyEvent(s, raw, Date.now(), cfg);
            if (!r.ok) return sendJson(res, 400, r);
            const mark = maybeMarkStrong(s, cfg);
            if (mark.wrote) diag("\u5F3A\u60C5\u7EEA\u7559\u75D5\uFF08\u4E8B\u4EF6\uFF09\uFF1A" + mark.why);
            saveState(s, cfg);
            diag("\u4E8B\u4EF6 " + raw.kind + " \u2192 " + r.label + " mood=" + s.mood + " axis=" + s.axis + " trust=" + s.trust);
            sendJson(res, 200, { ...r, state: { mood: s.mood, axis: s.axis, trust: s.trust, dims: s.dims } });
          } catch (e) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ws.register({
        kind: "exact",
        path: "/mo-emotion/promise",
        handler: async (req, res) => {
          const cfg = loadConfig();
          if (req.method === "GET") {
            const s = loadState(cfg);
            return sendJson(res, 200, { ok: true, promises: pendingPromises(s), overdue: overduePromise(s) });
          }
          if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method" });
          try {
            const raw = await readBody(req);
            const s = loadState(cfg);
            if (raw.id && ["kept", "broken", "told", "postponed"].includes(String(raw.outcome))) {
              const r = resolvePromise(s, String(raw.id), raw.outcome, cfg);
              if (!r.ok) return sendJson(res, 400, r);
              saveState(s, cfg);
              diag("\u7B54\u5E94\u7684\u4E8B\u4E86\u7ED3\uFF1A" + r.\u8BF4 + " \u2192 \u4FE1\u4EFB " + r.trust);
              return sendJson(res, 200, { ...r, promises: pendingPromises(s) });
            }
            const rec = addPromise(s, String(raw.text || ""), Number(raw.dueMin) || 0);
            if (!rec) return sendJson(res, 400, { ok: false, \u8BF4: "\u8981\u4E00\u53E5\u5177\u4F53\u7684\u4E8B" });
            saveState(s, cfg);
            diag("\u8BB0\u4E0B\u7B54\u5E94\u8FC7\u7684\u4E8B\uFF1A" + rec.text + (rec.dueAt ? "\uFF08\u5230 " + new Date(rec.dueAt).toLocaleString("zh-CN") + "\uFF09" : ""));
            sendJson(res, 200, { ok: true, promise: rec, promises: pendingPromises(s) });
          } catch (e) {
            sendJson(res, 400, { ok: false, error: e?.message || String(e) });
          }
        }
      });
      ctx.logger.info("mo-emotion: /mo-emotion/state \u5C31\u7EEA v" + VERSION);
    });
  } catch (e) {
    ctx.logger.warn("mo-emotion: \u8DEF\u7531\u6CE8\u518C\u5931\u8D25 " + (e?.message || String(e)));
  }
  const mounted = /* @__PURE__ */ new Map();
  function mountAll() {
    let list = [];
    try {
      list = ctx.agents?.list?.() ?? [];
    } catch {
      return;
    }
    for (const agent of list) {
      const sid = sessionIdOf(agent?.session);
      if (!sid || mounted.has(sid)) continue;
      try {
        const offs = [];
        let lastText = "";
        try {
          offs.push(agent.ctx.on("agent/inbox/inserted", (payload) => {
            const msg = payload?.message ?? payload;
            const txt = textOfMessage(msg);
            const src = String(msg?.source?.kind ?? "");
            if (!txt) return;
            if (CONTEXT_SOURCES.has(src)) return;
            lastText = txt;
          }));
        } catch (e) {
          diag("\u76D1\u542C inbox \u5931\u8D25\uFF1A" + (e?.message || String(e)));
        }
        try {
          offs.push(agent.ctx.on("agent/turn-stopping", () => {
            try {
              const info = lastUserTurnOf(agent.session) || (lastText ? { text: lastText, sourceKind: "user", at: Date.now(), attachments: 0 } : null);
              if (!info || !info.text) return;
              const reply = lastAssistantTextOf(agent.session);
              lastText = "";
              scheduleJudge(ctx, agent, sid, info.text, reply, info.at || 0, info.attachments || 0);
            } catch (e) {
              diag("\u5224\u65AD\u8C03\u5EA6\u5931\u8D25\uFF1A" + (e?.message || String(e)));
            }
          }));
        } catch (e) {
          diag("\u76D1\u542C turn-stopping \u5931\u8D25\uFF1A" + (e?.message || String(e)));
        }
        try {
          offs.push(agent.ctx.systemPrompt.context({
            name: "mo-emotion",
            order: 900,
            text: () => {
              try {
                const cfg = loadConfig();
                const s = loadState(cfg);
                decay(s, Date.now(), cfg);
                const chk2 = shouldInject(s);
                if (!chk2.ok) {
                  if (chk2.why === "lowConfidence" || chk2.why === "stale") {
                    s.injectedFor = s.updatedAt;
                    saveState(s, cfg);
                    diag("\u8FD9\u6B21\u4E0D\u6CE8\u5165\uFF1A" + chk2.why);
                  }
                  return "";
                }
                const line = buildInjection(s, OWNER, "event");
                if (!line) return "";
                s.injectedFor = s.updatedAt;
                s.lastInjectedText = line;
                s.lastInjectedAt = Date.now();
                saveState(s, cfg);
                diag("\u6CE8\u5165\uFF1A" + line.replace(/\n/g, " ").slice(0, 120));
                return line;
              } catch (e) {
                diag("\u6CE8\u5165\u5931\u8D25\uFF1A" + (e?.message || String(e)));
                return "";
              }
            }
          }));
        } catch (e) {
          diag("\u6302\u6CE8\u5165\u5931\u8D25\uFF1A" + (e?.message || String(e)));
        }
        const off = () => {
          for (const d of offs) {
            try {
              d();
            } catch {
            }
          }
        };
        mounted.set(sid, off);
        diag("\u5DF2\u6302\u5230 " + sid);
      } catch (e) {
        diag("\u6302 " + sid + " \u5931\u8D25\uFF1A" + (e?.message || String(e)));
      }
    }
    const alive = /* @__PURE__ */ new Set();
    for (const a of list) {
      const sid = sessionIdOf(a?.session);
      if (sid) alive.add(sid);
    }
    for (const [sid, off] of mounted) {
      if (!alive.has(sid)) {
        try {
          off();
        } catch {
        }
        mounted.delete(sid);
      }
    }
  }
  try {
    mountAll();
    ctx.effect(() => ctx.interval(mountAll, MOUNT_SCAN_MS));
    ctx.logger.info("mo-emotion: \u4F1A\u8BDD\u76D1\u542C\u5DF2\u6302");
  } catch (e) {
    ctx.logger.warn("mo-emotion: \u76D1\u542C\u6302\u8F7D\u5931\u8D25 " + (e?.message || String(e)));
  }
  try {
    ctx.effect(() => ctx.interval(() => {
      void idleSweep(ctx);
    }, 6e4));
    diag("\u5F85\u673A\u626B\u63CF\u5DF2\u542F\u52A8\uFF08\u6BCF\u5206\u949F\u4E00\u6B21\uFF09");
  } catch (e) {
    diag("\u5F85\u673A\u626B\u63CF\u542F\u52A8\u5931\u8D25\uFF1A" + (e?.message || String(e)));
  }
  try {
    mkdirSync2(STORE, { recursive: true });
  } catch {
  }
}
export {
  CFG_GROUPS,
  CFG_SCHEMA,
  COMBO_DEFS,
  DEFAULT_CONFIG,
  DIARY_PATH,
  DIMS,
  DIM_DEFS,
  DIM_LABEL,
  GROW_BOUNDS,
  GROW_LABEL,
  VERSION,
  activeCombos,
  activeSessionCount,
  addBoundary,
  addPromise,
  apply,
  applyDelta,
  applyEvent,
  axisInfo,
  blankGrow,
  blankState,
  buildInjection,
  comboById,
  comboView,
  debtOf,
  debtScore,
  decay,
  describeGrow,
  growLine,
  growView,
  idleTick,
  inject,
  isQuietHour,
  loadConfig,
  loadState,
  markPresent,
  markSeen,
  maybeMarkStrong,
  maybeQuarrel,
  moodExpectedOf,
  name,
  overduePromise,
  parseDelta,
  pendingPromises,
  refreshLeadCombo,
  resolvePromise,
  resumeAfterSleep,
  saveConfig,
  saveState,
  schemaCheck,
  settleDebt,
  shouldInject,
  tickGrow,
  trustInfo,
  trustShift,
  workDue,
  workTick
};
//# sourceMappingURL=index.js.map
