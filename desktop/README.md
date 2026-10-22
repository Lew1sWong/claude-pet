# Claude Pet 桌面悬浮版 🐾（macOS / Windows）

完全悬浮的桌宠：透明背景、无边框、永远置顶，在屏幕底部走来走去。透明区域点击会穿透到后面的窗口，不挡你干活。

形象共 7 只：🐱 小橘 / 🐶 柴柴 / 🐻 布朗 / 🐰 团子 / 🦊 小狐 / 🐧 QQ / ✦ 小克（Claude 品牌色小精灵）。

> 想在手机上养？看仓库里的 [`web/`](../web/README.md) —— 同款宠物的手机网页 / PWA 版本。

## 第一次运行（需要 Node.js）

**macOS** — 打开终端，逐行执行：

```bash
cd ~/Desktop/claude-pet/desktop
npm install        # 第一次需要（Node.js 22+）
npm start          # 启动桌宠；第一次会先下载 Electron 本体，约 1-2 分钟
```

> 需要 macOS 13 及以上（Electron 45），或 Windows 10/11 x64。

以后再开：双击本文件夹里的 `启动桌宠.command`（或重复 `npm start`）。

> 如果双击 .command 提示权限问题，在终端执行一次：
> `chmod +x ~/Desktop/claude-pet/desktop/启动桌宠.command`

**Windows** — 装好 [Node.js](https://nodejs.org) 后，直接**双击 `启动桌宠.bat`**（第一次会自动 `npm install`）。
或在 PowerShell / CMD 里：

```bat
cd desktop
npm install
npm start
```

## 打包成独立安装包（可选）

```bash
npm run dist:win   # Windows：dist/ 里生成 .exe 安装包 + 免安装 portable 版
npm run dist:mac   # macOS：dist/ 里生成 .dmg / .zip
```

（首次会下载 electron-builder 及对应平台的打包工具；Windows 包建议在 Windows 上打。）

## 使用

- **鼠标悬停**在宠物上 → 显示用量面板（5h / 周 / Fable ✦ 等模型专属额度 / 额外用量 💸 进度条 + 重置倒计时 + 本周去向）
- **拖动**宠物到屏幕任何位置；它走路时只沿水平方向溜达
- **点击**宠物 → 摸头互动
- **托盘图标**有爪印（macOS 在右上角菜单栏 / Windows 在右下角任务栏）：换形象、显示/隐藏、开机自启、退出
- **右键**宠物本体也能弹出同样的菜单
- 面板里 ◀▶ 也能换形象（共 7 只循环切换）

## 数据来源

只读本机 Claude Code 凭证，请求 Anthropic 的 OAuth 用量端点，每 5 分钟刷新一次（被限流会自动退避重试）：

- **macOS**：先读钥匙串（`Claude Code-credentials`），回退到 `~/.claude/.credentials.json`
- **Windows**：读 `%USERPROFILE%\.claude\.credentials.json`

解析的是 2026-10 版的返回结构：`limits[]`（会话 / 全模型周 / 模型专属周额度，如 Fable ✦）、`extra_usage` + `spend`（额外用量 / 用量积分）、`seven_day_breakdown`（本周去向），老字段 `five_hour` / `seven_day` 作为回退。`npm test` 用一份抓包样本验证解析器和心情逻辑。

## 常见问题

- **显示"未找到凭证"**：先在终端运行一次 `claude` 并登录
- **面板里没有 Fable ✦ / 💸 那几行**：说明接口没有返回模型专属额度 / 没开额外用量，不是故障；有的时候会自动出现
- **macOS 第一次可能弹出钥匙串授权**：选"允许"
- **Apple Silicon 上老板键的三连 Esc 不灵**：`npm install` 时会用 `swiftc` 把按键监听助手重新编译成 arm64（需要 Xcode Command Line Tools：`xcode-select --install`，装完再跑一次 `npm install`）；没有的话只有 ⌘⇧B 能用。记得给 Electron / Claude Pet 辅助功能权限
- **Windows 托盘不显示百分比**：正常，Windows 托盘图标不支持文字，百分比在悬停提示和宠物面板里看
- **想要手机版**：见 [`web/`](../web/README.md)
