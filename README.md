# NeckTalk · 颈边实时双语字幕

一个带自动语种识别、双语翻译和说话人追踪的实时字幕网页。说中文会自动出英文字幕，说英文会自动出中文字幕，不需要手动选择语言。双语字幕会贴在说话人的颈部附近，尽量不遮挡面部。

在线体验：<https://232yhzhang.github.io/necktalk/>

> 自动识别和 DeepSeek 润色依赖自建的 Cloudflare Worker 代理。未完成代理配置时，页面会自动回退到浏览器语音识别，需要手动切换「说话语言」。部署方法见下方「自建代理」。

## 功能

- 自动识别中文 / English，无需手动选择说话语言
- 同屏双语字幕：中文语音出英文译文，英文语音出中文译文
- DeepSeek 译文润色（经自建 Worker 代理调用）
- 多人画面自动标注「发言人A / 发言人B / …」，每位发言人使用不同颜色
- 人脸与颈部追踪，双语字幕气泡跟随正在说话的人移动
- 字幕记录面板：原文与译文同时保存，可复制全文、导出双语 SRT
- 画面镜像开关；镜像只影响画面，不影响字幕阅读
- 响应式界面，支持桌面与手机竖屏
- 未配置代理时自动回退到浏览器 Web Speech（手动语言模式）

## 使用方式

1. 完成下方「自建代理」的 Worker 部署，并获得一个 Worker 地址。
2. 打开网页，在**右上角齿轮 → Worker 地址**中填入地址并保存。
   - 这个地址只保存在当前浏览器，适合测试。
   - 要让所有访客都使用自动识别，请把地址写入 `assets/config.js` 的 `proxyBaseUrl` 并重新部署。
3. 点击「开启摄像头 · 开始翻译」，允许摄像头与麦克风权限。
4. 直接说中文或英文。系统会自动识别语种、选择翻译方向，并把双语字幕放在说话人颈部附近。
5. 右上角或底部「记录」可查看完整双语字幕，并复制或导出 SRT。
6. 「结束翻译」停止本次会话；记录会保留，重新开始新会话会清空当前记录。

未配置代理时，页面顶部会出现「未配置自动识别代理」提示；此时可使用右上角「说话语言」手动选择中文或英文。

## 实现方式

- **自动语音识别**：浏览器采集麦克风音频并进行语音活动检测（VAD）；在自然停顿处分段，把短音频片段发送到自建 Worker。Worker 调用 Groq `whisper-large-v3-turbo`，返回转写文本和自动检测到的语言。VAD 会保留少量前置音频，并按静音切句。
- **翻译**：根据检测到的语言自动把中文翻成英文，或把英文翻成中文。基础译文由 DeepL（经 Mozhi 社区实例）提供，失败时回退 MyMemory；随后可再调用 Worker 中的 DeepSeek 润色步骤，让译文更自然。
- **面部与颈部定位**：MediaPipe Face Landmarker 在本地对视频逐帧检测，取得下巴、额头等关键点，在颈部高度生成字幕锚点。模型与 WASM 位于 `assets/vendor/`，画面不上传。
- **发言人判断**：读取每个面部的 `jawOpen` 值，并与麦克风音量包络做短时相关性计算，结合嘴部动作能量推断当前说话人。字幕气泡按照面部轨迹平滑移动。
- **回退模式**：浏览器不支持代理或代理不可用时，使用浏览器 Web Speech API 加手动语言选择；该模式保留原有的实时碎片字幕体验。
- **稳定性**：翻译失败时保留原文；DeepSeek 润色失败时保留基础译文；人脸追踪不可用时字幕自动回退到画面底部。

## 自建代理

自动识别和 DeepSeek 润色都需要在 Worker 服务端持有 API Key，避免把密钥暴露在公开网页中。Worker 代码位于 `worker/`。

### 准备

- 一个 Cloudflare 账号
- 一个 Groq API Key（用于云端 Whisper 自动识别，Groq 提供免费额度）
- 一个 DeepSeek API Key（用于译文润色）

### 部署 Worker

```powershell
cd worker
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

部署前请修改 `worker/wrangler.toml` 中的 `ALLOWED_ORIGINS`，至少包含：

```toml
[vars]
ALLOWED_ORIGINS = "https://你的用户名.github.io,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8787"
```

如果使用 GitHub Pages 用户名 `232yhzhang`，默认值已经包含 `https://232yhzhang.github.io`。部署完成后记下形如 `https://necktalk-proxy.xxx.workers.dev` 的地址。

### 本地测试 Worker

```powershell
cd worker
npm install
npx wrangler dev
```

本地 Worker 默认监听 `http://localhost:8787`，并读取 `worker/.dev.vars`（从 `.dev.vars.example` 复制并填入 Key，**不要提交到仓库**）。

### 填写地址

- **只在当前浏览器启用**：打开网页 → 右上角齿轮 → 填入 Worker 地址 → 测试连接 → 保存。
- **让所有访客启用**：编辑 `assets/config.js`：

```js
window.NECKTALK_CONFIG = {
  proxyBaseUrl: "https://necktalk-proxy.xxx.workers.dev",
  polish: true,
};
```

提交并重新部署页面。页面仍会提供设置入口，方便调试。

> Worker 地址可以公开，但 Groq / DeepSeek 的 Key 绝不能写进网页或仓库。`worker/.dev.vars` 已被忽略。公开 Worker 的调用额度仍可能被滥用，建议关注 Cloudflare、Groq、DeepSeek 的用量与限额。

## 已知限制

- **自动识别需要代理和网络**。音频片段会上传到自建 Worker，再发送给 Groq。在线识别通常能在说话人自然停顿后约 1–2 秒返回结果；它不是逐字实时流式识别。
- **没有停顿的连续讲话**会按最长约 10 秒分段，字幕成段出现。建议正常断句。
- 自动识别与 DeepSeek 润色有第三方额度与速率限制。任一服务不可用时，会退回基础翻译或原文；代理整体不可用时会回退到手动 Web Speech 模式。
- **一次只运行一种识别模式**。自动模式不提供手动语种切换；如果代理不可用，才显示手动回退的「说话语言」。
- 发言人归属是**基于嘴唇动作与音量相关性的启发式判断，不是声纹识别**。多人同时说话、背对镜头、脸部被遮挡或光线过暗时可能误判或串位。建议一次一人发言、保持正脸入镜。
- 人脸追踪模型约 20 MB，首次点击开始时需要下载，之后由浏览器缓存。
- Firefox 没有 Web Speech 回退能力；配置了代理时仍可使用自动识别。Safari / iOS 的支持程度取决于系统版本，建议使用桌面版 Chrome / Edge。
- DeepSeek 润色每次会在基础译文之后额外请求一次，关闭「使用 DeepSeek 润色译文」可降低延迟和用量。
- 翻译质量由 DeepL / DeepSeek / MyMemory 等第三方服务决定，专业术语、俚语和强语境表达仍可能不够准确。

## 隐私

- 摄像头画面只在本地浏览器中用于人脸追踪，不上传服务器。
- 自动识别模式下，语音片段会发送到自建 Worker，并由 Worker 转发给 Groq 做转写。浏览器回退模式下，语音由浏览器自带的语音服务处理。
- 识别出的文字会发送给 DeepL（经由 Mozhi 社区实例）；失败时发送给 MyMemory。开启润色时，原文与基础译文会由 Worker 发送给 DeepSeek。
- Groq、DeepSeek、Cloudflare、Mozhi、DeepL、MyMemory 各自有其隐私政策与保留规则。
- 字幕记录仅保存在当前页面内，刷新或关闭页面即丢失；导出文件也只在本地生成。
- API Key 只保存在 Worker 环境变量中，不会进入网页或 GitHub 仓库。

## 本地运行

页面是静态站点，不需要构建：

```powershell
cd necktalk
python -m http.server 4173
```

然后打开 <http://localhost:4173>。请勿直接双击 `index.html` 使用 `file://` 协议，浏览器会阻止摄像头、麦克风与模块加载。

如果要完整测试自动识别与润色，请同时在 `worker/` 中运行：

```powershell
npx wrangler dev
```

并在网页设置中填入 `http://localhost:8787`（需把该地址加入 Worker 的 `ALLOWED_ORIGINS`）。

## 部署

网页通过 GitHub Pages 从 `main` 分支根目录发布。Worker 是独立的 Cloudflare 服务，不会被 GitHub Pages 托管。

要让公开页面默认启用自动识别，请把 Worker 地址写入 `assets/config.js` 的 `proxyBaseUrl` 后再推送。否则访客会看到手动回退模式，并可以通过设置填写自己的代理地址。

## 目录

```text
index.html                  页面结构
assets/styles.css           界面样式
assets/app.js               会话、双语字幕、翻译队列、面板与发言人逻辑
assets/cloud-asr.js         音频 VAD 分段与云端自动识别
assets/config.js            默认 Worker 地址（公开，可安全填写）
assets/face-tracker.js      MediaPipe 人脸 / 颈部追踪封装
assets/recognition.js       Web Speech 回退识别
assets/translate.js         基础翻译（内置 / DeepL / MyMemory）
assets/vendor/              MediaPipe Tasks Vision、WASM 与 Face Landmarker 模型
worker/index.js             Cloudflare Worker 代理
worker/wrangler.toml        Worker 配置与允许来源
worker/.dev.vars.example    本地开发密钥示例（真实 .dev.vars 不要提交）
```

## 第三方组件与服务

- MediaPipe Tasks Vision 与 Face Landmarker 模型（Google，Apache License 2.0）
- Groq Whisper 自动语音识别（<https://groq.com/>）
- DeepSeek 润色 API（<https://www.deepseek.com/>）
- DeepL（经由 Mozhi 社区实例）与 MyMemory 翻译
- Cloudflare Workers 运行时

详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
