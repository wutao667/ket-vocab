import { resolve } from 'node:path';

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.KET_SYNC_PORT || 3117);
export const DB_PATH = resolve(process.env.KET_SYNC_DB || '/var/lib/ket-sync/ket-sync.sqlite3');

// 允许的来源列表。生产只配一个；开发可额外加本地端口。
// 支持逗号分隔，例如：https://ket.huaguo.site,http://127.0.0.1:5173
export const ALLOWED_ORIGINS = (process.env.KET_SYNC_ORIGIN || 'https://ket.huaguo.site')
  .split(',').map((value) => value.trim()).filter(Boolean);
/** 保留旧导出以兼容既有引用：返回第一个来源（生产即唯一来源）。 */
export const ALLOWED_ORIGIN = ALLOWED_ORIGINS[0] || 'https://ket.huaguo.site';

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_OPERATIONS = 100;
export const MAX_CHANGES = 500;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_LISTS_PER_USER = 200;
