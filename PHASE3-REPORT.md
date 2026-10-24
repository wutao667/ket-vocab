# Phase 3 验收报告：A–Z 紧凑选词网格

日期：2026-10-24  
工作目录：`/home/wutao/.openclaw/workspace-nezha/projects/ket-vocab/app`

## 结论

Phase 3 已完成。选词页已从 25 主题行式列表改为保持 `vocab.json` 原始顺序的 10 列 A–Z 虚拟网格；全部自动化检查和浏览器验收通过。没有改动 `src/data/vocab.json`、`src/data/topics.json`、IndexedDB v2 schema 或生产配置。

## 构建与自动化检查

最终验证命令：

```bash
npx vite build
npx tsc --noEmit
npm test
npm run lint
```

结果：

- `npx vite build`：成功，1620 modules，3.44s。
- 构建产物：`dist/index.html` 0.46 kB（gzip 0.31 kB）；CSS 17.28 kB（gzip 4.17 kB）；JS 778.83 kB（gzip 221.29 kB）；`dist/` 总计 796K。
- `npx tsc --noEmit`：退出码 0，无输出、无错误。
- `npm test`：8 个测试文件、20 个测试全部通过（原有 18 个保持通过，新增 2 个网格模型测试）。
- `npm run lint`：退出码 0，0 error。
- `node scripts/e2e-verify.mjs`：28/28 通过。
- `node scripts/e2e-phase2.mjs`：35/35 通过。首次执行时因本机 3115 测试代理未启动，只有外部 TTS 请求失败；启动一次性本地代理后重跑全部通过，音频响应为 `audio/mpeg`、11232 bytes。未修改或重启生产服务。

## 18 条验收结果

1. **Vite 构建：通过。** `npx vite build` 成功；产物大小见上节。没有运行禁止的 `npm run build`。
2. **TypeScript：通过。** `npx tsc --noEmit` 退出码 0。
3. **单测：通过。** `npm test` 为 20/20；原有 18 项未破坏。
4. **Lint：通过。** `npm run lint` 为 0 error。
5. **1723 个词及原始顺序：通过。** 数据检查输出 `vocab: 1723 a/an zoo`；新增模型测试逐 ID 比较拍平后的网格与 `vocab.json` 完整数组；浏览器首词和末词断言通过。
6. **每行 10 个：通过。** 模型测试确认所有完整行均为 10 个，最后一行为 3 个；浏览器计算样式确认 10 列，末行 DOM 确认为 3 格。
7. **单元格只显示单词：通过。** 浏览器检查首格文本为 `a/an` 且无子元素；组件仅渲染 `entry.word`，没有音标、词性、释义或可见序号。
8. **50/100 分割线：通过。** 模型测试确认所有 50 倍数边界，`major === (after % 100 === 0)`；浏览器实测 50 后为小分割 `51–100`，100 后为大分割 `101–200`。1700 后标注 `1701–1723`。
9. **长词截断：通过。** 390px 视口实测 `training (transitive and intransitive)` 的 `overflow=hidden`、`white-space=nowrap`、`text-overflow=ellipsis`，且 `scrollWidth > clientWidth`；`title` 为完整单词。
10. **普通点击切换：通过。** 批量模式默认关闭，点击第一个词计数由 0→1，再点由 1→0；列表计算样式 `touch-action: pan-y`。
11. **拖过 20 格统一选择：通过。** 浏览器以真实 pointer 事件连续拖过 20 格，结果计数为 20，20 格均 `aria-pressed=true`。
12. **重复经过不翻转：通过。** 批量取消路径特意重复经过已访问格，最终计数仍准确；状态机单测也确认 20 个索引来回访问后只应用 20 次。
13. **从已选格起手取消：通过。** 先选中 20 格，再从已选格起手拖过同一区域，最终计数为 0。
14. **松手撤销：通过。** 提示实际文本为 `已选择 20 个｜撤销`；点击后计数恢复为手势前的 0。提示时长为 3000ms。
15. **全局范围：通过。** 浏览器实测 `1-20` 得 20 个；`20-1` 显示“起始序号 20 不能大于结束序号 1。”；清空后 `1700-1723` 得 24 个。原有范围单测继续覆盖非数字和越界。
16. **列表刷新持久化：通过。** 使用后 24 个词创建列表，跳转详情显示 24 条；刷新后仍为 24 条。默认名实测为 `2026-10-24 KET 词表`。
17. **滚动位置恢复：通过。** `scrollTop=1000` 停止 500ms 后保存稳定 ID `ket-0261`；离开再进入恢复为 982，误差 18px，小于一行 34px。
18. **学习/背诵/生词本回归：通过。** Phase 2 E2E 35/35：学习页六字段和朗读按钮、双向背诵答案隔离/进度/返回状态、星标刷新持久化、仅背生词、生词本及学习入口、真实 TTS 音频均通过。

## 布局和虚拟化实现

`src/selection/grid.ts` 将词库拍平成两类项：

- `row`：从全局索引开始的最多 10 个词；内部使用 `grid-template-columns: repeat(10, 1fr)`，固定 34px 高。
- `divider`：在 50 的倍数处插入，带 `after/from/to/major` 数据；小分割估算 18px，大分割估算 22px。

`@tanstack/react-virtual` 对拍平后的项数组做虚拟化，而不是对 1723 个单元格逐个虚拟化。分割线因此是独立的全宽虚拟项，不占 10 列中的任何格。浏览器手机视口实测仅挂载 230 个词格，而非 1723 个。

每个词格携带全局 `data-word-index=0..1722` 和稳定词条 ID。范围选择、手势选择、锚点恢复都使用全局数据索引，不依赖主题或当前已渲染 DOM 的局部序号。

## 滑动选择与滚动共存

- 显式开关关闭时，滚动容器使用 `touch-action: pan-y`，词格 click 只切换自身。
- 开关开启时使用 `touch-action: none`，pointer down 通过现有 `beginGesture` 冻结快照和统一目标，命中词格时通过现有 `visitGesture` 以全局词索引去重。
- pointer move 会以最多 12px 的间隔对移动路径采样，降低快速划动跳格风险。
- 指针进入上下边缘 48px 后，animation frame 按边缘深度线性计算速度，最高 600px/s；每一帧滚动后重新按坐标命中当前虚拟化词格，因此滚入视口的新数据仍按全局索引应用。
- pointer up/cancel 结束手势，批量开关不复位，并用手势开始前的快照提供 3 秒撤销。

## 测试断言调整

- `scripts/e2e-verify.mjs`：重写旧的“25 主题 + 左侧滑轨”验收，改为验证 1723 数据范围、虚拟化、10 列、纯词面、34px 触控高度、两级分割、长词实际截断、普通点击、显式批量模式、20 格拖选/去重/取消/撤销、全局范围、末行、创建刷新持久化和滚动锚点。
- `scripts/e2e-phase2.mjs`：将选词页回归断言从“25 个主题标签/滑轨”改为“1723 词入口/10 列虚拟网格/批量开关默认关闭”。学习、背诵、生词本与 TTS 原断言保留。
- `src/selection/grid.test.ts`：新增 2 个模型测试，完整核对源顺序、10 列分组、末行以及 50/100 分割规则。

## 文件变更摘要

- 重写 `src/pages/SelectPage.tsx`。
- 将 `src/components/VocabRow.tsx` 改造为紧凑 10 列词格行。
- 删除不再使用的 `src/components/SwipeRail.tsx`、`src/components/TopicTabs.tsx`。
- 新增 `src/selection/grid.ts` 和 `src/selection/grid.test.ts`。
- 更新两套 E2E 脚本和 `app/README.md`。
- 新增 `app/PHASE3-PLAN.md` 作为实施方案记录。
- `src/data/topics.json` 保留且未改动（23308 bytes）。

## 已知缺陷和未完成项

- 未完成项：无。
- 已知非阻断警告：Vite 提示主 JS chunk 大于 500 kB（当前 778.83 kB，gzip 221.29 kB）。这是既有单包架构的体积提示，不影响本次功能、运行或验收；本次没有为此扩大范围做路由拆包。
- 手机端对被省略长词没有额外的长按浮层；按需求只保证桌面 `title`，移动端不强制。

## 清理确认

验收期间启动的 Vite preview、无头 Chrome 和一次性 TTS 测试代理均已停止；下载的临时浏览器、测试 profile 和测试 TTS cache 均已删除。进程检查未发现遗留的 dev/preview/测试 Chrome。本机原有 `/var/www/ket-tts/server/tts-proxy.mjs` 生产进程未触碰。
