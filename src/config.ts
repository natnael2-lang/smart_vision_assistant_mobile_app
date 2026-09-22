/**
 * config.ts — SmartVision Mobile settings
 * Mirrors the old Raspberry Pi config.py, minus GPIO pins and distance
 * estimation (dropped per request — direction only now).
 */

export const MODEL = {
  // Bundle your exported .tflite model here (see README "Model export")
   path: require('./assets/best.tflite'),
  inputSize: 320, // must match the imgsz used when exporting to tflite
};

export const CLASS_NAMES = [
  'person',
  'chair',
  'table',
  'door',
  'stairs',
  'car',
  'bicycle',
  'bottle',
  'phone',
];

export const DETECTION = {
  confidenceThreshold: 0.5,
  nmsIouThreshold: 0.45,
  maxAnnouncesPerFrame: 2,
  announceCooldownMs: 3000,
  // Frame split into thirds — same logic as the Pi version's LEFT/RIGHT boundaries
  leftBoundary: 0.33,
  rightBoundary: 0.67,
  targetFps: 5, // throttle frame-processor work to save battery/heat
};

export const OCR = {
  minConfidence: 60,
};

export const VOICE = {
  rate: 1.0, // expo-speech: 0.1–2.0 (1.0 = normal)
  pitch: 1.0,
  language: 'en-US',
};
