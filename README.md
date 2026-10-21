# NeckTalk · 颈边实时字幕

一个纯前端的实时中英文语音字幕网页。打开摄像头与麦克风后，NeckTalk 会把识别到的句子转成带发言人署名的字幕，并让字幕跟随说话人的颈部位置，尽量不遮挡面部。

在线体验：<https://232yhzhang.github.io/necktalk/>

## 功能

- 实时中文 / English 语音转写，识别中的文字会先以半透明形式出现
- 多人画面自动标注「发言人A / 发言人B / …」，每位发言人使用不同颜色
- 人脸与颈部追踪，字幕气泡跟随正在说话的人移动
- 画面镜像开关；镜像只影响画面，不影响字幕阅读
- 字幕记录面板：复制全部文字、导出 SRT、清空记录
- 无网络模型依赖：人脸追踪模型、WASM 均已随站点托管
- 响应式界面，支持桌面与手机竖屏

## 使用方式

1. 使用最新版桌面 Chrome 或 Edge 打开网页（推荐桌面版，麦克风与页面内语音识别支持最完整）。
2. 在右上角选择识别语言：`中文` 或 `EN`。
3. 点击「开启摄像头 · 开始字幕」，允许摄像头与麦克风权限。
4. 让说话人的脸部出现在画面中，开始说话。字幕会出现在其下巴下方的颈部位置。
5. 右上角或底部「记录」可查看完整字幕，并复制或导出 SRT。
6. 「结束字幕」停止本次会话；记录会保留，重新开始新会话会清空当前记录。

## 实现方式

- **语音转写**：浏览器原生 Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`），开启 `continuous` 与 `interimResults`，并通过自动重启保持在听状态。
- **面部与颈部定位**：MediaPipe Face Landmarker 在本地对视频逐帧检测，取得下巴、额头等关键点，在颈部高度生成字幕锚点。模型与 WASM 位于 `assets/vendor/`，不上传画面。
- **发言人判断**：同时读取每个面部的 `jawOpen` 值，并与麦克风音量包络做短时相关性计算；结合嘴部动作能量推断当前说话人，再为字幕分配「发言人」编号。字幕气泡按照面部轨迹平滑移动。
- **稳定性处理**：识别空闲自动重启；语言切换即时重启；识别服务异常可自动重试；人脸追踪不可用时字幕自动回退到画面底部。

## 已知限制

- 浏览器语音识别通常依赖厂商的在线服务，需要联网。Chrome 使用 Google 的语音服务，Edge 使用 Microsoft 的服务。网络无法访问相应服务时，会显示「连接重试中」。
- 一次只能运行一种识别语言；语言切换会中断当前识别并重新开始。中英文混说时需要手动切换。
- 发言人归属是**基于嘴唇动作与音量相关性的启发式判断，不是声纹识别**。多人同时说话、背对镜头、脸部被遮挡或光线过暗时可能误判或串位。建议一次一人发言、保持正脸入镜。
- 人脸追踪模型约 20 MB，首次点击开始时需要下载，之后由浏览器缓存。
- Firefox 不支持 Web Speech 识别；Safari / iOS 的支持程度取决于系统版本，建议使用桌面版 Chrome / Edge。

## 隐私

- 摄像头画面只在本地浏览器中用于人脸追踪，不上传服务器。
- 语音识别由浏览器自带的语音服务完成，音频是否上传取决于所用的浏览器与厂商实现（Chrome / Edge 通常会发送到在线语音服务）。
- 字幕记录仅保存在当前页面内，刷新或关闭页面即丢失；导出文件也只在本地生成。

## 本地运行

本项目是静态站点，不需要构建：

```powershell
cd necktalk
python -m http.server 4173
```

然后打开 <http://localhost:4173>。请勿直接双击 `index.html` 使用 `file://` 协议，浏览器会阻止摄像头、麦克风与模块加载。

也可以使用任意静态服务器，例如 `npx serve .`。

## 目录

```text
index.html                  页面结构
assets/styles.css           界面样式
assets/app.js               会话、字幕、面板、发言人逻辑
assets/face-tracker.js      MediaPipe 人脸 / 颈部追踪封装
assets/recognition.js       Web Speech 识别控制器
assets/vendor/              MediaPipe Tasks Vision、WASM 与 Face Landmarker 模型
```

## 第三方组件

MediaPipe Tasks Vision 与 Face Landmarker 模型由 Google 提供，采用 Apache License 2.0。详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
