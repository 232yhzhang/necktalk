# Third-Party Notices

## MediaPipe Tasks Vision

This project vendors the following MediaPipe assets:

- `assets/vendor/vision_bundle.mjs`
- `assets/vendor/wasm/vision_wasm_internal.js`
- `assets/vendor/wasm/vision_wasm_internal.wasm`
- `assets/vendor/wasm/vision_wasm_nosimd_internal.js`
- `assets/vendor/wasm/vision_wasm_nosimd_internal.wasm`
- `assets/vendor/face_landmarker.task`

Source: <https://github.com/google-ai-edge/mediapipe>

Copyright 2023 The MediaPipe Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at:

<https://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Mozhi and DeepL

When the browser's built-in Translator API is unavailable, this project calls
DeepL through the community Mozhi instance at
<https://mozhi.pussthecat.org/>. Mozhi is an open-source translation front-end:
<https://github.com/aryak/mozhi>. The instance is a public third-party service
and is not operated by this project.

- DeepL: <https://www.deepl.com/>
- Mozhi: <https://github.com/aryak/mozhi>
- Recognized text is sent to the Mozhi instance and forwarded to DeepL for
  translation. Usage is subject to those services' terms and availability.

## MyMemory Translation API

If the DeepL/Mozhi route is unavailable, this project falls back to the free
MyMemory translation API.

- Service: MyMemory — <https://mymemory.translated.net/>
- API documentation: <https://mymemory.translated.net/doc/spec.php>
- Usage is subject to MyMemory's terms and quota limits. Recognized text is sent
  to the service to be translated.

## Web Speech API

Speech recognition is delegated to the browser's built-in Web Speech API.
No speech service is bundled with this project.

## Chromium Translator API

If the browser exposes an available built-in `Translator` language pack, the
project uses it for local translation. The language pack is provided by the
browser and is not bundled with this project.
