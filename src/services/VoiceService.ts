/**
 * VoiceService.ts — replaces voice.py (pyttsx3 + espeak-ng).
 * expo-speech is already non-blocking and queues by default, so we
 * reimplement the same "priority clears the queue" behavior on top of it.
 */
import * as Speech from 'expo-speech';
import { VOICE } from '../config';

class VoiceServiceImpl {
  private queue: string[] = [];
  private speaking = false;
  private lastMessage = '';

  speak(text: string, priority = false) {
    if (!text) return;

    if (priority) {
      this.queue = [];
      Speech.stop();
      this.speaking = false;
    }

    this.queue.push(text);
    this.lastMessage = text;
    this.drain();
  }

  repeatLast() {
    if (this.lastMessage) this.speak(this.lastMessage, true);
  }

  stopAll() {
    this.queue = [];
    Speech.stop();
    this.speaking = false;
  }

  private drain() {
    if (this.speaking || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.speaking = true;
    Speech.speak(next, {
      rate: VOICE.rate,
      pitch: VOICE.pitch,
      language: VOICE.language,
      onDone: () => {
        this.speaking = false;
        this.drain();
      },
      onStopped: () => {
        this.speaking = false;
      },
      onError: () => {
        this.speaking = false;
        this.drain();
      },
    });
  }
}

export const VoiceService = new VoiceServiceImpl();
