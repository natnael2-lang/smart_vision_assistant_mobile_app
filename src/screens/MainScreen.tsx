/**
 * MainScreen.tsx — replaces main.py (app loop) + buttons.py (GPIO → touch
 * + gestures). Runs YOLO inference on-device via a Vision Camera frame
 * processor and TFLite, announces direction-only detections with voice +
 * haptics, and handles OCR mode.
 *
 * Interaction model (bigger, more forgiving than the old tiny buttons —
 * important since the primary users may not be looking at the screen):
 *   - Double tap anywhere      → Scan (detect mode) / Capture & read (OCR mode)
 *   - Long press anywhere      → Repeat last announcement
 *   - Shake phone              → Repeat last announcement
 *   - Mode button              → Toggle Detection ↔ Book Reading
 *   - Torch button             → Toggle flashlight for low light
 *   - Settings button          → Open settings
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Accelerometer } from 'expo-sensors';

import { MODEL, DETECTION } from '../config';
import { getDirection, className, buildPhrase, Detection, Direction } from '../utils/direction';
import { nonMaxSuppression } from '../utils/nms';
import { VoiceService } from '../services/VoiceService';
import { OCRService } from '../services/OCRService';
import { HapticsService } from '../services/HapticsService';
import { SettingsService, Settings, DEFAULT_SETTINGS } from '../services/SettingsService';
import SettingsScreen from './SettingsScreen';

type Mode = 'detect' | 'ocr';

const DIRECTION_COLOR: Record<Direction, string> = {
  left: '#f97316', // orange
  front: '#22c55e', // green
  right: '#3b82f6', // blue
};

const DOUBLE_TAP_MS = 300;
const SHAKE_THRESHOLD = 2.2; // accelerometer magnitude spike
const SHAKE_COOLDOWN_MS = 1500;

export default function MainScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const camera = useRef<Camera>(null);
  const model = useTensorflowModel(MODEL.path);
  const { resize } = useResizePlugin();

  const [mode, setMode] = useState<Mode>('detect');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [torchOn, setTorchOn] = useState(false);
  const [flashDirection, setFlashDirection] = useState<Direction | null>(null);

  const lastAnnounced = useRef<Record<string, number>>({});
  const lastFrameTime = useSharedValue(0);
  const lastTapTime = useRef(0);
  const lastShakeTime = useRef(0);
  const flashOpacity = useSharedValue(0);
  const flashAnimatedStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  // ── Load persisted settings ──
  useEffect(() => {
    SettingsService.load().then((s) => {
      setSettings(s);
      setTorchOn(s.torchDefaultOn);
      HapticsService.setEnabled(s.hapticsEnabled);
    });
    return SettingsService.subscribe(setSettings);
  }, []);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  useEffect(() => {
    VoiceService.speak('SmartVision ready. Detection mode.', true);
  }, []);

  // ── Shake-to-repeat ──
  useEffect(() => {
    if (!settings.shakeToRepeatEnabled) return;
    Accelerometer.setUpdateInterval(200);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (magnitude > SHAKE_THRESHOLD && now - lastShakeTime.current > SHAKE_COOLDOWN_MS) {
        lastShakeTime.current = now;
        HapticsService.tap();
        VoiceService.repeatLast();
      }
    });
    return () => sub.remove();
  }, [settings.shakeToRepeatEnabled]);

  // ── Visual direction flash (helps low-vision users, not just blind) ──
  const flashDirectionIndicator = useCallback(
    (direction: Direction) => {
      setFlashDirection(direction);
      flashOpacity.value = 0.5;
      flashOpacity.value = withTiming(0, { duration: 500 });
    },
    [flashOpacity]
  );

  // ── Announce logic (throttled, cooldown per label, voice + haptics + visual) ──
  const announceDetections = useCallback(
    (detections: Detection[]) => {
      let announced = 0;
      const now = Date.now();
      for (const det of detections) {
        if (announced >= DETECTION.maxAnnouncesPerFrame) break;
        const last = lastAnnounced.current[det.label] ?? 0;
        if (now - last < settings.announceCooldownMs) continue;

        const phrase = buildPhrase(det.label, det.direction);
        VoiceService.speak(phrase);
        HapticsService.forDirection(det.direction);
        flashDirectionIndicator(det.direction);
        lastAnnounced.current[det.label] = now;
        announced++;
      }
    },
    [settings.announceCooldownMs, flashDirectionIndicator]
  );

  // ── Frame processor: runs on the camera thread (worklet) ──
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (mode !== 'detect' || model.state !== 'loaded') return;

      const now = Date.now();
      const minInterval = 1000 / DETECTION.targetFps;
      if (now - lastFrameTime.value < minInterval) return;
      lastFrameTime.value = now;

      const resized = resize(frame, {
        scale: { width: MODEL.inputSize, height: MODEL.inputSize },
        pixelFormat: 'rgb',
        dataType: 'float32',
      });

      const outputs = model.model.runSync([resized]);
      // Confirmed export layout (via interpreter.get_output_details()):
      // [1, 13, 2100] = [batch, channels, boxes] — CHANNEL-MAJOR, not
      // box-major. Channels are [cx, cy, w, h, class0..class8], each
      // channel holding all `numBoxes` values contiguously. So element
      // (channel c, box i) sits at raw[c * numBoxes + i], NOT raw[i * 13 + c].
      const raw = outputs[0];
      const numChannels = 4 + 9; // 4 bbox coords + 9 class scores
      const numBoxes = raw.length / numChannels; // 2100

      const candidates: Detection[] = [];
      for (let i = 0; i < numBoxes; i++) {
        let bestClass = -1;
        let bestScore = 0;
        for (let c = 0; c < 9; c++) {
          const score = raw[(4 + c) * numBoxes + i];
          if (score > bestScore) {
            bestScore = score;
            bestClass = c;
          }
        }
        if (bestScore < DETECTION.confidenceThreshold) continue;

        const cx = raw[0 * numBoxes + i];
        const cy = raw[1 * numBoxes + i];
        const w = raw[2 * numBoxes + i];
        const h = raw[3 * numBoxes + i];
        const x1 = cx - w / 2;
        const x2 = cx + w / 2;
        const y1 = cy - h / 2;
        const y2 = cy + h / 2;

        candidates.push({
          label: className(bestClass),
          confidence: bestScore,
          direction: getDirection(x1, x2, 1.0),
          bbox: [x1, y1, x2, y2],
        });
      }

      candidates.sort((a, b) => b.confidence - a.confidence);
      const detections = nonMaxSuppression(candidates, DETECTION.nmsIouThreshold);

      runOnJS(announceDetections)(detections);
    },
    [mode, model, announceDetections]
  );

  // ── Mode toggle (was GPIO 17 / M key) ──
  const onModeToggle = () => {
    HapticsService.confirm();
    if (mode === 'detect') {
      setMode('ocr');
      VoiceService.speak('Book reading mode.', true);
    } else {
      setMode('detect');
      OCRService.stopReading();
      VoiceService.speak('Object detection mode.', true);
    }
  };

  // ── Capture (was GPIO 27 / C key / double tap) ──
  const onCapture = useCallback(async () => {
    HapticsService.confirm();
    if (mode === 'ocr') {
      if (!camera.current) return;
      const photo = await camera.current.takePhoto({ flash: 'off' });
      await OCRService.captureAndRead(`file://${photo.path}`);
    } else {
      VoiceService.speak('Scanning now.', true);
    }
  }, [mode]);

  // ── Repeat (was GPIO 22 / R key / long press / shake) ──
  const onRepeat = useCallback(() => {
    HapticsService.tap();
    VoiceService.repeatLast();
  }, []);

  // ── Screen-wide gesture layer ──
  const onScreenTap = () => {
    const now = Date.now();
    if (now - lastTapTime.current < DOUBLE_TAP_MS) {
      lastTapTime.current = 0;
      onCapture();
    } else {
      lastTapTime.current = now;
    }
  };

  const onToggleTorch = () => {
    HapticsService.tap();
    setTorchOn((t) => !t);
  };

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.text}>Camera permission is required.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.text}>No camera found.</Text>
      </SafeAreaView>
    );
  }

  if (settingsOpen) {
    return <SettingsScreen onClose={() => setSettingsOpen(false)} />;
  }

  return (
    <View style={styles.flex}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        torch={torchOn ? 'on' : 'off'}
        frameProcessor={frameProcessor}
      />

      {/* Full-screen gesture layer: double tap = scan, long press = repeat */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onScreenTap}
        onLongPress={onRepeat}
        delayLongPress={500}
        accessibilityLabel="Double tap to scan, long press to repeat"
      />

      {/* Direction flash — brief colored edge glow, doesn't block gestures */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderWidth: 8,
            borderColor: flashDirection ? DIRECTION_COLOR[flashDirection] : 'transparent',
          },
          flashAnimatedStyle,
        ]}
      />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <IconButton label="Torch" active={torchOn} onPress={onToggleTorch} />
          <Text style={styles.modeLabel}>{mode === 'detect' ? 'Detection' : 'Book Reading'}</Text>
          <IconButton label="Settings" onPress={() => setSettingsOpen(true)} />
        </View>

        <View style={styles.controls} pointerEvents="box-none">
          <ControlButton label="Mode" onPress={onModeToggle} />
          <ControlButton label={mode === 'ocr' ? 'Read' : 'Scan'} onPress={onCapture} big />
          <ControlButton label="Repeat" onPress={onRepeat} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  big = false,
}: {
  label: string;
  onPress: () => void;
  big?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, big && styles.buttonBig]}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function IconButton({
  label,
  onPress,
  active = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      style={[styles.iconButton, active && styles.iconButtonActive]}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Text style={styles.iconButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  modeLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  iconButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  iconButtonActive: { backgroundColor: '#f59e0b' },
  iconButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    minWidth: 90,
    alignItems: 'center',
  },
  buttonBig: {
    backgroundColor: '#2563eb',
    minWidth: 110,
    paddingVertical: 24,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#111' },
  text: { color: '#111', fontSize: 16, marginBottom: 12, textAlign: 'center' },
});