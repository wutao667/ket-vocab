# KET 词匣 · KET Vocabulary Trainer

一个给 **KET（A2 Key）考生** 用的纯前端背单词应用。基于剑桥官方 A2 Key 词汇表，1723 个词条，支持 A-Z 快速选词、双向背诵、生词本和真人级语音朗读。

> **在线使用**：https://ket.huaguo.site

---

## 这是什么

剑桥 A2 Key 官方词汇表（2025 年 8 月版）只有一份 PDF，没有中文释义、没有音标、没有例句翻译，也没法按"今天背哪 20 个"来组织。

这个项目把它变成能真正用来背的东西：

- **1723 个词条**，每条的单词、音标、中文释义、英文例句、例句中文全部齐全
- **10 列 A-Z 网格**，一屏能看两百多个词，滑一下批量选中
- **双向背诵**：看英文猜中文 / 看中文猜英文，答案区固定占位，揭晓前后不跳动
- **生词本**：星标收藏，跨列表汇总，可以只背生词
- **语音朗读**：Edge TTS 为主，多引擎自动回退，最后兜底浏览器内置语音
- **纯本地**：数据存浏览器 IndexedDB，不需要注册、不上传任何东西

---

## 功能

### 选词

- 1723 个词按官方 A-Z 顺序平铺，**每行 10 个**
- 每 50 个词一条细分割线，每 100 个词一条粗分割线，带区间标注（如 `101–200`）
- 格子里**只显示单词**，没有音标/词性/释义干扰
- **左右拖动**批量选择，**上下滑动**滚动页面，**点击**切换单个
- 已在其他列表里的词有**淡黄底色**区分，避免重复挑选
- 支持序号范围快速选：输入 `21-40` 一键选中

### 学习模式

- 列表内全部词条完整展示：单词、音标、词性、中文、英文例句、例句中文
- 每个词有独立的单词朗读和例句朗读按钮
- 可调语速（0.5×–1.2×）和引擎

### 背诵模式

- **看英文猜中文**：显示单词、音标、例句，中文释义藏在眼睛图标后面
- **看中文猜英文**：显示中文释义和词性，英文答案藏在眼睛图标后面
- 答案区**固定高度占位**，揭晓前后单词位置零位移
- 点眼睛图标才揭晓，点单词区不会误触发
- 每轮顺序**随机打乱**
- 卡片右上角星标，随时标记生词
- 进度条 + `当前/总数` 计数
- 键盘：空格揭晓/下一个，← → 切换，Esc 退出

### 生词本

- 跨列表汇总所有星标词，去重计数
- 可按"最近标记"或"主题顺序"排序
- 显示每个词的首次来源列表
- 支持进入学习模式和背诵模式

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 6 + React 19 + TypeScript + Tailwind CSS |
| 路由 | HashRouter（静态托管无需服务端改写） |
| 虚拟滚动 | @tanstack/react-virtual |
| 本地存储 | IndexedDB（via `idb`） |
| 语音 | Edge TTS + 腾讯/MiniMax/GLM + Web Speech 兜底 |
| 部署 | 静态站点 + Node 反向代理（TTS） |

**为什么用 IndexedDB 而不是 localStorage**：学习记录会累积到上万条，localStorage 是同步 API，一次性反序列化会卡死界面。

**为什么用 HashRouter**：纯静态托管，不需要服务端 `try_files` 改写，刷新深链不会 404。

---

## 快速开始

### 环境要求

- Node.js 20+
- npm 10+

### 安装与开发

```bash
cd app
npm install
npm run dev
```

访问 `http://localhost:5173`。

### 构建

```bash
cd app
npx vite build
```

> ⚠️ **不要用 `npm run build`**。它在低内存机器上会因 `tsc -b` 触发 OOM。用 `npx vite build` 绕过全量类型检查；类型检查单独跑 `npx tsc --noEmit`。

### 测试

```bash
cd app
npm test          # 单元测试
npm run lint      # ESLint
npx tsc --noEmit  # 类型检查
```

---

## 词库

### 数据来源

| 内容 | 来源 |
|---|---|
| 单词、词性、官方例句 | 剑桥 A2 Key Vocabulary List (August 2025) PDF |
| 音标 | [ipa-dict](https://github.com/open-dict-data/ipa-dict)（英式） |
| 中文释义 | [ECDICT](https://github.com/skywind3000/ECDICT) 开源词典 + 人工校对 |
| 英文例句 | 剑桥官方例句 + [Tatoeba](https://tatoeba.org) 语料筛选 |
| 例句中文 | LLM 批量直译 + 人工抽检 |
| 主题分组 | 官方 Appendix 2 |

### 数据文件

```
data/
├── ket_vocab_dataset.json        # 主词库，1723 条（权威源）
├── ket_vocab_dataset.csv         # 同上，Excel 可直接打开
├── a2key_topics.json             # 25 个主题分组
├── topic_mapping.json            # 主题→词库映射（100% 覆盖）
└── overrides.json                # 人工校对覆盖表
```

`ket_vocab_dataset.json` 单条结构：

```json
{
  "word": "a/an",
  "pos": "det",
  "ipa": "/ə/, /ən/",
  "zh": "限. 一个、一件",
  "example": "I would like a cup of tea, please.",
  "example_zh": "请给我一杯茶。"
}
```

### 重建词库

```bash
python3 scripts/extract_pdf.py       # 从 PDF 解析词条
python3 scripts/extract_topics.py    # 解析主题分组
python3 scripts/build_dataset.py     # 合并音标/释义/例句
python3 scripts/audit_topics.py      # 校验主题映射
python3 scripts/translate_examples.py # 例句翻译（需 LLM API）
```

### 数据质量说明

- **1723 个词条，六项字段零缺失**
- 146 个多词条目（如 `look after`、`smart (stylish)`），不会被拆成单词
- 43 条中文释义经人工校对（ECDICT 有歧义的词，如 `performance` 应译"表演"而非"施行"）
- 主题映射 1136 条，精确 975 + 变体 140 + 别名 21，**100% 对齐**
- 例句优先用剑桥官方完整句，其余从 Tatoeba 按 A2 词频筛选，平均 7.8 词

---

## TTS 服务

前端默认请求同源 `/tts/*`。开发时需单独启动代理。

### 启动代理

```bash
node server/tts-proxy.mjs
```

默认监听 `127.0.0.1:3115`，上游为 `https://tx.huaguo.site`。

### 环境变量

```bash
PORT=3115
TTS_UPSTREAM=https://tx.huaguo.site
ALLOWED_ORIGINS=https://ket.huaguo.site,http://localhost:5173
CACHE_DIR=./tts-cache
CACHE_MAX_MB=200
```

### 接口

```bash
# 探测可用引擎
GET /tts/api/tts-available
# → {"edge":true,"tencent":true,"minimax":true,"glm":true,"preferred":"edge"}

# 合成语音
POST /tts/api/tts
{"text":"look after","engine":"edge","voice":"en-GB-SoniaNeural","speed":0.85}
# → 200, audio/mpeg
```

### 为什么需要代理

上游 `tx.huaguo.site` 的 TTS 接口没有 CORS 响应头，浏览器跨域请求会被拦截。代理在服务端转发（服务端不受 CORS 限制），并补上可控的 CORS 头，同时做磁盘缓存——同一个词第二次朗读不再请求上游。

### 回退链

```
用户所选引擎 → edge → tencent → minimax → glm → Web Speech（浏览器内置）
```

- 用户主动中止（`AbortError`）**不触发回退**，避免双播
- 失败引擎记入会话内集合，后续跳过
- UI 显示**实际发声的引擎**，不谎报所选引擎

---

## 部署

```bash
# 构建
cd app && npx vite build

# 部署静态文件
sudo cp -r dist/* /var/www/ket/
sudo chown -R caddy:caddy /var/www/ket
```

Caddy 配置：

```caddy
ket.huaguo.site {
    encode gzip

    handle_path /tts/* {
        reverse_proxy 127.0.0.1:3116
    }

    handle {
        root * /var/www/ket
        try_files {path} /index.html
        file_server
    }
}
```

TTS 代理 systemd 单元见 `server/ket-tts.service`。

---

## 项目结构

```
.
├── app/                      # 前端应用
│   ├── src/
│   │   ├── pages/            # 首页 / 选词 / 列表 / 学习 / 背诵 / 生词本
│   │   ├── components/       # 词格、背诵卡、语音控件、Toast
│   │   ├── db/               # IndexedDB schema 与 repository
│   │   ├── tts/              # 语音引擎回退链
│   │   ├── selection/        # 网格构建、手势状态机、范围解析
│   │   ├── recall/           # 洗牌
│   │   └── data/             # 生成的词库 JSON
│   └── scripts/
│       ├── build-data.mjs    # 词库 → 前端数据
│       └── e2e-*.mjs         # CDP 端到端测试
├── data/                     # 词库源数据
├── scripts/                  # Python 数据流水线
└── server/                   # TTS 代理
```

---

## 设计取舍

**为什么选词页只有单词，不显示释义？**
一屏要塞下尽可能多的词，让用户快速定位。释义在学习模式看。

**为什么滑动选择要区分方向？**
如果拖到哪都触发选择，就没法滚动页面了。横向=选择、纵向=滚动，两者共存。

**为什么答案区用固定高度占位？**
揭晓前后单词位置跳动会让人眼累。用固定 `min-height` 撑住，眼睛图标居中，揭晓后原地替换。

**为什么未揭晓的答案不渲染进 DOM？**
用 CSS 隐藏（`opacity-0`）会把答案留在 DOM 里，可以被无障碍工具、复制、爬虫读到。条件渲染才是真隐藏。

**为什么每轮打乱顺序？**
固定顺序会形成位置记忆，背到第 5 个就想起答案，实际没记住。打乱强制真正回忆。

---

## 许可

代码 MIT。词库内容版权归剑桥大学考评部（UCLES）所有，仅供个人学习使用。

## 致谢

- [ECDICT](https://github.com/skywind3000/ECDICT) — 开源英汉词典
- [ipa-dict](https://github.com/open-dict-data/ipa-dict) — IPA 音标数据
- [Tatoeba](https://tatoeba.org) — 开放例句语料
- [剑桥大学考评部](https://www.cambridgeenglish.org) — A2 Key 官方词汇表
