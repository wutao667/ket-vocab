# Phase 4 背诵模式改版验收报告

日期：2026-10-24（Asia/Shanghai）

## 实现摘要

- 每次点击“开始本轮”时对当前词条执行 Fisher–Yates 洗牌，将结果冻结在本轮 `snapshot` 中。若极小概率下与上一轮完全相同，会交换前两个词，确保连续两轮不同。
- 看英猜中拆为英文提示区和中文答案区。英文提示区始终显示单词、音标、朗读按钮、英文例句；答案区未揭晓时只渲染 `Eye`，点击该区才执行卡片内揭晓。
- 看中猜英将词性作为独立的灰蓝色小号圆角标签；英文单词、音标、例句和朗读按钮只在揭晓后渲染。
- 两个方向的未揭晓答案都使用条件渲染，真实答案不以透明文本、无障碍标签或 `title` 的形式留在 DOM。

## 验证命令与结果

### 静态构建与自动测试

```text
$ npx vite build
✓ 1621 modules transformed.
dist/index.html                   0.46 kB │ gzip:   0.31 kB
dist/assets/index-D0MLvsMm.css   18.43 kB │ gzip:   4.36 kB
dist/assets/index-DkWnqaWx.js   780.73 kB │ gzip: 221.74 kB
✓ built in 4.59s

$ npx tsc --noEmit
exit 0（无输出）

$ npm test
Test Files  9 passed (9)
Tests       23 passed (23)

$ npm run lint
eslint src
exit 0（0 error）

$ node --check scripts/e2e-phase2.mjs
exit 0
```

构建只有 Vite 对单个 JS chunk 大于 500 kB 的既有性能警告，不是构建错误。遵照限制，没有运行 `npm run build`。

### 真实浏览器验收

使用 Vite preview、主机现有的 headless Chrome 149 和 CDP 脚本：

```text
$ node scripts/e2e-phase2.mjs
39/40 通过
```

唯一失败项是独立 TTS 服务 `http://127.0.0.1:3115/api/tts` 未运行，浏览器报告 `TypeError: Failed to fetch`。验收结束后已停止 preview 和 Chrome；端口 4173、5173、9222 均无监听。

## 18 条验收结果

1. **通过 — Vite 构建。** `npx vite build` 成功；产物大小见上方输出。
2. **通过 — TypeScript。** `npx tsc --noEmit` exit 0。
3. **通过 — 单元测试。** 9 个测试文件、23 个测试全部通过；原有 18 个测试未破坏。
4. **通过 — lint。** `npm run lint` exit 0，0 error。
5. **通过 — 随机顺序。** 真实浏览器的两轮顺序分别为 `accommodation, above, accident, able, across, a few, a/an, about` 和 `a few, accident, across, about, accommodation, above, able, a/an`。纯函数测试还验证了 Fisher–Yates 不修改输入，以及相同结果保护。
6. **通过 — 随机不破坏进度。** 浏览器实测 `1/8 → 2/8 → 3/8 → 4/8 → 5/8 → 6/8 → 7/8 → 8/8`，最后一词进度条 `aria-valuenow=100`。
7. **通过 — 返回保留揭晓。** 随机首词 `accommodation` 揭晓后前进再返回，词条相同且 `Eye` 不再出现，说明揭晓状态保留。
8. **通过 — 看英猜中布局稳定。** 揭晓前后 `[data-recall-word]` 的 `getBoundingClientRect().top` 差值为 `0.00px`，小于 2px。
9. **通过 — Eye 图标。** 未揭晓答案区实测存在 `.lucide-eye`。
10. **通过 — 英文区不揭晓。** 点击 `[data-recall-word]` 后 `Eye` 仍存在。
11. **通过 — 答案区揭晓。** 点击 `[data-recall-answer]` 后 `Eye` 消失，中文释义和中文例句出现。
12. **通过 — 英文例句前置。** 未揭晓时英文提示区已存在英文例句。
13. **通过 — 喇叭位于英文区。** 浏览器断言 `[data-recall-prompt] button[aria-label="朗读英文"]` 存在。
14. **通过 — 词性独立。** 词性和中文释义分别为 `[data-recall-pos]`、`[data-recall-meaning]`；浏览器实测字号 `12px` 对 `30px`，颜色 `rgb(100, 116, 139)` 对 `rgb(28, 25, 23)`。
15. **通过 — 看英猜中 DOM 安全。** 未揭晓 `article.innerText` 不含测试列表中任一中文释义或中文例句；组件测试也断言两者不在静态 HTML 中。
16. **通过 — 看中猜英 DOM 安全。** 未揭晓 `article.innerText` 不含英文单词、音标或英文例句；组件测试同时断言朗读控件不存在。
17. **通过 — 页面回归。** 浏览器实测学习模式 8 条、每条六字段和 16 个朗读按钮；生词本收藏、刷新持久化、仅背生词、首次来源均正常；选词页仍显示 1723 词、10 列虚拟网格、批量选择默认关闭；运行期无未捕获异常。
18. **部分通过 — TTS。** 浏览器实测五个引擎选项 `edge/tencent/minimax/glm/local` 和“实际”字段仍存在；看中猜英未揭晓时 0 个英文朗读按钮，揭晓后按钮出现。`src/tts/tts.test.ts` 的 4 个回退链测试全部通过，包括所选引擎失败后的实际引擎上报、失败引擎跳过、重新选择重试、主动停止不回退。独立的 3115 服务未运行，因此本机无法完成真实音频响应验收。

## 布局稳定性实现

卡片不再使用随内容总高度变化而重新居中的 `justify-center`。英文提示区固定在卡片上部，答案区在其后单独占位：看英猜中使用 `min-h-40`，看中猜英使用 `min-h-56`。未揭晓时区域内只渲染同样最小高度的眼睛按钮；揭晓后替换为同样最小高度的答案容器。答案内容增高只向下扩展，不会改变上方英文单词的位置。浏览器实测位移为 0px。

## 随机顺序与揭晓状态如何共存

`begin()` 只在一轮开始时调用 `shuffleForRecall()`，随后把结果存入 `snapshot`。本轮的前进、后退、进度和揭晓集合都使用该快照的位置索引；洗牌不会在渲染或翻页时再次执行。因此同一轮内顺序稳定，返回上一位置仍能命中 `revealed` 集合。再来一轮或进入“只背本列表生词”后重新开始，都会针对新的来源列表建立新的随机快照，不改变生词本列表本身的最近标记/主题排序。

## 测试断言调整

- `src/components/RecallCard.test.tsx`：删除“看英猜中未揭晓时隐藏英文例句”的旧断言，因为英文例句现在属于提示；新增 Eye、提示区/答案区、中文答案 DOM 安全、看中猜英英文 DOM 安全、揭晓后完整字段、词性独立元素与样式断言。
- 新增 `src/recall/shuffle.test.ts`：验证 Fisher–Yates 结果、不修改来源数组，以及连续两轮完全相同时的保护。
- `scripts/e2e-phase2.mjs`：不再假定随机后的首词是 `a/an`；把“点击卡片/底部按钮揭晓”的核心断言改为点击答案区；新增点击英文区不揭晓、Eye、例句前置、喇叭归属、0px 布局位移、两轮顺序、完整进度、随机序返回保留揭晓、词性计算样式、双向 `innerText` 安全及 TTS 控件检查。星标持久化测试也改为在随机序中定位原收藏词，而不是错误地假定刷新后仍是首词。

## 已知缺陷和未完成项

- **未完成：真实 TTS 音频接口验收。** 本机 `127.0.0.1:3115` 没有 TTS 服务，且任务明确禁止改网关、生产配置或擅自启动服务，所以没有绕过该限制。前端 TTS 逻辑未改，相关 4 个测试全部通过。
- Vite 报告主 JS chunk 780.73 kB（gzip 221.74 kB）超过 500 kB 建议阈值。这是性能警告，不影响本次功能与构建；本任务未扩大范围做代码拆分。
- 除上述外，本次要求的背诵交互没有已知未完成项。

## 边界确认

- 未修改 `src/data/vocab.json`、选词页、学习页、IndexedDB schema 或 `src/tts/` 逻辑。
- 未修改 Caddy、gateway、systemd、`/var/www/`，未部署。
- 未运行 `npm run build`。
- 验收后没有遗留 dev/preview/Chrome 进程。
