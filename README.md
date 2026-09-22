# SmartVision Mobile
### React Native / Expo rebuild of the Raspberry Pi SmartVision Assistant

AI-powered navigation and reading assistant for blind and low-vision users —
now running entirely on a phone. No GPIO, no soldering, no external sensors:
the phone's camera, speaker/haptics, and accelerometer replace the Pi 3B,
HC-SR04 ultrasonic sensor, and three tactile buttons from the original build.

| | |
|---|---|
| **Platform** | iOS / Android via Expo (development build, not Expo Go) |
| **Detection model** | YOLOv8 → TFLite, 9 classes, 320×320 input |
| **Inference** | `react-native-fast-tflite` on-device, via Vision Camera frame processor |
| **OCR** | `@react-native-ml-kit/text-recognition` (on-device, no Tesseract/OpenCV) |
| **TTS** | `expo-speech` |
| **Haptics** | `expo-haptics`, direction-coded |
| **Connectivity** | 100% offline — no cloud, no internet required after install |

---

## 1. What changed from the Pi build

The Pi version leaned on physical hardware (GPIO buttons, an HC-SR04
ultrasonic sensor, a dedicated CSI camera, a wired earphone on ALSA card 1)
and a fully custom Python stack (NCNN, Tesseract, espeak-ng, RPi.GPIO). None
of that exists on a phone, so every module was re-architected around what a
phone already gives you for free: a touchscreen, a high-quality camera, a
built-in speaker/haptics engine, and an accelerometer.

| Concern | Pi version | Mobile version |
|---|---|---|
| Orchestration loop | `main.py`, 5 FPS polling loop, `threading.Lock` for camera switches | `MainScreen.tsx`, React state + a Vision Camera `useFrameProcessor` worklet |
| Object detection | `detector.py` — NCNN, output shape `(14, 2100)` | `useTensorflowModel` (TFLite), output shape `(13, 2100)`, parsed directly in the frame processor |
| Distance | HC-SR04 ultrasonic sensor, exact cm/metres | **Removed.** No ranging hardware on a phone — direction only (left/front/right) |
| Text-to-speech | `voice.py` — espeak-ng via `Popen`, manual queue + `process.kill()` for instant cutoff | `VoiceService.ts` — `expo-speech`, JS queue replicating the same "priority clears queue" behavior |
| OCR | `ocr_reader.py` — 7-step OpenCV preprocessing + Tesseract 5, OEM 3 / PSM 6 | `OCRService.ts` — ML Kit on-device text recognizer. ML Kit does its own preprocessing internally, so the manual denoise/deskew/threshold pipeline is unnecessary and was dropped |
| Input | 3× tactile GPIO buttons (MODE / ACTION / REPEAT), short-press vs. 2s-hold logic | Double tap / long press / shake anywhere on screen, plus on-screen buttons — chosen because users may not be looking at (or reliably reaching) small fixed targets |
| Sleep / wake | Deliberate 2s combo hold, silent boot | **Removed** — app is foreground-only on a phone; there's no equivalent "always-on, silent background" state to protect a power bank |
| Settings | Hardcoded in `config.py` | `SettingsScreen.tsx` + `SettingsService.ts` — sensitivity, cooldown, speech rate, haptics/shake toggles, persisted via `AsyncStorage` |
| First-run experience | None (device is silent until first hold) | `OnboardingScreen.tsx` — spoken walkthrough on first launch, dismissible without looking at the screen |
| Audio routing | Manual `~/.asoundrc` pinning ALSA to the headphone jack | Handled by the OS; `expo-speech` routes to whatever output the phone is currently using |

---

## 2. Architecture

### 2.1 Module dependency flow

```
App.tsx
 └─ SettingsService.isOnboarded()
      ├─ OnboardingScreen.tsx   (first launch only)
      └─ MainScreen.tsx
           ├─ config.ts                     (MODEL, DETECTION, VOICE, CLASS_NAMES — single source of truth)
           ├─ useTensorflowModel            (react-native-fast-tflite)
           ├─ useFrameProcessor             (react-native-vision-camera, runs on camera thread)
           │    ├─ useResizePlugin          (vision-camera-resize-plugin — frame → model input tensor)
           │    ├─ utils/direction.ts       (getDirection, className, buildPhrase)
           │    └─ utils/nms.ts             (nonMaxSuppression — worklet, runs on camera thread too)
           ├─ services/VoiceService.ts      (expo-speech wrapper, priority queue)
           ├─ services/OCRService.ts        (ML Kit text recognition + sentence splitting)
           ├─ services/HapticsService.ts    (expo-haptics, direction-coded pulses)
           ├─ services/SettingsService.ts   (AsyncStorage-backed, pub/sub)
           └─ SettingsScreen.tsx            (reads/writes SettingsService)
```

Every module still imports its constants from one place (`config.ts`), same
principle as `config.py` on the Pi — pins and GPIO numbers are gone, but
`CLASS_NAMES`, thresholds, and timers work the same way.

### 2.2 Threading model

The Pi version juggled five real OS threads (main loop, TTS worker,
ultrasonic poller, hold-watcher, GPIO callbacks). React Native has no
GPIO/ultrasonic thread to replace, but it still splits work across three
execution contexts:

| Context | Runs | Equivalent to (Pi) |
|---|---|---|
| **Camera/worklet thread** | `useFrameProcessor` — resize, TFLite inference, box decoding, NMS | Main loop's inference step |
| **JS thread** | React state, gesture handling, `VoiceService`, `HapticsService`, `SettingsService` | Main loop's orchestration + `buttons.py` |
| **Native modules (async)** | `expo-speech`, `expo-haptics`, ML Kit OCR, `AsyncStorage` | TTS worker thread, Tesseract call |

`runOnJS(announceDetections)(detections)` is the bridge: detection happens
on the camera thread (for speed, off the UI thread), then hands the final
filtered list back to JS to actually speak/vibrate/flash — mirroring how
`detector.py` ran in the main loop but `voice.py` ran on its own thread.

### 2.3 Complete system flow

```
Launch
  │
  ├─ Onboarded? ──No──▶ OnboardingScreen (spoken walkthrough, tap anywhere to dismiss)
  │        │
  │       Yes
  │        ▼
  └─ MainScreen mounts
       │
       ├─ Load settings (AsyncStorage) → apply to Haptics/Voice
       ├─ Request camera permission
       ├─ Speak "SmartVision ready. Detection mode."
       ├─ Subscribe to accelerometer (shake-to-repeat, if enabled)
       │
       ▼
     DETECTION MODE (continuous, background — no button press needed)
       Camera frame ──▶ resize to 320×320 ──▶ TFLite inference
         ──▶ decode (13,2100) channel-major output ──▶ confidence filter
         ──▶ per-class NMS ──▶ runOnJS(announceDetections)
         ──▶ per-label cooldown check ──▶ speak + haptic pulse + color flash
       Throttled to DETECTION.targetFps (default 5, same cap as the Pi loop)
       │
       ├─ [Mode button] ──▶ OCR MODE
       │     Waits for [double tap / Scan-Read button]
       │       ──▶ camera.takePhoto() ──▶ ML Kit recognize()
       │       ──▶ split into sentences ──▶ speak one by one
       │       ──▶ [double tap again] stops reading instantly
       │     [Mode button] ──▶ back to Detection mode
       │
       ├─ [Long press / shake / Repeat button] ──▶ VoiceService.repeatLast()
       ├─ [Torch button] ──▶ toggle flashlight
       └─ [Settings button] ──▶ SettingsScreen (persisted via AsyncStorage)
```

---

## 3. Model details

### 3.1 Export pipeline

Same YOLOv8 architecture as the Pi build, but exported to **TFLite** instead
of NCNN — NCNN has no React Native binding, while `react-native-fast-tflite`
gives native-speed on-device inference on both iOS and Android:

```bash
pip install ultralytics
python export_model.py --model best.pt --tflite-only
```

Produces `best_float16.tflite` (or `best_int8.tflite` for a smaller, faster
— but slightly less accurate — model). Copy it to
`smartvision-mobile/src/assets/` and point `MODEL.path` in `config.ts` at it.

### 3.2 Output tensor layout

```
Shape: [1, 13, 2100]
  13   = 4 bbox values (cx, cy, w, h)  +  9 class confidence scores
  2100 = candidate anchor boxes
```

This is **channel-major**, not box-major — the Pi's NCNN export was
`(14, 2100)` transposed to `(2100, 14)` so each *row* was one box. The
mobile TFLite export keeps the untransposed layout, so element
`(channel c, box i)` lives at `raw[c * numBoxes + i]`, not `raw[i * 13 + c]`.
`MainScreen.tsx`'s frame processor decodes this directly — if you re-export
with a different `imgsz` or class count, re-verify the shape with:

```bash
python -c "import tensorflow as tf; i=tf.lite.Interpreter('best_float16.tflite'); i.allocate_tensors(); print(i.get_output_details())"
```

### 3.3 Classes

> ⚠️ **Needs verification before shipping.** The frame processor's decode
> loop is hardcoded for **9 classes** (`numChannels = 4 + 9`), but the
> training-run class-distribution table you shared lists only **8** trained
> classes:
>
> | Class | Train | Valid | Test | Total |
> |---|---|---|---|---|
> | blindroad | 746 | 86 | 90 | 922 |
> | book | 1,936 | 252 | 239 | 2,427 |
> | chair | 2,109 | 272 | 283 | 2,664 |
> | crosswalk | 1,120 | 133 | 133 | 1,386 |
> | desk | 1,353 | 170 | 170 | 1,693 |
> | door | 1,159 | 145 | 150 | 1,454 |
> | person | 4,967 | 588 | 632 | 6,187 |
> | stair | 1,360 | 167 | 160 | 1,687 |
>
> If the exported model genuinely has 8 output classes and `config.ts`
> declares 9 (or vice versa), `numChannels` will be wrong, `numBoxes` will
> be computed incorrectly (`raw.length / numChannels`), and **every box and
> class score decoded from the tensor will be misaligned** — not a subtle
> accuracy issue, a fully broken parse. Confirm the true class count from
> the exported model's `get_output_details()` (command above) and make sure
> `CLASS_NAMES` in `config.ts`, `numChannels` in `MainScreen.tsx`, and the
> model's actual training classes all agree before relying on this build.

Validation results from the most recent training run (`Ultralytics 8.4.53`,
YOLOv8n, Tesla T4), for reference once the class count above is confirmed:

| Class | Images | Instances | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---|---|---|
| all | 1082 | 1857 | 0.884 | 0.77 | 0.829 | 0.646 |
| blindroad | 83 | 90 | 0.91 | 0.867 | 0.889 | 0.724 |
| book | 150 | 239 | 0.877 | 0.776 | 0.84 | 0.67 |
| chair | 150 | 283 | 0.846 | 0.848 | 0.888 | 0.671 |
| crosswalk | 110 | 133 | 0.984 | 0.908 | 0.961 | 0.787 |
| desk | 150 | 170 | 0.803 | 0.724 | 0.795 | 0.615 |
| door | 139 | 150 | 0.969 | 0.947 | 0.97 | 0.818 |
| person | 150 | 632 | 0.785 | 0.288 | 0.398 | 0.226 |
| stair | 150 | 160 | 0.901 | 0.806 | 0.889 | 0.658 |

`person` recall (0.288) is noticeably weaker than every other class despite
having the most training instances — worth investigating (label quality,
scale/occlusion in the validation set, or an anchor/NMS interaction) before
treating detection coverage as uniform across classes.

### 3.4 Direction logic (unchanged from Pi)

Frame is still divided into thirds, no distance term — same rule as
`getDirection()` in the Pi's `detector.py`:

```ts
// src/utils/direction.ts
ratio < DETECTION.leftBoundary   → "left"
ratio > DETECTION.rightBoundary  → "right"
otherwise                        → "front"
```

One caveat carried over from code review: `getDirection(x1, x2, 1.0)` in
`MainScreen.tsx` assumes the model's normalized box coordinates map 1:1
onto the original camera frame. This only holds if `vision-camera-resize-plugin`
does a straight scale-to-square with no letterbox/crop padding — confirm
this against the plugin's actual behavior for non-square camera frames,
since a mismatch here would misreport left/right for real detections.

---

## 4. Interaction model

Designed so every action works two ways: a labeled on-screen button, and a
large, aim-free gesture — since the primary users may not be looking at the
screen at all.

| Action | Gesture | Button | Was (Pi) |
|---|---|---|---|
| Scan / Capture & read | Double tap anywhere | **Scan** / **Read** | GPIO 27 (ACTION) short press |
| Repeat last announcement | Long press anywhere, or shake phone | **Repeat** | GPIO 22 (REPEAT) short press |
| Toggle Detection ↔ Book Reading | — | **Mode** | GPIO 17 (MODE) short press |
| Torch on/off | — | **Torch** icon | n/a (no torch on Pi camera) |
| Open settings | — | **Settings** icon | n/a (no screen on Pi build) |

Extra feedback channels, both new relative to the Pi (which had voice only):

- **Haptics** — light pulse = left, medium = front, heavy = right, so a
  detection can be felt as well as heard (useful in noisy environments).
- **Color flash** — a brief orange/green/blue border flash per direction,
  for users with partial usable vision who rely on voice for the rest.

---

## 5. Setup

### 5.1 Prerequisites

Native modules (camera, TFLite, ML Kit) mean this **cannot run in plain
Expo Go** — a development build is required.

```bash
npm install
npx expo prebuild
npx expo run:android   # or: npx expo run:ios
```

### 5.2 Model file

1. Export your trained model to TFLite (§3.1).
2. Copy it to `src/assets/best_float16.tflite`.
3. Update `MODEL.path` in `src/config.ts` if the filename differs.
4. **Confirm the class count matches `numChannels` in `MainScreen.tsx`**
   before trusting detection output (§3.3).

### 5.3 Run

```bash
npm start
```

Scan the QR with your dev-client build (not Expo Go), or launch directly
from Android Studio / Xcode.

---

## 6. Tuning

All in `src/config.ts`, same role as the Pi's `config.py`:

| Setting | Purpose |
|---|---|
| `CLASS_NAMES` | Must match the trained model's class order exactly |
| `DETECTION.confidenceThreshold` | Was `0.45` on the Pi; user-adjustable in Settings on mobile |
| `DETECTION.nmsIouThreshold` | Was `0.45` on the Pi (matches) |
| `DETECTION.leftBoundary` / `rightBoundary` | Direction split points, thirds of frame |
| `DETECTION.announceCooldownMs` | Was a fixed 3s on the Pi; user-adjustable (1–6s) on mobile |
| `DETECTION.maxAnnouncesPerFrame` | Was 2 on the Pi |
| `DETECTION.targetFps` | Was a hard 5 FPS main-loop cap on the Pi; same default here |
| `MODEL.inputSize` | Must match the `imgsz` used at export time (320) |

User-facing overrides (persisted via `AsyncStorage`, not available on the
Pi since it had no screen): detection sensitivity, announcement gap, speech
rate, haptics on/off, shake-to-repeat on/off, torch-on-by-default.

---

## 7. Known gaps

- **Class-count mismatch to verify** — see §3.3. This is the highest-priority
  item; it can silently corrupt every detection if wrong.
- **No `int8` quantization wiring yet** — swap `dataType: 'float32'` in the
  resize call for `'uint8'` if you export an int8 model, for a real speed
  boost on lower-end phones.
- **Resize/letterbox behavior unconfirmed** — see §3.4. Directly affects
  whether announced left/right directions are accurate.
- **Onboarding uses fixed delays** between spoken steps rather than waiting
  for `expo-speech`'s `onDone` callback — fine for the current short lines,
  but fragile if the walkthrough text grows.
- **Shake threshold is untuned** — `SHAKE_THRESHOLD` in `MainScreen.tsx` is
  a simple accelerometer magnitude spike; verify against real walking
  motion to avoid false triggers.
- **No distance/ranging** — a deliberate scope cut (§1), not a bug, but
  worth calling out explicitly since the Pi's HC-SR04 gave exact cm/metres
  and this version is direction-only.
- **OCR "stop" still fires the camera** — tapping to stop a reading calls
  `camera.takePhoto()` before `OCRService` gets a chance to just stop,
  wasting a capture. Check `OCRService`'s `reading` flag before calling
  `takePhoto` if you want a true instant-stop like the Pi's `flush()`.

---

## 8. Project structure

```
smartvision-mobile/
├── App.tsx
├── app.json
├── metro.config.js
├── package.json
├── tsconfig.json
└── src/
    ├── config.ts                  (MODEL, DETECTION, VOICE, CLASS_NAMES)
    ├── assets/
    │   └── best_float16.tflite
    ├── screens/
    │   ├── MainScreen.tsx
    │   ├── OnboardingScreen.tsx
    │   └── SettingsScreen.tsx
    ├── services/
    │   ├── VoiceService.ts
    │   ├── OCRService.ts
    │   ├── HapticsService.ts
    │   └── SettingsService.ts
    └── utils/
        ├── direction.ts
        └── nms.ts
```
