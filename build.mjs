/**
 * 构建：src/index.ts -> lib/index.js（需要 esbuild，见下方提示）
 *
 * 构建后自动跑两种自检（esbuild 不做类型检查，漏 import 也能「成功」）：
 *   ① client.js 语法（只解析、不执行）
 *   ② check.mjs：把 lib 当宿主挂一遍，四条路由各打一次 + 关键纯函数
 * 任何一条挂掉，构建返回非 0。
 */
import { readFileSync } from 'node:fs'

let build
try {
  ({ build } = await import('esbuild'))
} catch {
  console.error('[build] 缺少 esbuild。在项目目录跑：pnpm add -D esbuild（或 npm i -D esbuild）')
  process.exit(1)
}

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
})

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
