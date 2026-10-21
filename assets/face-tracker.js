import { FaceLandmarker, FilesetResolver } from "./vendor/vision_bundle.mjs";

const WASM_PATH = new URL("./vendor/wasm", import.meta.url).href;
const MODEL_PATH = new URL("./vendor/face_landmarker.task", import.meta.url).href;

const CHIN_INDEX = 152;
const FOREHEAD_INDEX = 10;

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.tracks = new Map();
    this.nextId = 1;
    this.lastTimestamp = 0;
    this.delegate = "";
    this.faceLimit = 4;
    this.maxTrackAge = 20000;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      runningMode: "VIDEO",
      numFaces: this.faceLimit,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    };

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: "GPU",
        },
      });
      this.delegate = "GPU";
    } catch (error) {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: "CPU",
        },
      });
      this.delegate = "CPU";
    }
  }

  detect(video, timestamp) {
    if (!this.landmarker || video.readyState < 2 || !video.videoWidth) {
      return [];
    }

    const safeTimestamp = Math.max(this.lastTimestamp + 1, Math.round(timestamp));
    this.lastTimestamp = safeTimestamp;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, safeTimestamp);
    } catch (error) {
      return [];
    }

    const landmarks = result.faceLandmarks || [];
    const blendshapes = result.faceBlendshapes || [];
    const now = performance.now();
    const detections = landmarks.map((points, index) => {
      const box = this.boundsOf(points);
      const chin = points[CHIN_INDEX];
      const forehead = points[FOREHEAD_INDEX];
      const faceHeight = Math.max(0.001, Math.abs(chin.y - forehead.y));
      const jawOpen = this.jawValue(blendshapes[index]);

      return {
        box,
        center: {
          x: (box.x + box.w / 2),
          y: (box.y + box.h / 2),
        },
        neck: {
          x: box.x + box.w / 2,
          y: Math.min(0.99, chin.y + faceHeight * 0.3),
        },
        jaw: jawOpen,
      };
    });

    const available = [...this.tracks.values()].filter((track) => now - track.lastSeen < 5000);
    const claimed = new Set();
    const seenIds = new Set();

    const soleTrack =
      detections.length === 1 &&
      available.length === 1 &&
      now - available[0].lastSeen < 1600;

    for (const detection of detections) {
      let match = null;
      let bestDistance = soleTrack ? Number.POSITIVE_INFINITY : 0.2 * 0.2;

      for (const track of available) {
        if (claimed.has(track.id)) continue;
        const dx = track.center.x - detection.center.x;
        const dy = track.center.y - detection.center.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          match = track;
        }
      }

      if (!match) {
        match = {
          id: this.nextId++,
          center: { ...detection.center },
          neck: { ...detection.neck },
          box: { ...detection.box },
          jaw: detection.jaw,
          lastSeen: now,
          appeared: now,
        };
        this.tracks.set(match.id, match);
      }

      claimed.add(match.id);
      seenIds.add(match.id);

      const smooth = 0.8;
      match.center.x += (detection.center.x - match.center.x) * smooth;
      match.center.y += (detection.center.y - match.center.y) * smooth;
      match.neck.x += (detection.neck.x - match.neck.x) * smooth;
      match.neck.y += (detection.neck.y - match.neck.y) * smooth;
      match.box.x += (detection.box.x - match.box.x) * 0.6;
      match.box.y += (detection.box.y - match.box.y) * 0.6;
      match.box.w += (detection.box.w - match.box.w) * 0.6;
      match.box.h += (detection.box.h - match.box.h) * 0.6;
      match.jaw = detection.jaw;
      match.lastSeen = now;
    }

    for (const [id, track] of this.tracks) {
      if (now - track.lastSeen > this.maxTrackAge) {
        this.tracks.delete(id);
      }
    }

    return [...seenIds].map((id) => {
      const track = this.tracks.get(id);
      return {
        id,
        neck: { ...track.neck },
        box: { ...track.box },
        center: { ...track.center },
        jaw: track.jaw,
        lastSeen: track.lastSeen,
      };
    });
  }

  getTrack(id) {
    return this.tracks.get(id) || null;
  }

  visibleTracks(maxAge = 800) {
    const now = performance.now();
    return [...this.tracks.values()].filter((track) => now - track.lastSeen < maxAge);
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
    this.lastTimestamp = 0;
  }

  async close() {
    this.reset();
    if (this.landmarker) {
      await this.landmarker.close();
      this.landmarker = null;
    }
  }

  boundsOf(points) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    return {
      x: minX,
      y: minY,
      w: Math.max(0.001, maxX - minX),
      h: Math.max(0.001, maxY - minY),
    };
  }

  jawValue(blendshapes) {
    if (!blendshapes || !blendshapes.categories) return 0;
    const entry = blendshapes.categories.find((item) => item.categoryName === "jawOpen");
    return entry ? entry.score : 0;
  }
}
