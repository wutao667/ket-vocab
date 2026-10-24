# KET 背单词应用 Phase 2 验收报告

验收日期：2026-10-24（Asia/Shanghai）

## 实现摘要

本阶段保留 Phase 1 的选词、列表创建/维护和滚动记忆，新增共享学习页、双向背诵页、完成页、生词本和 TTS 回退层。学习模式选择连续滚动列表，因为它便于一次浏览所有词的完整六字段；背诵模式使用单卡快照，保证本轮顺序稳定，下一轮才重新读取收藏交集。

IndexedDB 从 v1 升到 v2，只为现有 `favorites` 记录增加可选 `sourceListId`，没有修改只读词库。新收藏记录首次所在列表；重复收藏不会覆盖首次来源。旧记录无来源 ID，按“来源列表已删除”展示。

## 自动验证命令与输出摘要

在 `app/` 执行：

```text
npx vite build
✓ 1621 modules transformed
dist/index.html                  0.46 kB (gzip 0.31 kB)
dist/assets/index-*.css         17.60 kB (gzip 4.29 kB)
dist/assets/index-*.js          778.78 kB (gzip 221.05 kB)
✓ built

npx tsc --noEmit
退出码 0，无输出

npm test
Test Files 7 passed (7)
Tests 18 passed (18)，包含原有 11 项

npm run lint
退出码 0，0 error / 0 warning
```

说明：上面的精确哈希、字节和最终测试数以本报告完成时最后一次命令输出为准；若与后续复构建产物哈希不同，以命令本身输出为准。

## 15 条验收结果

1. **Vite 构建：通过。** 使用要求的 `npx vite build`，未运行 `npm run build`；产物大小见上方输出。
2. **TypeScript：通过。** `npx tsc --noEmit` 退出码 0。
3. **单元测试：通过。** `npm test` 全通过，原有 11 项无回归；新增 TTS 与答案 DOM 安全测试。
4. **Lint：通过。** `npm run lint` 为 0 error / 0 warning。
5. **学习模式：通过。** `LearnPage` 按源列表顺序连续渲染全部词条，每项包含 `word`、`ipa`、`pos`、`zh`、`example`、`example_zh`，并有独立单词/例句朗读按钮。
6. **看英猜中隐藏：通过。** `RecallCard.test.tsx` 静态渲染未揭晓卡片，断言中文释义和例句字符串不在 HTML；揭晓后条件渲染出现。
7. **看中猜英隐藏：通过。** 同一测试断言未揭晓 HTML 不含英文单词、IPA 或例句，揭晓后均出现。
8. **进度：通过。** 页面显示 `index + 1 / snapshot.length`；进度按 `(index + 1) / length`，单词列表与末词均为 100%。
9. **返回保留揭晓：通过。** 本轮用 `Set<number>` 保存已揭晓索引，前后移动不会删除状态；仅开始新一轮时清空。
10. **完成页：通过。** 末词后显示总词数与当前快照内星标数，并提供“再来一轮”“只背本列表生词”“返回列表”。
11. **星标持久化与跨列表一致：通过。** 卡片右上星标始终存在，乐观更新后写入按 `profileId:vocabId` 唯一的 IndexedDB；仓储测试验证写入、读取、取消及首次来源不被覆盖。刷新或其他列表读取同一全局记录。
12. **列表生词交集：通过。** 每次进入/重开通过 `list.vocabIds.filter(favoriteIds.has)` 获取最新交集；空集合显示说明和返回入口。进行中的 `snapshot` 不随收藏变化移除词条。
13. **跨列表生词本：通过。** 首页显示去重收藏数；生词本默认按 `createdAt` 倒序，也可切换主题顺序，并复用学习/背诵页。存在的来源显示列表名，删除后显示“来源列表已删除”。
14. **TTS 回退：通过（mock 验证）。** 单测覆盖所选引擎失败后回退并上报实际引擎、会话死引擎跳过、用户主动选择死引擎仍重试、整条多词文本原样发送及 AbortError 只调用一次不回退。播放按钮显示播放/停止状态，UI 从本次返回值显示实际引擎。
15. **看中猜英防泄漏朗读：通过。** 未揭晓时英文朗读按钮为 disabled，且按钮文本/`aria-label` 只有“揭晓答案后才能朗读英文”，不包含答案；DOM 安全测试同时确认英文未渲染。

## 新增与修改文件

- 新增 `src/data/vocabulary.ts`：词库索引、主题顺序与安全 ID 映射。
- 新增 `src/tts/tts.ts`、`SpeechProvider.tsx`：云端/本地回退、超时、中止和全局单播放实例。
- 新增 `src/components/SpeechControls.tsx`、`RecallCard.tsx`：共享语音控件和无答案泄漏卡片。
- 新增 `src/hooks/useStudySource.ts`：列表、生词交集与全局生词本的数据源装配。
- 新增 `LearnPage.tsx`、`RecallPage.tsx`、`FavoritesPage.tsx`，并扩展路由、首页及列表详情入口。
- 新增 `.env.development`、TTS 测试和背诵 DOM 安全测试。
- 扩展 IndexedDB favorite 元数据与仓储测试；更新本 README。

## 已知缺陷和未完成项

- 当前执行环境没有 Chromium/Chrome 可执行文件，因此没有运行仓库的 CDP 真实浏览器 E2E 脚本；交互验收由组件静态 HTML 测试、仓储测试、TTS mock 测试、类型检查和生产构建覆盖。Phase 1 的 11 项原测试全部保留并通过。
- 生产 TTS 服务没有在本任务中真实发声验证；按任务要求使用 mock `fetch`、`Audio` 和中止信号验证协议及回退逻辑。真实服务的音频可用性仍取决于部署环境的 `/tts` 代理。
- v1 已有收藏没有历史来源字段，无法恢复真实首次来源，只能显示“来源列表已删除”；新收藏具备完整来源追踪。
- Vite 对包含 1723 条内嵌词库的主 JS 给出超过 500 kB 的提示，但构建成功，不影响功能。

## 第三阶段建议

- 为学习页和背诵页补一套真实移动浏览器 E2E，重点覆盖键盘、连续快速切换造成的 abort 竞态、刷新持久化和两种方向的 DOM 泄漏扫描。
- 将词库 JSON 拆成独立懒加载 chunk 或按主题切分，降低首包体积；不要改变稳定词条 ID。
- 若要做多档案/登录同步，需要先设计 favorite 来源和时间戳的冲突合并规则，并为 IndexedDB v2 到服务端数据提供显式迁移。
- 可增加学习进度、错词次数与间隔复习；这些应作为独立记录存储，不要把运行状态写入只读词库。

任务结束时未启动 dev/preview 服务，无需清理后台服务。
