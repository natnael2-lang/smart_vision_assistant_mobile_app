/**
 * SettingsService.ts — user-adjustable preferences, persisted across
 * launches. Falls back to config.ts defaults when nothing is stored yet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DETECTION, VOICE } from '../config';

export interface Settings {
  confidenceThreshold: number;
  announceCooldownMs: number;
  speechRate: number;
  hapticsEnabled: boolean;
  torchDefaultOn: boolean;
  shakeToRepeatEnabled: boolean;
}

const STORAGE_KEY = 'smartvision:settings';

export const DEFAULT_SETTINGS: Settings = {
  confidenceThreshold: DETECTION.confidenceThreshold,
  announceCooldownMs: DETECTION.announceCooldownMs,
  speechRate: VOICE.rate,
  hapticsEnabled: true,
  torchDefaultOn: false,
  shakeToRepeatEnabled: true,
};

type Listener = (s: Settings) => void;

class SettingsServiceImpl {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();
  private loaded = false;

  async load(): Promise<Settings> {
    if (this.loaded) return this.current;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) this.current = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      // fall back to defaults silently — settings are non-critical
    }
    this.loaded = true;
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: Partial<Settings>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((l) => l(this.current));
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // best-effort persistence
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async isOnboarded(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem('smartvision:onboarded')) === 'true';
    } catch {
      return false;
    }
  }

  async setOnboarded() {
    try {
      await AsyncStorage.setItem('smartvision:onboarded', 'true');
    } catch {
      // ignore
    }
  }
}

export const SettingsService = new SettingsServiceImpl();
