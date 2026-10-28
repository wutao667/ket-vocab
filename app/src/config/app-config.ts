/**
 * 应用配置中心（A2 方案：一套代码、两次构建、两个站点）
 *
 * 为什么要集中到这里：
 * 产品有两个词库站点（KET A2 Key / PET B1 Preliminary），功能完全相同，
 * 只有品牌文案、存储键前缀、数据库名、词条 ID 前缀这些"身份标识"不同。
 * 把这些差异全部收敛到 apps.json，业务代码只引用 config，
 * 将来改功能只需改一处，不会出现「KET 修好、PET 还是老 bug」。
 *
 * 唯一数据源是 ./apps.json —— 构建脚本（scripts/build-app.mjs）也读它，
 * 这样前端运行时和产物生成（manifest / service worker / index.html）用的
 * 必然是同一份配置，不会出现两处定义漂移。
 *
 * 构建时通过 VITE_APP_ID 选择：
 *   VITE_APP_ID=ket → https://ket.huaguo.site
 *   VITE_APP_ID=pet → https://pet.huaguo.site
 * 未指定时默认 ket，保证既有部署不受影响。
 */
import registry from './apps.json'

export type AppId = 'ket' | 'pet' | 'toefl'

export interface AppConfig {
  /** 应用标识，用于构建分支判断 */
  id: AppId
  /** 词条 ID 前缀，配合四位序号，如 ket-0001 / pet-0001 */
  idPrefix: string
  /** 词条总数（用于文案与自检） */
  wordCount: number
  /** 考试全称，用于副标题与 meta */
  examName: string
  /** 品牌中文名，如「KET 词匣」 */
  brandName: string
  /** 品牌英文名，用于小字号上行文案 */
  brandLatin: string
  /** 启动画面上的单字标记 */
  brandMark: string
  /** 浏览器标题 */
  title: string
  /** meta description */
  description: string
  /** localStorage / 事件名统一前缀。必须各应用独立，否则同域下会互相串数据 */
  storagePrefix: string
  /** IndexedDB 数据库名。同样必须独立 */
  dbName: string
  /** Service Worker 缓存名前缀，用于版本隔离 */
  cachePrefix: string
  /** 站点地址，供构建期产物使用 */
  siteUrl: string
}

function resolveAppId(): AppId {
  const raw = (import.meta.env?.VITE_APP_ID ?? '').trim().toLowerCase()
  // 必须按 registry 的实际键逐个校验。
  // 早先这里写成「只认 pet，其余都当 ket」，导致 TOEFL 站点悄悄拿着 KET 配置跑：
  // 界面显示 KET 文案、本地库名也变成 ket-vocab（构建期产物却是对的，
  // 因为 build-app.mjs 直接读 apps.json，与运行时不是同一条路径）。
  const known = Object.keys(registry) as AppId[]
  return known.includes(raw as AppId) ? (raw as AppId) : 'ket'
}

export const APP_ID: AppId = resolveAppId()
export const config: AppConfig = (registry as Record<AppId, AppConfig>)[APP_ID]

/**
 * 生成带应用前缀的存储键。
 * 例：storageKey('active-profile') → 'ket-active-profile' / 'pet-active-profile'
 */
export function storageKey(suffix: string): string {
  return `${config.storagePrefix}-${suffix}`
}

/**
 * 生成应用内事件名。
 * 事件在同一 window 上派发，两个应用若同域共存也必须互不干扰。
 */
export function eventName(suffix: string): string {
  return `${config.storagePrefix}-${suffix}`
}
