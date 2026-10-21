# NeckTalk · 颈边实时双语字幕

一个带自动语种识别、双语翻译和说话人追踪的实时字幕网页。说中文会自动出英文字幕，说英文会自动出中文字幕，不需要手动选择语言。双语字幕会贴在说话人的颈部附近，尽量不遮挡面部。

在线体验：<https://232yhzhang.github.io/necktalk/>

> 自动识别使用浏览器直连 SiliconFlow SenseVoice，译文先由基础翻译快速显示，再由浏览器直连 DeepSeek 在后台优化。API Key 只保存在你自己的浏览器中，不需要服务器，也不需要域名。共享页面时，其他访客需要填写自己的 Key，或者使用浏览器回退模式。

## 功能

- 自动识别中文 / English，无需手动选择说话语言
- 同屏双语字幕：中文语音出英文译文，英文语音出中文译文
- DeepSeek 后台优化（基础译文先显示，随后替换为更自然的译文）
- 多人画面自动标注「发言人A / 发言人B / …」，每位发言人使用不同颜色
- 人脸与颈部追踪，双语字幕气泡跟随正在说话的人移动
- 字幕记录面板：原文与译文同时保存，可复制全文、导出双语 SRT
- 画面镜像开关；镜像只影响画面，不影响字幕阅读
- 响应式界面，支持桌面与手机竖屏
- 未配置 Key 时自动回退到浏览器 Web Speech（手动语言模式）

## 使用方式

1. 准备 API Key：
   - SiliconFlow：登录 <https://cloud.siliconflow.cn/> 创建 API Key
   - DeepSeek：登录 <https://platform.deepseek.com/api_keys> 创建 API Key（可选，用于优化译文）
2. 打开网页，点击右上角齿轮，把两个 Key 填入「浏览器直连」，点「保存并启用」。
3. 点击「开启摄像头 · 开始翻译」，允许摄像头与麦克风权限。
4. 直接说中文或英文。系统会自动识别语种、选择翻译方向；如果启用了 DeepSeek 优化，会先显示基础译文，再自动替换为 DeepSeek 译文。
5. 右上角或底部「记录」可查看完整双语字幕，并复制或导出 SRT。
6. 「结束翻译」停止本次会话；记录会保留，重新开始新会话会清空当前记录。

如果还没有填写 Key，页面会显示「未配置自动识别」提示；此时仍可使用浏览器 Web Speech 回退，并手动切换「说话语言」。

## 实现方式

- **自动语音识别**：浏览器采集麦克风音频并进行语音活动检测（VAD）；在自然停顿处分段，把短音频片段直接发送到 SiliconFlow 的 `FunAudioLLM/SenseVoiceSmall`。模型支持中英文，并自动识别语种。
- **翻译**：根据检测到的语言自动把中文翻成英文，或把英文翻成中文。基础翻译使用内置浏览器翻译、DeepL（经 Mozhi 社区实例）或 MyMemory；如果填写了 DeepSeek Key 并开启优化，基础译文会先显示，同时 DeepSeek 在后台生成更自然的译文并替换。DeepSeek 不可用时保留基础译文。
- **面部与颈部定位**：MediaPipe Face Landmarker 在本地对视频逐帧检测，取得下巴、额头等关键点，在颈部高度生成字幕锚点。模型与 WASM 位于 `assets/vendor/`，画面不上传。
- **发言人判断**：读取每个面部的 `jawOpen` 值，并与麦克风音量包络做短时相关性计算，结合嘴部动作能量推断当前说话人。字幕气泡按照面部轨迹平滑移动。
- **回退模式**：未配置 SiliconFlow Key 时，使用浏览器 Web Speech API 加手动语言选择；该模式保留实时碎片字幕体验。
- **稳定性**：翻译失败时保留原文；DeepSeek 优化失败时保留基础译文；人脸追踪不可用时字幕自动回退到画面底部。

## 浏览器直连

这是默认方式，也是当前页面的主要使用方式：

- 页面是纯静态站点，不需要服务器。
- SiliconFlow Key 只保存在当前浏览器的 `localStorage` 中。
- DeepSeek Key 只保存在当前浏览器的 `localStorage` 中，用于优化译文。
- Key 会直接发送给对应的服务商，不经过本项目的服务器。
- 共享页面时，其他访客需要填写自己的 Key；否则会回退到浏览器手动识别。
- 不要在公用电脑保存 Key。打开设置可以随时清除。

SiliconFlow 的 SenseVoice 模型在控制台中标注为免费，但仍受账号额度、请求频率和网络情况影响。DeepSeek 优化会产生相应账户用量。

### 延迟来自哪里

字幕不是像 Web Speech 那样逐字出现，而是按语音片段批量识别：

1. 检测到约 **0.55 秒静音**后才把当前语音片段发送出去；
2. SiliconFlow ASR 网络请求与转写；
3. 基础翻译会先返回并显示；如果开启 DeepSeek 优化，DeepSeek 会在后台生成优化译文并替换。关闭 DeepSeek 时只使用基础翻译。

连续讲话没有停顿时，每约 6 秒会强制切段。想更快看到字幕，可以：正常断句、关闭 DeepSeek 优化（只走基础翻译，通常更快）、保持网络稳定。SiliconFlow/SenseVoice 已属于低延迟模型；如果仍需要逐字实时效果，需要换成支持流式 WebSocket 的 ASR 服务。

## 自建代理

如果你希望所有访客共用一个服务端代理，并且不把 Key 暴露在浏览器里，可以额外部署 `worker/` 中的 Cloudflare Worker。这需要你自己的域名或可访问的 Worker 域名。

> `*.workers.dev` 在中国大陆部分网络会被 DNS 污染或阻断。若要公开分享，给 Worker 绑定自定义域名更可靠；只给自己用则直接用上面的浏览器直连即可。

### 准备

- 一个 Cloudflare 账号
- 一个 SiliconFlow API Key
- 一个 DeepSeek API Key

### 部署 Worker

```powershell
cd worker
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ASR_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
```

`worker/wrangler.toml` 默认配置：

```toml
ASR_ENDPOINT = "https://api.siliconflow.cn/v1/audio/transcriptions"
ASR_MODEL = "FunAudioLLM/SenseVoiceSmall"
```

也可以换成其他 OpenAI 兼容 ASR，例如 DeepInfra、Groq、OpenAI：

```toml
ASR_ENDPOINT = "https://api.deepinfra.com/v1/openai/audio/transcriptions"
ASR_MODEL = "openai/whisper-large-v3-turbo"
```

`ALLOWED_ORIGINS` 需要包含网页来源，例如 `https://232yhzhang.github.io` 和本地开发地址。修改后重新执行 `npx wrangler deploy`。

在网页设置的「高级：使用自建 Worker 代理」中填入 Worker 地址；如果希望所有访客默认使用，则把地址写入 `assets/config.js` 的 `proxyBaseUrl` 并重新部署页面。

> API Key 只放在 Worker Secret 中，不要写进网页或仓库。公开 Worker 的调用额度仍可能被滥用，请关注服务商用量。

## 已知限制

- **自动识别需要联网**。音频片段会上传到 SiliconFlow（默认）。在线识别通常能在说话人自然停顿后约 1–2 秒返回结果；不是逐字实时流式识别。
- **没有停顿的连续讲话**会按最长约 6 秒分段，字幕成段出现。建议正常断句。
- 自动识别与 DeepSeek 优化有第三方额度与速率限制。SiliconFlow Key 无效、额度用尽或网络不可用时，会退回手动 Web Speech 模式；DeepSeek 优化失败时会保留基础译文。
- **直连模式的 Key 属于当前浏览器**。共享页面时，其他访客需要填写自己的 Key，无法直接共享你的 Key。
- **一次只运行一种识别模式**。自动模式不提供手动语种切换；如果没有有效 Key，才显示手动回退的「说话语言」。
- 发言人归属是**基于嘴唇动作与音量相关性的启发式判断，不是声纹识别**。多人同时说话、背对镜头、脸部被遮挡或光线过暗时可能误判或串位。建议一次一人发言、保持正脸入镜。
- 人脸追踪模型约 20 MB，首次点击开始时需要下载，之后由浏览器缓存。
- Firefox 没有 Web Speech 回退能力；配置了 SiliconFlow Key 时仍可使用自动识别。Safari / iOS 的支持程度取决于系统版本，建议使用桌面版 Chrome / Edge。
- 开启 DeepSeek 优化时会同时请求基础翻译与 DeepSeek：基础译文先显示，DeepSeek 随后替换；关闭后只请求基础翻译，速度通常更快。DeepSeek 不可用时保留基础译文。
- 翻译质量由 SiliconFlow / DeepL / DeepSeek / MyMemory 等第三方服务决定，专业术语、俚语和强语境表达仍可能不够准确。

## 隐私

- 摄像头画面只在本地浏览器中用于人脸追踪，不上传服务器。
- 自动识别模式下，语音片段由浏览器直接发送给 SiliconFlow 做转写；浏览器回退模式下，语音由浏览器自带的语音服务处理。
- 识别出的文字会发送给 DeepL（经由 Mozhi 社区实例）；失败时发送给 MyMemory。填写 DeepSeek Key 后，原文也会直接发送给 DeepSeek 做译文优化。
- API Key 只保存在当前浏览器的 `localStorage`，不会进入网页配置或 GitHub 仓库。
- 字幕记录仅保存在当前页面内，刷新或关闭页面即丢失；导出文件也只在本地生成。

## 本地运行

页面是静态站点，不需要构建：

```powershell
cd necktalk
python -m http.server 4173
```

然后打开 <http://localhost:4173>。请勿直接双击 `index.html` 使用 `file://` 协议，浏览器会阻止摄像头、麦克风与模块加载。

浏览器直连不需要 Worker；填入 SiliconFlow / DeepSeek Key 即可使用。完整测试 Worker 代理时，可以另行执行 `npx wrangler dev`。

## 部署

网页通过 GitHub Pages 从 `main` 分支根目录发布，不需要构建命令。直接推送静态文件即可。

自动识别与译文优化使用浏览器本地 Key，不需要修改 `assets/config.js`。`config.js` 仅用于可选的 Worker 代理地址。

## 目录

```text
index.html                  页面结构
assets/styles.css           界面样式
assets/app.js               会话、双语字幕、翻译队列、面板与发言人逻辑
assets/cloud-asr.js         音频 VAD 分段与云端自动识别
assets/config.js            可选的 Worker 地址
assets/face-tracker.js      MediaPipe 人脸 / 颈部追踪封装
assets/recognition.js       Web Speech 回退识别
assets/translate.js         基础翻译（内置 / DeepL / MyMemory）
assets/vendor/              MediaPipe Tasks Vision、WASM 与 Face Landmarker 模型
worker/index.js             可选的 Cloudflare Worker 代理
```

## 第三方组件与服务

- MediaPipe Tasks Vision 与 Face Landmarker 模型（Google，Apache License 2.0）
- SiliconFlow SenseVoice 自动语音识别（<https://siliconflow.cn/>）
- DeepSeek 译文优化 API（<https://www.deepseek.com/>）
- DeepL（经由 Mozhi 社区实例）与 MyMemory 翻译
- 可选：Cloudflare Workers、Groq、DeepInfra、OpenAI 等 OpenAI 兼容 ASR

详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

