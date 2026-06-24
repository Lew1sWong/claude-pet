# Claude Pet — VS Code 8-bit 桌宠用量监控 技术方案

> 目标：在 VS Code 内养一只 8-bit 像素宠物，实时展示 Claude Max 计划的 5 小时 session 用量、每周用量、剩余额度与重置倒计时。宠物可拖动、可隐藏。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────┐
│ VS Code Extension (TypeScript)              │
│                                             │
│  ┌──────────────┐      ┌─────────────────┐  │
│  │ Data Layer   │──────▶ Webview (宠物UI) │  │
│  │ · 凭证读取    │ post │ · sprite 动画    │  │
│  │ · 用量轮询    │ msg  │ · 进度条/倒计时   │  │
│  │ · 状态机      │◀─────│ · 拖动/交互      │  │
│  └──────────────┘      └─────────────────┘  │
│         │                                   │
│  ┌──────────────┐                           │
│  │ StatusBarItem │ ← 迷你用量 % + 显隐开关   │
│  └──────────────┘                           │
└─────────────────────────────────────────────┘
```

三个模块：**数据层**（取凭证、轮询用量、计算宠物状态）、**Webview UI**（像素宠物渲染与交互）、**状态栏项**（常驻迷你显示 + 一键显隐）。

---

## 2. 数据获取（核心难点）

### 2.1 数据源：非官方 OAuth 用量端点（主方案）

Anthropic 目前**没有官方 API** 查询订阅计划限额（GitHub issue #44328 仍 open）。Claude Code 自己的 `/usage` 命令走的是未公开端点，可以复用：

```
GET https://api.anthropic.com/api/oauth/usage
Headers:
  Authorization: Bearer <access_token>
  anthropic-beta: oauth-2025-04-20
```

返回结构（以实际抓包为准，先用 Claude Code 抓一次再写解析器）：

```json
{
  "five_hour":  { "utilization": 42, "resets_at": "2026-06-05T12:00:00Z" },
  "seven_day":  { "utilization": 18, "resets_at": "2026-06-09T00:00:00Z" },
  "seven_day_opus": { ... }
}
```

### 2.2 凭证读取

Claude Code 登录后的 OAuth token 存放位置因平台而异：

| 平台 | 位置 | 读取方式 |
|---|---|---|
| macOS | Keychain，service 名 `Claude Code-credentials` | `security find-generic-password -s "Claude Code-credentials" -w` |
| Linux / WSL | `~/.claude/.credentials.json` | 直接读文件 |
| Windows | `~/.claude/.credentials.json` | 直接读文件 |

JSON 内含 `claudeAiOauth.accessToken / refreshToken / expiresAt`。

**Token 过期处理**：不自己实现 refresh（避免和 Claude Code 抢 refresh token 导致对方掉登录）。策略：token 过期或收到 401 时，重新读一次凭证（Claude Code 运行时会自己刷新并写回）；仍失败则宠物进入"失联"状态并提示用户在 Claude Code 里跑一条命令。

### 2.3 轮询策略

- 默认每 **60s** 轮询一次（可配置）；窗口失焦时降到 5min。
- 401 → 重读凭证重试一次；429/5xx → 指数退避。
- 结果缓存到 `globalState`，启动时先显示上次数据再刷新。

### 2.4 降级方案（Plan B）

端点失效时，解析 `~/.claude/projects/**/*.jsonl` 本地对话记录（ccusage 同款思路），按 token 加权估算 session 用量。只能近似、拿不到官方 resets_at，因此仅作降级，UI 上标注"估算"。

---

## 3. "可拖动、可隐藏" 的实现

VS Code 的硬限制：**webview 不能悬浮在编辑器上方**，扩展无法创建系统级悬浮窗。两条路线：

### 路线 A：Webview 内自由拖动（推荐，Phase 1）

- 宠物渲染在一个 Webview 面板里（侧边栏 view 或编辑器旁的 WebviewPanel，用户可自由拖到任意分栏/拖出为浮动编辑器窗口——VS Code 原生支持把编辑器 tab 拖成独立浮窗，等效"桌宠窗口"）。
- **面板内拖动**：宠物本体 `position:absolute`，pointer 事件实现拖拽，落点坐标存 `vscode.setState()`，重开恢复。
- **隐藏**：状态栏图标点击 toggle；`Cmd+Shift+P → Claude Pet: Toggle`。隐藏后状态栏仍显示 `🐾 42% | 3h12m` 迷你信息。

### 路线 B：真·系统级桌宠（Phase 2，可选）

扩展 spawn 一个独立的透明、置顶、点击穿透的小窗口进程（Tauri ~3MB 或 Electron），通过本地 IPC（unix socket）从扩展接收用量数据。宠物可在整个屏幕游走，不受 VS Code 边界限制。成本高、需分平台打包，建议验证 A 之后再做。

---

## 4. 8-bit 宠物设计

### 4.1 渲染

- 一张 sprite sheet（PNG，每帧 32×32），CSS `steps()` 帧动画 + `image-rendering: pixelated`，零依赖、性能极轻。
- 像素字体用 "Press Start 2P"（本地打包，webview 离线可用）。

### 4.2 状态机（额度 → 心情）

取 5 小时与每周两者中**剩余更少**的作为心情依据：

| 剩余额度 | 状态 | 动画 |
|---|---|---|
| > 60% | 开心 | 四处走动、偶尔跳跃 |
| 30–60% | 平静 | 原地呼吸、摇尾巴 |
| 10–30% | 困倦 | 打哈欠、走得慢 |
| < 10% | 焦虑 | 头顶冒汗滴、来回踱步 |
| 已耗尽 | 睡觉 💤 | 趴下，头顶气泡显示重置倒计时 |
| 重置瞬间 | 庆祝 | 跳跃 + 像素彩带，发一条 VS Code 通知 |

### 4.3 UI 布局（webview 内）

```
┌────────────────────────┐
│        (宠物，可拖动)    │
│   ▓▓▓▓▓▓▓░░░  5h  68%  │
│   ▓▓▓░░░░░░░  周  31%   │
│   ⏱ 1h 47m 后重置       │
└────────────────────────┘
```

点击宠物：摸头互动 + 弹出详细 tooltip（两条限额的精确 resets_at、最近刷新时间）。

---

## 5. 项目结构与技术栈

```
claude-pet/
├── package.json          # contributes: view + commands + statusbar
├── src/
│   ├── extension.ts      # 激活、轮询调度、statusbar
│   ├── credentials.ts    # 跨平台凭证读取
│   ├── usageClient.ts    # OAuth 端点请求 + 重试/降级
│   ├── petState.ts       # 额度→心情状态机
│   └── webview/
│       ├── index.html / main.js / pet.css
│       └── sprites.png
└── esbuild.config.js
```

技术栈：TypeScript + esbuild，无运行时依赖（fetch 用 Node 内置）。打包 `vsce package` 生成 `.vsix` 本地安装即可，不必上架。

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 未公开端点变更/下线 | 数据断供 | 解析器与 UI 解耦；保留 JSONL 估算降级；版本化响应 schema |
| Keychain 读取触发 macOS 授权弹窗 | 首次体验差 | 首次启动引导说明；失败则提示用户手动授权 |
| token 刷新竞争 | Claude Code 掉登录 | 永不主动 refresh，只读 |
| ToS 灰色地带 | 个人使用风险低 | 仅本地使用、只读、不分发凭证；不上架市场可完全规避 |

---

## 7. 实施路线图

1. **D1 — 数据验证**：脚本验证凭证读取 + 端点响应结构（半天）
2. **D2 — 扩展骨架**：激活、轮询、状态栏（半天）
3. **D3 — 宠物 UI**：sprite、状态机、拖动、进度条、倒计时（1–2 天）
4. **D4 — 打磨**：重置通知、失联态、配置项、打包 .vsix（半天）
5. **Phase 2（可选）**：Tauri 系统级桌宠

总计约 **3–4 个工作日**的业余项目体量。
