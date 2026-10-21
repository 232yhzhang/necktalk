const TARGET_RATE = 16000;
const BLOCK_SIZE = 4096;
const PRE_ROLL_SECONDS = 0.35;
const MIN_SPEECH_SECONDS = 0.35;
const SILENCE_END_SECONDS = 0.55;
const MAX_UTTERANCE_SECONDS = 6;

function rmsOf(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function concatSamples(chunks) {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resample(samples, sourceRate, targetRate = TARGET_RATE) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function encodeWav(samples, sampleRate = TARGET_RATE) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class CloudSpeechRecognizer {
  constructor({
    audioContext,
    sourceNode,
    transcribeAudio,
    onResult,
    onStatus,
    onError,
    getSpeaker,
  }) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.transcribeAudio = transcribeAudio;
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.onError = onError;
    this.getSpeaker = getSpeaker;
    this.sampleRate = audioContext.sampleRate;
    this.processor = null;
    this.silentGain = null;
    this.running = false;
    this.loudFrames = 0;
    this.speechActive = false;
    this.silenceSamples = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
    this.preRoll = [];
    this.preRollSamples = 0;
    this.noiseFloor = 0.006;
    this.speakerFaceId = null;
    this.queue = [];
    this.uploading = false;
    this.currentController = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const processor = this.audioContext.createScriptProcessor(BLOCK_SIZE, 1, 1);
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      this.handleAudio(event.inputBuffer.getChannelData(0));
    };
    this.sourceNode.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
    this.processor = processor;
    this.silentGain = silentGain;
    this.onStatus({ state: "listening" });
  }

  stop() {
    this.running = false;
    if (this.currentController) {
      try {
        this.currentController.abort();
      } catch (error) {
        void error;
      }
      this.currentController = null;
    }
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (error) {
        void error;
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch (error) {
        void error;
      }
      this.silentGain = null;
    }
    this.resetUtterance();
    this.queue = [];
    this.preRoll = [];
    this.preRollSamples = 0;
    this.onStatus({ state: "stopped" });
  }

  handleAudio(input) {
    if (!this.running) return;
    const block = new Float32Array(input);
    const rms = rmsOf(block);
    const threshold = Math.max(0.007, this.noiseFloor * 2.25);
    const loud = rms > threshold;

    if (!loud) {
      this.noiseFloor += (rms - this.noiseFloor) * 0.003;
    }

    if (!this.speechActive) {
      this.pushPreRoll(block);
      if (loud) {
        this.loudFrames += 1;
        if (this.loudFrames >= 2) {
          this.speechActive = true;
          this.silenceSamples = 0;
          this.loudFrames = 0;
          this.utterance = this.preRoll.slice();
          this.utteranceSamples = this.preRollSamples;
          this.preRoll = [];
          this.preRollSamples = 0;
          const speaker = this.getSpeaker ? this.getSpeaker() : null;
          this.speakerFaceId = speaker;
          this.onStatus({ state: "speech" });
        }
      } else {
        this.loudFrames = 0;
      }
      return;
    }

    this.utterance.push(block);
    this.utteranceSamples += block.length;

    if (loud) {
      this.silenceSamples = 0;
      const speaker = this.getSpeaker ? this.getSpeaker() : null;
      if (speaker != null) this.speakerFaceId = speaker;
    } else {
      this.silenceSamples += block.length;
      if (
        this.utteranceSamples > this.sampleRate * MIN_SPEECH_SECONDS &&
        this.silenceSamples >= this.sampleRate * SILENCE_END_SECONDS
      ) {
        this.finalizeUtterance();
        return;
      }
    }

    if (this.utteranceSamples >= this.sampleRate * MAX_UTTERANCE_SECONDS) {
      this.finalizeUtterance();
    }
  }

  pushPreRoll(block) {
    this.preRoll.push(block);
    this.preRollSamples += block.length;
    const maxSamples = this.sampleRate * PRE_ROLL_SECONDS;
    while (this.preRollSamples > maxSamples && this.preRoll.length > 1) {
      const removed = this.preRoll.shift();
      this.preRollSamples -= removed.length;
    }
  }

  finalizeUtterance() {
    if (this.utteranceSamples < this.sampleRate * MIN_SPEECH_SECONDS) {
      this.resetUtterance();
      return;
    }

    const merged = concatSamples(this.utterance);
    const keepTrailing = Math.floor(this.sampleRate * 0.2);
    const trim = Math.max(0, this.silenceSamples - keepTrailing);
    const audio = trim > 0 ? merged.subarray(0, Math.max(0, merged.length - trim)) : merged;
    const speakerFaceId = this.speakerFaceId;

    this.resetUtterance();
    this.onStatus({ state: "transcribing" });

    const resampled = resample(audio, this.sampleRate, TARGET_RATE);
    const wav = encodeWav(resampled);
    this.queue.push({ wav, speakerFaceId });
    this.processQueue();
  }

  resetUtterance() {
    this.speechActive = false;
    this.silenceSamples = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
    this.loudFrames = 0;
    this.speakerFaceId = null;
  }

  async processQueue() {
    if (this.uploading) return;
    this.uploading = true;

    while (this.queue.length > 0) {
      if (!this.running) break;
      const item = this.queue.shift();
      try {
        const result = await this.transcribe(item);
        if (this.running && result) {
          this.onResult(result);
        }
      } catch (error) {
        if (this.running) {
          this.onError(error);
        }
      }
    }

    this.uploading = false;
    if (this.running) {
      this.onStatus({ state: "listening" });
    }
  }

  async transcribe(item) {
    const blob = new Blob([item.wav], { type: "audio/wav" });
    const controller = new AbortController();
    this.currentController = controller;
    const timer = window.setTimeout(() => controller.abort(), 20000);

    try {
      const data = await this.transcribeAudio(blob, controller.signal);
      const text = String(data?.text || "").trim();
      if (!text) throw new Error("没有识别到语音");
      return {
        text,
        language: String(data?.language || ""),
        speakerFaceId: item.speakerFaceId,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("语音识别请求超时");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
      if (this.currentController === controller) {
        this.currentController = null;
      }
    }
  }
}
