/**
 * 构建：src/index.ts -> lib/index.js（esbuild 借用 meow-memory 的依赖，本插件不带 node_modules）
 *
 * 构建后自动跑两种自检（esbuild 不做类型检查，漏 import 也能「成功」）：
 *   ① client.js 语法（只解析、不执行）
 *   ② check.mjs：把 lib 当宿主挂一遍，四条路由各打一次 + 关键纯函数
 * 任何一条挂掉，构建返回非 0。
 */
import { readFileSync } from 'node:fs'

/** 本地开发可以设 DSH_ESBUILD 指到自己的 esbuild；开源用户装完 esbuild 直接跑即可 */
const esbuildEntry = process.env.DSH_ESBUILD || 'esbuild'

let build
try {
  ({ build } = await import(esbuildEntry))
} catch (e) {
  console.error('找不到 esbuild。只有「重新构建」需要它：npm i -D esbuild 之后再跑。装插件本身不需要构建。')
  process.exit(1)
}

// 某些环境（如运行中的宿主）自带 node 是 Low 完整性，写不进去：
//   设 MO_OUT 时先吐到临时目录，由外部拷回 lib。
const OUT = process.env.MO_OUT || 'lib/index.js'

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
})

if (process.env.MO_OUT) {
  console.log('[构建] 已输出到 ' + OUT + '，跳过自检（拷回 lib 后单独跑 check.mjs）')
  process.exit(0)
}

// ① client.js 语法（new Function 只解析不执行，不会碰 window）
try {
  new Function(readFileSync('client.js', 'utf8'))
  console.log('\n[自检] client.js 语法 OK')
} catch (e) {
  console.error('\n[自检] client.js 语法错误：' + (e && e.message))
  process.exitCode = 1
}

// ② 宿主侧自检
try {
  await import('./check.mjs')
} catch (e) {
  console.error('\n[自检] check.mjs 自己崩了：' + (e && (e.stack || e.message)))
  process.exitCode = 1
}
