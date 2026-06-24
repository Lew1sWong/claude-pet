# Claude Pet 手机网页版 / PWA 📱🐾

和桌面版同款的像素宠物，做成可以装进手机主屏幕的网页应用。宠物在小舞台里走来走去，根据你的 Claude 用量切换心情（开心 / 悠哉 / 犯困 / 焦虑 / 睡着）。

## 本地预览

是纯静态文件，但 PWA（service worker）需要通过 http 访问，不能直接用 `file://` 打开。任选一种起个本地服务：

```bash
cd web
npx serve .            # 或
python3 -m http.server 8080
```

然后手机和电脑连同一个 Wi-Fi，手机浏览器打开 `http://<电脑IP>:8080`。

## 装到手机主屏幕

- **iPhone（Safari）**：打开网页 → 点底部「分享」→「添加到主屏幕」。
- **Android（Chrome）**：会弹「添加到主屏幕」，或菜单里手动选。

之后就有一个独立图标（小克 ✦），全屏打开像 App。

## 用量数据从哪来（点右上角 ⚙）

手机上没有本机的 Claude Code 凭证，而且手机浏览器**直连 Anthropic 接口通常会被 CORS 拦截**，所以有三档方案，按推荐顺序：

1. **手动 %（最稳，推荐）**：在桌面用 `claude` 的 `/usage` 看一眼当前 5h / 周百分比，填进「手动 5H % / 周 %」。宠物立刻按这个心情演出。适合「就想要个陪伴 + 提醒别超额」。
2. **中转地址（自动获取）**：如果你有一台服务器 / Cloudflare Worker 能转发请求并补上 CORS 头，把它的地址填进「代理 / 中转地址」，再填 Token，就能自动拉实时数据。中转端要做的事：收到请求 → 带上 `Authorization` 和 `anthropic-beta: oauth-2025-04-20` 转发到 `https://api.anthropic.com/api/oauth/usage` → 在响应里加 `Access-Control-Allow-Origin: *`。
3. **直接填 Token 试试**：少数环境（或装成 PWA 后）可能能直连，可以点「测试自动获取」看看。被 CORS 拦就回到上面两种。

> Token 和设置只存在你手机浏览器的 localStorage，不会上传到任何服务器。
> 不填任何东西时是**演示模式**，宠物用一组示例数据自娱自乐。

## 和桌面版的关系

像素素材 `sprites.js` 由 `desktop/tools/sprites.py` 一次生成、同时写到桌面版和这里，所以两边形象完全一致：小橘 🐱 / 柴柴 🐶 / 布朗 🐻 / 团子 🐰 / 小狐 🦊 / QQ 🐧 / 小克 ✦。

## 部署到公网（可选）

整个 `web/` 目录可以直接丢到任意静态托管：GitHub Pages、Cloudflare Pages、Vercel、Netlify 都行，零构建。配合上面的「中转地址」就能在任何手机上看实时用量。
