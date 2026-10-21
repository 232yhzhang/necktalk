import { FaceTracker } from "./face-tracker.js";
import { RecognitionController } from "./recognition.js";

const SPEAKER_COLORS = ["#ffb86b", "#7ce7c0", "#b49cff", "#6fc3ff", "#ff8fa3", "#e6db79"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LANGUAGES = {
  "zh-CN": { name: "中文", short: "中" },
  "en-US": { name: "English", short: "EN" },
};
const DETECT_INTERVAL = 70;
const BUBBLE_LIFETIME = 7000;
const DRAFT_LIFETIME = 5000;
const MERGE_WINDOW = 5000;
const MAX_ENTRY_LENGTH = 540;
const FINAL_TAIL = { "zh-CN": 58, "en-US": 160 };
const DRAFT_TAIL = { "zh-CN": 30, "en-US": 76 };

const SPEECH_MESSAGES = {
  "not-allowed": "麦克风权限被拒绝，请在地址栏的网站设置中允许麦克风后重试。",
  "service-not-allowed": "浏览器语音服务被禁用或不可用，请使用 Chrome / Edge 并检查网络。",
  network: "语音识别服务连接中断，正在自动重试（需要联网访问浏览器的语音服务）。",
  "audio-capture": "没有检测到可用的麦克风，正在尝试重新连接。",
  "language-not-supported": "当前浏览器不支持所选语言的识别，请切换语言后重试。",
  unsupported: "当前浏览器不支持实时语音识别，请使用桌面版 Chrome 或 Edge。",
  "no-speech": "",
  aborted: "",
};

const $ = (selector) => document.querySelector(selector);

const app = $("#app");
const video = $("#camera");
const stage = $("#stage");
const startBtn = $("#start-btn");
const startBtnText = $(".start-btn-text");
const setupError = $("#setup-error");
const liveChip = $("#live-chip");
const liveText = $("#live-text");
const mirrorBtn = $("#mirror-btn");
const panelBtn = $("#panel-btn");
const dockPanelBtn = $("#dock-panel-btn");
const panelBadge = $("#panel-badge");
const fullscreenBtn = $("#fullscreen-btn");
const langButtons = [...document.querySelectorAll(".lang-btn")];
const dock = $("#dock");
const dockTitle = $("#dock-title");
const dockSub = $("#dock-sub");
const eq = $("#eq");
const stopBtn = $("#stop-btn");
const panel = $("#panel");
const panelScrim = $("#panel-scrim");
const panelClose = $("#panel-close");
const panelBody = $("#panel-body");
const panelEmpty = $("#panel-empty");
const entryList = $("#entry-list");
const panelCount = $("#panel-count");
const copyBtn = $("#copy-btn");
const exportBtn = $("#export-btn");
const clearBtn = $("#clear-btn");
const loader = $("#loader");
const loaderText = $("#loader-text");
const loaderBar = $("#loader-bar");
const toast = $("#toast");
const toastText = $("#toast-text");
const hintPill = $("#hint-pill");
const hintClose = $("#hint-close");

const initialLang = (() => {
  try {
    const saved = localStorage.getItem("necktalk-lang");
    if (saved && LANGUAGES[saved]) return saved;
  } catch (error) {
    void error;
  }
  return "zh-CN";
})();

const initialMirror = (() => {
  try {
    return localStorage.getItem("necktalk-mirror") !== "0";
  } catch (error) {
    return true;
  }
})();

const state = {
  live: false,
  starting: false,
  busy: false,
  lang: initialLang,
  mirror: initialMirror,
  stream: null,
  videoReady: false,
  audioContext: null,
  audioSource: null,
  analyser: null,
  audioData: null,
  audioLevel: 0,
  audioActive: false,
  noiseFloor: 0.008,
  lastSoundAt: 0,
  soundRestartedAt: 0,
  eqUpdatedAt: 0,
  tracker: null,
  trackerReady: false,
  faces: new Map(),
  speakers: new Map(),
  speakerByKey: new Map(),
  fallbackSpeaker: null,
  lastSpeaker: null,
  speakerSeq: 0,
  draft: { speakerKey: null, text: "" },
  activeFaceId: null,
  lastTextFaceId: null,
  lastTextAt: 0,
  lastDetectAt: 0,
  faceCount: 0,
  rafId: 0,
  startedAt: 0,
  transcript: [],
  entrySeq: 0,
  bubbleZ: 10,
  lastFinalText: "",
  lastFinalAt: 0,
  speech: null,
  speechIssue: null,
  lastSpeechToastAt: 0,
  panelOpen: false,
  autoScroll: true,
  hintShown: false,
  toastTimer: 0,
  hintTimer: 0,
  hintHideTimer: 0,
  loaderTimer: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function joinSpeechText(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a) return b;
  if (!b) return a;

  const last = a[a.length - 1];
  const first = b[0];
  const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
  const cjkPunctuation = /[，。！？；：、）》」』”’…]/;
  const latinPunctuation = /[.!?,;:]/;

  if (cjk.test(last) && cjk.test(first)) return `${a}${b}`;
  if (cjkPunctuation.test(last)) return `${a}${b}`;
  if (cjkPunctuation.test(first)) return `${a}${b}`;
  if (
    (/[A-Za-z0-9]$/.test(last) && /^[A-Za-z0-9]/.test(b)) ||
    (latinPunctuation.test(last) && /^[A-Za-z0-9]/.test(b)) ||
    (cjk.test(last) && /^[A-Za-z0-9]/.test(b)) ||
    (/[A-Za-z0-9]$/.test(last) && cjk.test(first))
  ) {
    return `${a} ${b}`;
  }
  return `${a} ${b}`;
}

function truncateTail(text, limit) {
  const clean = String(text || "").trim();
  if (clean.length <= limit) return clean;

  let tail = clean.slice(clean.length - limit);
  if (state.lang === "en-US") {
    const boundary = tail.indexOf(" ");
    if (boundary > 0 && boundary < 18) tail = tail.slice(boundary + 1);
  }
  return `… ${tail}`;
}

function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSrtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds,
  ).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function setLoader(progress, message) {
  loaderBar.style.width = `${clamp(progress, 0, 100)}%`;
  if (message) loaderText.textContent = message;
}

function showLoader(message) {
  window.clearTimeout(state.loaderTimer);
  loader.hidden = false;
  loader.classList.remove("is-done");
  setLoader(6, message);
}

function hideLoader(progress = 100) {
  setLoader(progress, "");
  loader.classList.add("is-done");
  window.clearTimeout(state.loaderTimer);
  state.loaderTimer = window.setTimeout(() => {
    loader.hidden = true;
    loader.classList.remove("is-done");
  }, 620);
}

function setStartBusy(busy) {
  state.busy = busy;
  startBtn.disabled = busy;
  startBtn.classList.toggle("is-busy", busy);
  startBtn.setAttribute("aria-busy", busy ? "true" : "false");
  if (busy) {
    startBtnText.textContent = "正在准备…";
  } else if (!state.live && state.transcript.length > 0) {
    startBtnText.textContent = "重新开始字幕";
  } else if (!state.live) {
    startBtnText.textContent = "开启摄像头 · 开始字幕";
  }
}

function showSetupError(message) {
  setupError.textContent = message;
  setupError.hidden = false;
}

function hideSetupError() {
  setupError.hidden = true;
  setupError.textContent = "";
}

function showToast(message, { error = false, duration = 4200 } = {}) {
  if (!message) return;
  window.clearTimeout(state.toastTimer);
  toastText.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, duration);
}

function hideHint() {
  window.clearTimeout(state.hintTimer);
  window.clearTimeout(state.hintHideTimer);
  hintPill.classList.remove("is-visible");
}

function scheduleHint() {
  hideHint();
  if (!state.live || state.hintShown) return;
  state.hintShown = true;
  state.hintTimer = window.setTimeout(() => {
    if (!state.live) return;
    hintPill.classList.add("is-visible");
    state.hintHideTimer = window.setTimeout(() => {
      hintPill.classList.remove("is-visible");
    }, 8500);
  }, 1400);
}

function applyPreferences() {
  app.classList.toggle("mirror-off", !state.mirror);
  mirrorBtn.classList.toggle("is-active", state.mirror);
  mirrorBtn.setAttribute("aria-pressed", state.mirror ? "true" : "false");

  langButtons.forEach((button) => {
    const active = button.dataset.lang === state.lang;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setLanguage(lang, announce = true) {
  if (!LANGUAGES[lang] || state.lang === lang) return;

  state.lang = lang;
  try {
    localStorage.setItem("necktalk-lang", lang);
  } catch (error) {
    void error;
  }

  applyPreferences();

  if (state.speech) {
    state.speech.setLanguage(lang);
  }

  if (state.live) {
    state.draft = { speakerKey: null, text: "" };
    for (const speaker of state.speakerByKey.values()) {
      speaker.entry = null;
      speaker.entryUpdatedAt = 0;
      hideSpeaker(speaker);
    }
    updateDockSubtitle();
    updateSpeechUI();
    if (announce) {
      showToast(`已切换为 ${LANGUAGES[lang].name} 识别`);
    }
  }
}

function toggleMirror() {
  state.mirror = !state.mirror;
  try {
    localStorage.setItem("necktalk-mirror", state.mirror ? "1" : "0");
  } catch (error) {
    void error;
  }
  app.classList.toggle("mirror-off", !state.mirror);
  mirrorBtn.classList.toggle("is-active", state.mirror);
  mirrorBtn.setAttribute("aria-pressed", state.mirror ? "true" : "false");

  for (const speaker of state.speakerByKey.values()) {
    speaker.hasPosition = false;
  }
}

function preflight() {
  if (!window.isSecureContext) {
    showSetupError("摄像头与语音识别需要安全上下文，请通过 HTTPS 或 localhost 打开本页。");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showSetupError("当前浏览器不支持摄像头访问，请使用最新版桌面 Chrome 或 Edge。");
    return;
  }
  if (!RecognitionController.isSupported()) {
    showSetupError("当前浏览器不支持实时语音识别，请使用桌面版 Chrome 或 Edge 打开。");
  }
}

function setLoaderFailure(message) {
  setLoader(0, message);
  hideLoader(0);
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new DOMException("Media devices unavailable", "NotSupportedError");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });

  state.stream = stream;
  video.srcObject = stream;

  try {
    await video.play();
  } catch (error) {
    void error;
  }

  if (video.readyState < 2) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        video.removeEventListener("loadedmetadata", finish);
        resolve();
      };
      const timer = window.setTimeout(finish, 2600);
      video.addEventListener("loadedmetadata", finish, { once: true });
    });
  }

  state.videoReady = true;
}

async function startAudioGraph() {
  if (!state.stream) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch (error) {
      void error;
    }
  }

  const source = context.createMediaStreamSource(state.stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);

  state.audioContext = context;
  state.audioSource = source;
  state.analyser = analyser;
  state.audioData = new Float32Array(analyser.fftSize);
}

async function loadTracker() {
  if (state.trackerReady) return;
  if (!state.tracker) state.tracker = new FaceTracker();
  await state.tracker.init();
  state.trackerReady = true;
}

function stopMedia() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        void error;
      }
    });
    state.stream = null;
  }

  try {
    video.pause();
  } catch (error) {
    void error;
  }
  video.srcObject = null;
  state.videoReady = false;

  if (state.audioContext) {
    try {
      state.audioContext.close();
    } catch (error) {
      void error;
    }
  }

  state.audioContext = null;
  state.audioSource = null;
  state.analyser = null;
  state.audioData = null;
  state.audioLevel = 0;
  state.audioActive = false;
  state.noiseFloor = 0.008;
  state.lastSoundAt = 0;
  state.soundRestartedAt = 0;
  eq.style.setProperty("--level", "0.04");
  eq.classList.add("is-quiet");
}

function cleanupForExit() {
  try {
    state.speech?.stop();
  } catch (error) {
    void error;
  }
  stopMedia();
  state.tracker?.close();
}

function resetSession() {
  state.transcript = [];
  state.entrySeq = 0;
  state.speakerSeq = 0;
  state.speakerByKey.clear();
  state.speakers.clear();
  state.fallbackSpeaker = null;
  state.lastSpeaker = null;
  state.draft = { speakerKey: null, text: "" };
  state.activeFaceId = null;
  state.lastTextFaceId = null;
  state.lastTextAt = 0;
  state.lastDetectAt = 0;
  state.faceCount = 0;
  state.lastFinalText = "";
  state.lastFinalAt = 0;
  state.faces.clear();
  state.bubbleZ = 10;
  state.autoScroll = true;
  state.hintShown = false;

  state.tracker?.reset();
  stage.querySelectorAll(".subtitle").forEach((element) => element.remove());
  entryList.replaceChildren();
  panelEmpty.hidden = false;
  panelBadge.hidden = true;
  panelCount.textContent = "0 条";
}

function friendlyMediaError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "摄像头或麦克风权限被拒绝。请在地址栏的网站设置中允许权限，然后重试。";
    case "NotFoundError":
      return "没有找到可用的摄像头或麦克风，请检查设备连接。";
    case "NotReadableError":
    case "AbortError":
      return "摄像头或麦克风正被其他应用占用，请关闭占用程序后重试。";
    case "NotSupportedError":
      return "当前浏览器无法访问摄像头，请使用桌面版 Chrome 或 Edge。";
    case "OverconstrainedError":
      return "当前摄像头无法提供合适的画面，请更换摄像头后重试。";
    default:
      return "无法启动摄像头与麦克风，请检查设备权限后重试。";
  }
}

async function startSession() {
  if (state.starting || state.live) return;

  hideSetupError();

  if (!window.isSecureContext) {
    showSetupError("请通过 HTTPS 或 localhost 打开本页，摄像头与语音识别才能工作。");
    return;
  }
  if (!RecognitionController.isSupported()) {
    showSetupError("当前浏览器不支持实时语音识别，请使用桌面版 Chrome 或 Edge。");
    return;
  }

  state.starting = true;
  hideHint();
  setStartBusy(true);
  showLoader("正在请求摄像头与麦克风…");
  setLoader(10, "");

  try {
    await openCamera();
    setLoader(28, "正在打开麦克风…");
    await startAudioGraph().catch((error) => {
      void error;
    });

    setLoader(44, "正在加载人脸追踪模型…");
    try {
      await loadTracker();
    } catch (error) {
      void error;
      state.trackerReady = false;
      state.tracker = null;
      setLoader(62, "人脸模型暂不可用，切换到底部字幕模式…");
      await delay(420);
    }

    setLoader(74, "正在准备实时字幕…");
    resetSession();
    closePanel();

    state.startedAt = performance.now();
    state.live = true;
    state.starting = false;
    state.speechIssue = null;

    document.body.classList.add("is-live");
    app.classList.add("is-live");

    try {
      await video.play();
    } catch (error) {
      void error;
    }

    startLoop();
    beginSpeech();
    setStartBusy(false);
    updateSpeechUI();
    updateDockSubtitle();
    setLoader(100, "字幕已就绪");
    hideLoader(100);
    scheduleHint();

    if (!state.trackerReady) {
      showToast("人脸追踪不可用，字幕将显示在画面底部。", { error: true, duration: 6000 });
    }
  } catch (error) {
    stopMedia();
    state.starting = false;
    state.live = false;
    state.tracker?.reset();
    setStartBusy(false);
    setLoaderFailure("准备失败");
    const message = friendlyMediaError(error);
    showSetupError(message);
    showToast(message, { error: true, duration: 6500 });
    document.body.classList.remove("is-live");
    app.classList.remove("is-live");
  }
}

function stopSession(manual = true) {
  if (!state.live && !state.starting) return;

  state.live = false;
  state.starting = false;
  window.cancelAnimationFrame(state.rafId);
  state.rafId = 0;

  try {
    state.speech?.stop();
  } catch (error) {
    void error;
  }

  state.tracker?.reset();
  state.faces.clear();
  state.speakers.clear();
  state.fallbackSpeaker = null;
  state.lastSpeaker = null;
  state.lastTextFaceId = null;
  state.lastTextAt = 0;
  state.activeFaceId = null;
  state.draft = { speakerKey: null, text: "" };
  state.speakerByKey.clear();
  state.faceCount = 0;

  for (const bubble of stage.querySelectorAll(".subtitle")) {
    bubble.classList.remove("is-visible");
  }

  stopMedia();
  hideHint();
  closePanel();
  document.body.classList.remove("is-live");
  app.classList.remove("is-live");
  liveChip.classList.remove("is-warn");
  liveText.textContent = "待机";
  state.speechIssue = null;

  if (manual) {
    if (state.transcript.length > 0) {
      showToast("字幕已结束，记录可在右上角导出。");
      startBtnText.textContent = "重新开始字幕";
    } else {
      showToast("字幕已结束。");
      startBtnText.textContent = "开启摄像头 · 开始字幕";
    }
    setStartBusy(false);
  }
}

function beginSpeech() {
  if (!RecognitionController.isSupported()) {
    state.speechIssue = "fatal";
    updateSpeechUI();
    return;
  }

  if (!state.speech) {
    state.speech = new RecognitionController({
      lang: state.lang,
      onResult: handleSpeechResult,
      onError: handleSpeechError,
      onStatus: handleSpeechStatus,
    });
  } else {
    state.speech.setLanguage(state.lang);
  }

  state.speech.start();
}

function handleSpeechStatus({ state: status }) {
  if (!state.live) return;

  if (status === "listening") {
    if (state.speechIssue === "network" || state.speechIssue === "audio-capture") {
      state.speechIssue = null;
    }
    updateSpeechUI();
  }
}

function handleSpeechError({ code, fatal }) {
  if (!state.live) return;

  if (code === "no-speech" || code === "aborted" || code === "unknown") {
    return;
  }

  if (fatal) {
    state.speechIssue = "fatal";
  } else if (code === "network") {
    state.speechIssue = "network";
  } else if (code === "audio-capture") {
    state.speechIssue = "audio-capture";
  } else if (code === "language-not-supported") {
    state.speechIssue = "language";
  }

  updateSpeechUI();

  const message = SPEECH_MESSAGES[code];
  const now = performance.now();
  const shouldNotify = fatal || now - state.lastSpeechToastAt > 9000;

  if (message && shouldNotify) {
    showToast(message, { error: true, duration: fatal ? 8000 : 5600 });
    state.lastSpeechToastAt = now;
  }
}

function handleSpeechResult(event) {
  if (!state.live) return;
  const now = performance.now();

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result || !result[0]) continue;
    const text = normalizeText(result[0].transcript);
    if (!text) continue;

    if (result.isFinal) {
      handleFinalText(text, now);
    } else {
      handleInterimText(text, now);
    }
  }
}

function handleInterimText(text, now) {
  const speaker = chooseSpeakerForText(now, false);
  const previousKey = state.draft.speakerKey;
  state.draft = { speakerKey: speaker.key, text };
  state.lastTextAt = now;
  state.lastSpeaker = speaker;

  if (speaker.faceId != null) {
    state.lastTextFaceId = speaker.faceId;
  }

  if (previousKey && previousKey !== speaker.key) {
    const previous = state.speakerByKey.get(previousKey);
    if (previous) renderSpeaker(previous, now);
  }

  renderSpeaker(speaker, now);
}

function handleFinalText(text, now) {
  if (!text) return;

  if (text === state.lastFinalText && now - state.lastFinalAt < 1600) {
    return;
  }
  state.lastFinalText = text;
  state.lastFinalAt = now;

  const speaker = chooseSpeakerForText(now, true);
  const previousKey = state.draft.speakerKey;
  state.draft = { speakerKey: speaker.key, text: "" };
  state.lastTextAt = now;
  state.lastSpeaker = speaker;

  if (speaker.faceId != null) {
    state.lastTextFaceId = speaker.faceId;
  }

  if (previousKey && previousKey !== speaker.key) {
    const previous = state.speakerByKey.get(previousKey);
    if (previous) renderSpeaker(previous, now);
  }

  const entry = speaker.entry;
  const latestEntry = state.transcript[state.transcript.length - 1];
  const canMerge =
    entry &&
    entry === latestEntry &&
    now - speaker.entryUpdatedAt < MERGE_WINDOW &&
    entry.text.length + text.length < MAX_ENTRY_LENGTH;

  if (canMerge) {
    entry.text = joinSpeechText(entry.text, text);
    entry.t1 = now - state.startedAt;
    entry.updatedAt = now;
    speaker.entryUpdatedAt = now;
    updateEntryDom(entry);
  } else {
    const created = createEntry(speaker, text, now);
    speaker.entry = created;
    speaker.entryUpdatedAt = now;
    pushTranscriptEntry(created);
    appendEntryDom(created);
  }

  renderSpeaker(speaker, now);
  scrollTranscriptToEnd();
}

function chooseSpeakerForText(now, preferDraft) {
  if (preferDraft) {
    const draftSpeaker = state.speakerByKey.get(state.draft.speakerKey);
    if (draftSpeaker && state.draft.text && now - state.lastTextAt < 2600) {
      if (draftSpeaker.faceId == null) return draftSpeaker;
      const face = state.faces.get(draftSpeaker.faceId);
      if (face && now - face.lastSeenAt < 2200) return draftSpeaker;
    }
  }

  return ensureSpeakerForFace(chooseFaceId(now));
}

function chooseFaceId(now) {
  const fresh = (id, maxAge) => {
    if (id == null) return null;
    const face = state.faces.get(id);
    return face && now - face.lastSeenAt < maxAge ? face : null;
  };

  const active = fresh(state.activeFaceId, 1700);
  if (active) return active.id;

  const previous = fresh(state.lastTextFaceId, 3400);
  if (previous && now - state.lastTextAt < 4000) return previous.id;

  let best = null;
  for (const face of state.faces.values()) {
    const stale = now - face.lastSeenAt;
    if (stale > 1600) continue;
    const score = face.rawScore || 0;
    if (!best || score > best.score) {
      best = { id: face.id, score };
    }
  }

  if (best && best.score > 0.035) return best.id;

  let recent = null;
  for (const face of state.faces.values()) {
    if (now - face.lastSeenAt > 3200) continue;
    if (!recent || face.lastSeenAt > recent.lastSeenAt) recent = face;
  }
  return recent ? recent.id : null;
}

function ensureSpeakerForFace(faceId) {
  if (faceId == null) {
    if (state.lastSpeaker) return state.lastSpeaker;
    if (!state.fallbackSpeaker) {
      state.fallbackSpeaker = createSpeaker(null);
    }
    return state.fallbackSpeaker;
  }

  const existing = state.speakers.get(faceId);
  if (existing) return existing;

  if (state.fallbackSpeaker) {
    const speaker = state.fallbackSpeaker;
    state.fallbackSpeaker = null;
    speaker.faceId = faceId;
    state.speakers.set(faceId, speaker);
    return speaker;
  }

  const speaker = createSpeaker(faceId);
  state.speakers.set(faceId, speaker);
  return speaker;
}

function createSpeaker(faceId) {
  const index = state.speakerSeq;
  state.speakerSeq += 1;
  const letter = LETTERS[index] || `X${index + 1}`;

  const speaker = {
    key: `speaker-${index}`,
    faceId,
    name: `发言人${letter}`,
    color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
    entry: null,
    entryUpdatedAt: 0,
    el: null,
    nameEl: null,
    textEl: null,
    bubbleW: 0,
    bubbleH: 0,
    x: 0,
    y: 0,
    hasPosition: false,
    z: 0,
    updatedAt: 0,
  };

  state.speakerByKey.set(speaker.key, speaker);
  return speaker;
}

function ensureBubble(speaker) {
  if (speaker.el) return;

  const element = document.createElement("div");
  element.className = "subtitle";
  element.style.setProperty("--speaker", speaker.color);

  const name = document.createElement("div");
  name.className = "subtitle-name";
  name.textContent = speaker.name;

  const text = document.createElement("div");
  text.className = "subtitle-text";
  text.dir = "auto";

  element.append(name, text);
  stage.append(element);

  speaker.el = element;
  speaker.nameEl = name;
  speaker.textEl = text;
}

function renderSpeaker(speaker, now = performance.now()) {
  ensureBubble(speaker);

  const hasDraft = state.draft.speakerKey === speaker.key && Boolean(state.draft.text);
  const finalSource = speaker.entry ? speaker.entry.text : "";
  const finalText = finalSource
    ? truncateTail(finalSource, FINAL_TAIL[state.lang] || FINAL_TAIL["zh-CN"])
    : "";
  const draftText = hasDraft
    ? truncateTail(state.draft.text, DRAFT_TAIL[state.lang] || DRAFT_TAIL["zh-CN"])
    : "";

  if (!finalText && !draftText) {
    hideSpeaker(speaker);
    return;
  }

  const wasHidden = !speaker.el.classList.contains("is-visible");
  if (wasHidden) speaker.hasPosition = false;

  speaker.textEl.replaceChildren();

  if (finalText) {
    const finalSpan = document.createElement("span");
    finalSpan.className = "final";
    finalSpan.textContent = finalText;
    speaker.textEl.append(finalSpan);
  }

  if (draftText) {
    const interimSpan = document.createElement("span");
    interimSpan.className = "interim";
    interimSpan.textContent = draftText;
    speaker.textEl.append(interimSpan);

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.setAttribute("aria-hidden", "true");
    speaker.textEl.append(caret);
  }

  speaker.updatedAt = now;
  speaker.bubbleW = speaker.el.offsetWidth;
  speaker.bubbleH = speaker.el.offsetHeight;
  speaker.z = ++state.bubbleZ;
  speaker.el.style.zIndex = String(speaker.z);

  hideHint();
  positionSpeaker(speaker, now);
  speaker.el.classList.add("is-visible");
}

function positionSpeaker(speaker, now, snap = false) {
  const target = computeBubbleTarget(speaker);
  if (!target) {
    hideSpeaker(speaker);
    return;
  }

  if (!speaker.hasPosition || snap) {
    speaker.x = target.x;
    speaker.y = target.y;
    speaker.hasPosition = true;
  } else {
    const factor = 0.27;
    speaker.x += (target.x - speaker.x) * factor;
    speaker.y += (target.y - speaker.y) * factor;
  }

  speaker.el.style.transform = `translate3d(${speaker.x}px, ${speaker.y}px, 0) translateX(-50%)`;
}

function computeBubbleTarget(speaker) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const bubbleWidth = Math.max(1, speaker.bubbleW || speaker.el?.offsetWidth || 220);
  const bubbleHeight = Math.max(1, speaker.bubbleH || speaker.el?.offsetHeight || 64);
  const topLimit = 84;
  const bottomSafe = width <= 720 ? 86 : 110;
  const maxTop = Math.max(topLimit, height - bottomSafe - bubbleHeight);

  const track =
    speaker.faceId != null && state.tracker ? state.tracker.getTrack(speaker.faceId) : null;
  const faceFresh = track && performance.now() - track.lastSeen < 2500;

  if (!faceFresh) {
    speaker.el?.classList.add("is-detached");
    const minX = Math.min(bubbleWidth / 2 + 14, width / 2);
    const maxX = Math.max(width - bubbleWidth / 2 - 14, width / 2);
    return {
      x: clamp(width / 2, minX, maxX),
      y: clamp(height - bottomSafe - bubbleHeight, topLimit, maxTop),
    };
  }

  speaker.el?.classList.remove("is-detached");
  const neck = mapPoint(track.neck.x, track.neck.y);
  const faceBox = mapBox(track.box);
  let x = clamp(
    neck.x,
    Math.min(bubbleWidth / 2 + 14, width / 2),
    Math.max(width - bubbleWidth / 2 - 14, width / 2),
  );
  let y = neck.y + 8;

  if (y + bubbleHeight > height - bottomSafe) {
    const rightX = faceBox.x + faceBox.w + 18 + bubbleWidth / 2;
    const leftX = faceBox.x - 18 - bubbleWidth / 2;
    const canRight = rightX + bubbleWidth / 2 <= width - 14;
    const canLeft = leftX - bubbleWidth / 2 >= 14;

    if (canRight || canLeft) {
      x = canRight ? rightX : leftX;
      y = faceBox.y + faceBox.h * 0.5 - bubbleHeight * 0.5;
    } else {
      y = height - bottomSafe - bubbleHeight;
    }
  }

  x = clamp(
    x,
    Math.min(bubbleWidth / 2 + 14, width / 2),
    Math.max(width - bubbleWidth / 2 - 14, width / 2),
  );
  y = clamp(y, topLimit, maxTop);

  return { x, y };
}

function mapPoint(nx, ny) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const videoWidth = video.videoWidth || 16;
  const videoHeight = video.videoHeight || 9;
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;
  let x = offsetX + nx * drawWidth;
  if (state.mirror) x = width - x;
  return { x, y: offsetY + ny * drawHeight };
}

function mapBox(box) {
  const a = mapPoint(box.x, box.y);
  const b = mapPoint(box.x + box.w, box.y + box.h);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function hideSpeaker(speaker) {
  if (speaker.el) {
    speaker.el.classList.remove("is-visible");
  }
  speaker.hasPosition = false;
}

function updateBubbles(now) {
  for (const speaker of state.speakerByKey.values()) {
    if (!speaker.el) continue;

    const hasDraft = state.draft.speakerKey === speaker.key && Boolean(state.draft.text);
    const hasEntry = Boolean(speaker.entry);

    if (!hasDraft && !hasEntry) {
      hideSpeaker(speaker);
      continue;
    }

    const age = now - speaker.updatedAt;
    if (!hasDraft && age > BUBBLE_LIFETIME) {
      hideSpeaker(speaker);
      continue;
    }
    if (hasDraft && age > DRAFT_LIFETIME) {
      hideSpeaker(speaker);
      continue;
    }

    let track = null;
    if (speaker.faceId != null && state.tracker) {
      track = state.tracker.getTrack(speaker.faceId);
    }
    const faceFresh = track && now - track.lastSeen < 2500;

    if (speaker.faceId != null && !faceFresh && !hasDraft && age > 2200) {
      hideSpeaker(speaker);
      continue;
    }

    positionSpeaker(speaker, now);
  }
}

function createEntry(speaker, text, now) {
  state.entrySeq += 1;
  return {
    id: state.entrySeq,
    speakerKey: speaker.key,
    speakerName: speaker.name,
    color: speaker.color,
    text,
    t0: Math.max(0, now - state.startedAt),
    t1: Math.max(0, now - state.startedAt),
    updatedAt: now,
    el: null,
    elText: null,
    elTime: null,
  };
}

function appendEntryDom(entry) {
  const item = document.createElement("li");
  item.className = "entry";
  item.style.setProperty("--speaker", entry.color);

  const top = document.createElement("div");
  top.className = "entry-top";

  const speaker = document.createElement("span");
  speaker.className = "entry-speaker";
  speaker.textContent = entry.speakerName;

  const time = document.createElement("span");
  time.className = "entry-time";
  time.textContent = formatClock(entry.t0);

  const text = document.createElement("p");
  text.dir = "auto";
  text.textContent = entry.text;

  top.append(speaker, time);
  item.append(top, text);
  entryList.append(item);

  entry.el = item;
  entry.elText = text;
  entry.elTime = time;
}

function updateEntryDom(entry) {
  if (!entry.el) return;
  entry.elText.textContent = entry.text;
  entry.elTime.textContent = formatClock(entry.t0);
}

function updateTranscriptCount() {
  const count = state.transcript.length;
  panelCount.textContent = `${count} 条`;
  panelEmpty.hidden = count > 0;
  panelBadge.hidden = count === 0;
  panelBadge.textContent = count > 99 ? "99+" : String(count);
}

function pushTranscriptEntry(entry) {
  state.transcript.push(entry);
  updateTranscriptCount();
}

function scrollTranscriptToEnd(force = false) {
  if (!state.panelOpen) return;
  if (!force && !state.autoScroll) return;
  window.requestAnimationFrame(() => {
    panelBody.scrollTop = panelBody.scrollHeight;
  });
}

function openPanel() {
  state.panelOpen = true;
  state.autoScroll = true;
  panel.classList.add("is-open");
  panelScrim.classList.add("is-visible");
  panel.setAttribute("aria-hidden", "false");
  panelScrim.setAttribute("aria-hidden", "false");
  panelBtn.setAttribute("aria-expanded", "true");
  dockPanelBtn.setAttribute("aria-expanded", "true");
  scrollTranscriptToEnd(true);
}

function closePanel() {
  state.panelOpen = false;
  panel.classList.remove("is-open");
  panelScrim.classList.remove("is-visible");
  panel.setAttribute("aria-hidden", "true");
  panelScrim.setAttribute("aria-hidden", "true");
  panelBtn.setAttribute("aria-expanded", "false");
  dockPanelBtn.setAttribute("aria-expanded", "false");
}

function buildPlainText() {
  return state.transcript
    .map((entry) => `[${formatClock(entry.t0)}] ${entry.speakerName}：${entry.text}`)
    .join("\n");
}

function buildSrt() {
  return state.transcript
    .map((entry, index) => {
      const start = entry.t0;
      const end = Math.max(entry.t1 + 700, entry.t0 + 1100);
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${
        entry.speakerName
      }：${entry.text}\n`;
    })
    .join("\n");
}

async function copyTranscript() {
  if (state.transcript.length === 0) {
    showToast("还没有字幕可以复制。");
    return;
  }

  const text = buildPlainText();

  try {
    await navigator.clipboard.writeText(text);
    showToast("字幕记录已复制。");
  } catch (error) {
    void error;
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      document.execCommand("copy");
      showToast("字幕记录已复制。");
    } catch (copyError) {
      void copyError;
      showToast("复制失败，请手动选择文本。", { error: true });
    }
    area.remove();
  }
}

function downloadSrt() {
  if (state.transcript.length === 0) {
    showToast("还没有字幕可以导出。");
    return;
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  const blob = new Blob([buildSrt()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `necktalk-${stamp}.srt`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  showToast("SRT 字幕已导出。");
}

function clearTranscript() {
  if (state.transcript.length === 0) {
    showToast("当前没有字幕记录。");
    return;
  }
  if (!window.confirm("清空本次字幕记录？")) return;

  state.transcript = [];
  state.entrySeq = 0;
  state.draft = { speakerKey: null, text: "" };
  state.lastFinalText = "";

  for (const speaker of state.speakerByKey.values()) {
    speaker.entry = null;
    hideSpeaker(speaker);
  }

  entryList.replaceChildren();
  updateTranscriptCount();
  showToast("字幕记录已清空。");
}

function readAudio(now) {
  if (!state.analyser || !state.audioData) return;

  state.analyser.getFloatTimeDomainData(state.audioData);
  let sum = 0;
  for (let index = 0; index < state.audioData.length; index += 1) {
    const sample = state.audioData[index];
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / state.audioData.length);
  const loud = Math.min(1, rms * 7.5);
  state.audioLevel += (loud - state.audioLevel) * 0.3;

  if (loud < 0.13) {
    state.noiseFloor += (loud - state.noiseFloor) * 0.002;
  }

  const threshold = Math.max(0.052, state.noiseFloor * 2.2);
  const wasActive = state.audioActive;
  state.audioActive = state.audioLevel > threshold;
  if (state.audioActive) {
    state.lastSoundAt = now;
    if (!wasActive) state.soundRestartedAt = now;
  }

  if (now - state.eqUpdatedAt > 55) {
    state.eqUpdatedAt = now;
    const visual = Math.min(1, state.audioLevel * 1.8 + 0.04);
    eq.style.setProperty("--level", visual.toFixed(2));
    eq.classList.toggle("is-quiet", !state.audioActive);
  }
}

function detectFaces(now) {
  if (!state.trackerReady || !state.tracker) {
    refreshFaceCount();
    return;
  }

  let detections = [];
  try {
    detections = state.tracker.detect(video, now);
  } catch (error) {
    void error;
  }

  for (const detection of detections) {
    let face = state.faces.get(detection.id);
    if (!face) {
      face = {
        id: detection.id,
        jawFast: detection.jaw,
        jawSlow: detection.jaw,
        lastMouthAt: now,
        lastSeenAt: now,
        energy: 0,
        corr: 0,
        rawScore: 0,
        score: 0,
        samples: [],
      };
      state.faces.set(detection.id, face);
    }

    updateMouth(face, detection.jaw, now);
  }

  for (const [id, face] of state.faces) {
    if (now - face.lastSeenAt > 12000) {
      state.faces.delete(id);
    }
  }

  refreshFaceCount();
}

function updateMouth(face, jaw, now) {
  const delta = clamp(now - face.lastMouthAt, 16, 280);
  face.lastMouthAt = now;
  face.lastSeenAt = now;

  face.jawFast += (jaw - face.jawFast) * 0.52;
  const slowFactor = clamp(delta / 1500, 0.01, 0.22);
  face.jawSlow += (jaw - face.jawSlow) * slowFactor;

  const rise = Math.max(0, face.jawFast - face.jawSlow - 0.012);
  face.energy = clamp(0, 1, Math.max(face.energy * Math.exp(-delta / 820), rise * 2.7));

  face.samples.push({ audio: state.audioLevel, jaw });
  if (face.samples.length > 32) face.samples.shift();
  face.corr = audioMouthCorrelation(face.samples);
  face.rawScore = clamp(0, 1, face.energy * (0.4 + 0.6 * Math.max(0, face.corr)));
  face.score = face.rawScore;
}

function audioMouthCorrelation(samples) {
  const count = samples.length;
  if (count < 12) return 0;

  let best = 0;

  for (let lag = 0; lag <= 3; lag += 1) {
    const n = count - lag;
    if (n < 9) continue;

    let sumA = 0;
    let sumJ = 0;
    let sumAA = 0;
    let sumJJ = 0;
    let sumAJ = 0;

    for (let index = lag; index < count; index += 1) {
      const a = samples[index].audio;
      const j = samples[index - lag].jaw;
      sumA += a;
      sumJ += j;
      sumAA += a * a;
      sumJJ += j * j;
      sumAJ += a * j;
    }

    const meanA = sumA / n;
    const meanJ = sumJ / n;
    const varianceA = sumAA / n - meanA * meanA;
    const varianceJ = sumJJ / n - meanJ * meanJ;

    if (varianceA < 0.00001 || varianceJ < 0.00001) continue;

    const covariance = sumAJ / n - meanA * meanJ;
    const correlation = covariance / Math.sqrt(varianceA * varianceJ);
    if (correlation > best) best = correlation;
  }

  return clamp(0, 1, best);
}

function updateActiveSpeaker(now) {
  let best = null;

  for (const face of state.faces.values()) {
    const stale = now - face.lastSeenAt;
    face.score = stale < 1400 ? (face.rawScore || 0) * (1 - stale / 1400) : 0;
    if (!best || face.score > best.score) best = face;
  }

  const recentAudio = state.audioActive || now - state.lastSoundAt < 600;
  const justStarted = now - state.soundRestartedAt < 600;

  if (recentAudio && best && best.score > 0.075) {
    const active = state.faces.get(state.activeFaceId);
    if (!active) {
      state.activeFaceId = best.id;
    } else if (active.id !== best.id) {
      const activeScore = active.score || 0;
      if (justStarted || best.score > activeScore * 1.28 + 0.03) {
        state.activeFaceId = best.id;
      }
    }
  }

  if (state.activeFaceId != null) {
    const active = state.faces.get(state.activeFaceId);
    if (!active || now - active.lastSeenAt > 2200) {
      state.activeFaceId = null;
    }
  }
}

function refreshFaceCount() {
  const count =
    state.trackerReady && state.tracker ? state.tracker.visibleTracks(1000).length : 0;
  if (count !== state.faceCount) {
    state.faceCount = count;
    updateDockSubtitle();
  }
}

function updateSpeechUI() {
  if (!state.live) {
    liveChip.classList.remove("is-warn");
    liveText.textContent = "待机";
    return;
  }

  let label = "实时识别";
  let warn = false;
  let title = "正在聆听";

  if (state.speechIssue === "fatal") {
    label = "语音不可用";
    warn = true;
    title = "语音识别不可用";
  } else if (state.speechIssue === "network") {
    label = "连接重试中";
    warn = true;
    title = "正在重试识别";
  } else if (state.speechIssue === "audio-capture") {
    label = "麦克风中断";
    warn = true;
    title = "正在重连麦克风";
  } else if (state.speechIssue === "language") {
    label = "语言不可用";
    warn = true;
    title = "当前语言不可用";
  }

  liveText.textContent = label;
  liveChip.classList.toggle("is-warn", warn);
  dockTitle.textContent = title;
  updateDockSubtitle();
}

function updateDockSubtitle() {
  if (!state.live) return;

  const language = LANGUAGES[state.lang].name;
  let detail = "";

  if (state.speechIssue === "fatal") {
    detail = "请使用桌面版 Chrome / Edge 并检查网络";
  } else if (state.speechIssue === "network") {
    detail = "语音服务连接中断 · 自动重试";
  } else if (state.speechIssue === "audio-capture") {
    detail = "麦克风连接中断";
  } else if (state.speechIssue === "language") {
    detail = "请切换识别语言";
  } else if (!state.trackerReady) {
    detail = "人脸追踪不可用 · 字幕显示在底部";
  } else if (state.faceCount > 0) {
    detail = `${state.faceCount} 位人物 · 字幕跟随颈部`;
  } else {
    detail = "未检测到人脸 · 字幕移到画面底部";
  }

  dockSub.textContent = `${language} 识别 · ${detail}`;
}

function loop() {
  if (!state.live) return;

  const now = performance.now();
  readAudio(now);

  if (state.trackerReady && now - state.lastDetectAt > DETECT_INTERVAL) {
    state.lastDetectAt = now;
    detectFaces(now);
  } else {
    refreshFaceCount();
  }

  updateActiveSpeaker(now);
  updateBubbles(now);

  state.rafId = window.requestAnimationFrame(loop);
}

function startLoop() {
  window.cancelAnimationFrame(state.rafId);
  state.lastDetectAt = 0;
  state.eqUpdatedAt = 0;
  state.rafId = window.requestAnimationFrame(loop);
}

function bindEvents() {
  startBtn.addEventListener("click", startSession);
  stopBtn.addEventListener("click", () => stopSession(true));

  langButtons.forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.lang));
  });

  mirrorBtn.addEventListener("click", toggleMirror);
  panelBtn.addEventListener("click", openPanel);
  dockPanelBtn.addEventListener("click", openPanel);
  panelClose.addEventListener("click", closePanel);
  panelScrim.addEventListener("click", closePanel);

  copyBtn.addEventListener("click", copyTranscript);
  exportBtn.addEventListener("click", downloadSrt);
  clearBtn.addEventListener("click", clearTranscript);

  hintClose.addEventListener("click", hideHint);

  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await app.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      void error;
      showToast("当前环境无法进入全屏。", { error: true });
    }
  });

  document.addEventListener("fullscreenchange", () => {
    fullscreenBtn.classList.toggle("is-active", Boolean(document.fullscreenElement));
  });

  panelBody.addEventListener("scroll", () => {
    const remaining = panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight;
    state.autoScroll = remaining < 70;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.panelOpen) {
        closePanel();
      } else {
        hideHint();
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      state.lastDetectAt = 0;
    }
  });

  window.addEventListener("pagehide", cleanupForExit);
  window.addEventListener("beforeunload", cleanupForExit);
}

function init() {
  applyPreferences();
  resetSession();
  preflight();
  updateSpeechUI();
  bindEvents();

  if (state.transcript.length === 0) {
    panelEmpty.hidden = false;
  }
}

init();
