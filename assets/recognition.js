export class RecognitionController {
  constructor({ onResult, onError, onStatus, lang = "zh-CN" }) {
    this.onResult = onResult;
    this.onError = onError;
    this.onStatus = onStatus;
    this.lang = lang;
    this.instance = null;
    this.wanted = false;
    this.timer = 0;
    this.nextDelay = null;
    this.Constructor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  static isSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start() {
    if (!this.Constructor) {
      this.onError({ code: "unsupported", fatal: true });
      return;
    }
    this.wanted = true;
    this.spawn();
  }

  stop() {
    this.wanted = false;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.nextDelay = null;

    const instance = this.instance;
    this.instance = null;

    if (instance) {
      try {
        instance.abort();
      } catch (error) {
        void error;
      }
    }

    this.onStatus({ state: "stopped" });
  }

  setLanguage(lang) {
    if (!lang || lang === this.lang) return;
    this.lang = lang;
    if (!this.wanted) return;

    window.clearTimeout(this.timer);
    this.nextDelay = 0;
    if (this.instance) {
      const instance = this.instance;
      this.instance = null;
      try {
        instance.abort();
      } catch (error) {
        void error;
      }
      this.schedule(220);
    } else {
      this.schedule(220);
    }
  }

  restart() {
    if (!this.wanted) return;
    window.clearTimeout(this.timer);
    if (this.instance) {
      const instance = this.instance;
      this.instance = null;
      try {
        instance.abort();
      } catch (error) {
        void error;
      }
    }
    this.schedule(120);
  }

  schedule(delay) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.spawn();
    }, delay);
  }

  spawn() {
    if (!this.wanted || !this.Constructor) return;
    if (this.instance) return;

    const recognition = new this.Constructor();
    this.instance = recognition;
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (this.instance !== recognition) return;
      this.onStatus({ state: "listening" });
    };

    recognition.onresult = (event) => {
      if (this.instance !== recognition) return;
      this.onResult(event);
    };

    recognition.onerror = (event) => {
      if (this.instance !== recognition) return;
      const code = event.error || "unknown";
      const fatal = code === "not-allowed" || code === "service-not-allowed";

      if (fatal) {
        this.wanted = false;
      } else if (code === "network") {
        this.nextDelay = 2500;
      } else if (code === "audio-capture") {
        this.nextDelay = 1400;
      } else if (code === "language-not-supported") {
        this.wanted = false;
        this.nextDelay = null;
      } else {
        this.nextDelay = 380;
      }

      this.onError({ code, fatal });
      this.onStatus({ state: "error", code });
    };

    recognition.onend = () => {
      if (this.instance !== recognition) return;
      this.instance = null;
      const delay = this.nextDelay ?? 320;
      this.nextDelay = null;

      if (this.wanted) {
        this.onStatus({ state: "restarting" });
        this.schedule(Math.max(0, delay));
      } else {
        this.onStatus({ state: "stopped" });
      }
    };

    try {
      recognition.start();
    } catch (error) {
      void error;
      this.instance = null;
      if (this.wanted) {
        this.schedule(600);
      }
    }
  }
}
