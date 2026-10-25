/**
 * 运行时词条。只包含界面真正读取的字段。
 *
 * 构建期的溯源信息（原 source_ipa / source_example / source_example_zh）
 * 已从发布数据中剔除：界面从不读取它们，保留会让首屏包大 140KB+。
 * 需要溯源时请查 ../data/ket_vocab_dataset.json（完整原始数据）。
 */
export interface VocabEntry {
  id: string
  word: string
  pos: string
  ipa: string
  zh: string
  example: string
  example_zh: string
}

export interface Topic { id: string; name: string; vocabIds: string[] }
