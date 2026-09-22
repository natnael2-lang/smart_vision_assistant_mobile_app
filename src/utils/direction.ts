import { DETECTION, CLASS_NAMES } from '../config';

export type Direction = 'left' | 'front' | 'right';

export interface Detection {
  label: string;
  confidence: number;
  direction: Direction;
  bbox: [number, number, number, number]; // x1, y1, x2, y2 (normalized 0-1)
}

/** Frame divided into thirds — same rule as the Pi build, no distance term. */
export function getDirection(x1: number, x2: number, frameWidth: number): Direction {
  const centerX = (x1 + x2) / 2;
  const ratio = centerX / frameWidth;
  if (ratio < DETECTION.leftBoundary) return 'left';
  if (ratio > DETECTION.rightBoundary) return 'right';
  return 'front';
}

export function className(classId: number): string {
  return CLASS_NAMES[classId] ?? `object_${classId}`;
}

/** Natural phrase, e.g. "Person on your left." / "Chair in front of you." */
export function buildPhrase(label: string, direction: Direction): string {
  const loc = direction === 'front' ? 'in front of you' : `on your ${direction}`;
  return `${label} ${loc}.`;
}
