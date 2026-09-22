/**
 * HapticsService.ts — gives blind/low-vision users a tactile channel
 * alongside speech. Each direction gets a distinguishable pulse so a
 * detection can be "felt" a beat before (or instead of) hearing it.
 */
import * as Haptics from 'expo-haptics';
import type { Direction } from '../utils/direction';

let enabled = true;

export const HapticsService = {
  setEnabled(value: boolean) {
    enabled = value;
  },

  /** Left = light tap, front = medium, right = heavy — easy to tell apart. */
  forDirection(direction: Direction) {
    if (!enabled) return;
    switch (direction) {
      case 'left':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'front':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'right':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
    }
  },

  /** Confirms a button press / gesture was registered. */
  tap() {
    if (!enabled) return;
    Haptics.selectionAsync();
  },

  /** Confirms a mode switch or successful capture. */
  confirm() {
    if (!enabled) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
};
