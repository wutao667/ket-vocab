import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建期产物生成器（A2 方案）
 *
 * 职责：按目标应用，把模板里的占位符替换成真实品牌信息，
 * 输出到 public/ 与 index.html。必须在 `vite build` 之前跑。
 *
 * 为什么不用模板引擎：只有 4 个变量、3 个文件，手写 replace 最直观，
 * 也不用给项目引入额外依赖（本机内存紧张，构建链越短越好）。
 *
 * 用法：node scripts/build-app.mjs pet
 */

const APP = (process.argv[2] || process.env.APP_ID || 'ket').toLowerCase()
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(root, 'src/config/apps.json')

const registry = JSON.parse(await readFile(configPath, 'utf8'))
const config = registry[APP]
if (!config) throw new Error(`未知应用：${APP}（apps.json 里没有该键）`)

const templateDir = resolve(root, 'templates')
const publicDir = resolve(root, 'public')

/** 一次替换多个占位符 */
function fill(template, values) {
  let output = template
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`__${key}__`).join(String(value))
  }
  return output
}

const vars = {
  BRAND: config.brandName,
  BRAND_MARK: config.brandMark,
  BRAND_LATIN: config.brandLatin,
  TITLE: config.title,
  DESCRIPTION: config.description,
  CACHE_PREFIX: config.cachePrefix,
  WORD_COUNT: config.wordCount,
  EXAM_NAME: config.examName,
  SITE_URL: config.siteUrl,
}

// ---- manifest.webmanifest
const manifestTpl = await readFile(resolve(templateDir, 'manifest.webmanifest.tpl'), 'utf8')
await mkdir(publicDir, { recursive: true })
await writeFile(resolve(publicDir, 'manifest.webmanifest'), fill(manifestTpl, vars))

// ---- sw.js
const swTpl = await readFile(resolve(templateDir, 'sw.js.tpl'), 'utf8')
await writeFile(resolve(publicDir, 'sw.js'), fill(swTpl, vars))

// ---- index.html
const htmlTpl = await readFile(resolve(templateDir, 'index.html.tpl'), 'utf8')
await writeFile(resolve(root, 'index.html'), fill(htmlTpl, vars))

console.log(`[${APP}] 生成 manifest.webmanifest / sw.js / index.html`)
console.log(`[${APP}] 品牌：${config.brandName}（${config.examName}，${config.wordCount} 词）`)
console.log(`[${APP}] 站点：${config.siteUrl}`)
