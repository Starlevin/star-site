# 余烬营地 v0.2 · Render 免费公网部署

## 目标与架构

浏览器 HTTP/HTTPS 与 WebSocket 使用同一 Render Web Service、同一域名、同一端口。房间在 Node.js 进程内存里；仅适用于朋友间的短局试玩，不保存永久世界。

## 快速自部署

1. 将本项目上传至你的 GitHub 仓库（需要是文件本身，不是 ZIP）。
2. Render → New → Web Service → 选择该仓库和分支。
3. Environment: Node；Plan: Free；Region: Singapore（或距离玩家最近的区）。
4. Build Command: `npm ci --ignore-scripts`（本项目无第三方依赖；也可使用 `node -v`）。
5. Start Command: `npm start`。
6. 等部署显示 Live，打开 Render 提供的 `https://xxx.onrender.com`，创建房间。
7. 点击“分享”按钮，将 `https://xxx.onrender.com/?room=XXXXXX` 发给好友，好友输入昵称加入。

服务器自动读取 `PORT` 并监听 `0.0.0.0`。公网下客户端自动选择 `wss://.../ws`。

## 免费服务限制

- Render Free 在 15 分钟没有收到 HTTP 请求或 WebSocket 消息后可能休眠；下一次访问需要唤醒，有冷启动延迟。
- 房间和游戏世界仅在进程内存中，休眠、重启、部署将清空所有房间；邀请码失效。
- 每个 Render workspace 750 Free instance hours/月，**按所有免费服务累计**，超额服务可能暂停。更多流量/构建也有配额。
- 免费服务不适合正式商业运行。建议以后升级持久化、鉴权和限流。

## 健康检查

- `GET /health` 返回 `ok`, `version`, `rooms`, `players`, `uptimeSeconds`。
- 使用 HTTPS 连接网页，WebSocket 为 WSS。移动端不需要装 APK。

## 安全建议

- 限制最大房间数 `MAX_ROOMS`（默认 28）和连接数 `MAX_CONNECTIONS`（默认 120）。
- 仅在可信朋友小范围分享公网地址；原型不存在账号、封禁、反滥用后台或强认证。
- 不要在代码、网址或截图里放 API 密钥。最好定期更新和部署。
