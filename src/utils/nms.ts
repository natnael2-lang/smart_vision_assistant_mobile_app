import type { Detection } from './direction';

function iou(a: Detection['bbox'], b: Detection['bbox']): number {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - interArea;

  return union <= 0 ? 0 : interArea / union;
}

/**
 * Greedy class-aware NMS. Input should already be confidence-sorted
 * descending (MainScreen does this before calling). 'worklet' so it can
 * run directly on the camera thread frame processor.
 */
export function nonMaxSuppression(detections: Detection[], iouThreshold: number): Detection[] {
  'worklet';
  const kept: Detection[] = [];
  const suppressed = new Array(detections.length).fill(false);

  for (let i = 0; i < detections.length; i++) {
    if (suppressed[i]) continue;
    kept.push(detections[i]);

    for (let j = i + 1; j < detections.length; j++) {
      if (suppressed[j]) continue;
      if (detections[j].label !== detections[i].label) continue; // per-class only
      if (iou(detections[i].bbox, detections[j].bbox) > iouThreshold) {
        suppressed[j] = true;
      }
    }
  }

  return kept;
}
