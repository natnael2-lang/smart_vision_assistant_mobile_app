/**
 * OCRService.ts — replaces ocr_reader.py (OpenCV preprocessing + Tesseract).
 * ML Kit's on-device text recognizer handles its own preprocessing
 * (deskew/denoise are unnecessary — it's built for handheld photos),
 * so this file is mostly text-splitting logic ported as-is.
 */
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { VoiceService } from './VoiceService';

let stopFlag = false;
let reading = false;

export const OCRService = {
  async captureAndRead(photoUri: string) {
    if (reading) {
      OCRService.stopReading();
      return;
    }

    reading = true;
    stopFlag = false;
    VoiceService.speak('Scanning page, please hold still.', true);

    try {
      const result = await TextRecognition.recognize(photoUri);
      const text = result.text?.trim();

      if (!text) {
        VoiceService.speak('No text found on the page. Please try again.');
        return;
      }

      const sentences = splitSentences(text);
      const wordCount = text.split(/\s+/).length;
      VoiceService.speak(`Reading ${wordCount} words.`);

      for (const sentence of sentences) {
        if (stopFlag) {
          VoiceService.speak('Reading stopped.');
          break;
        }
        if (sentence.trim()) VoiceService.speak(sentence);
        // small pacing gap so sentences don't overlap the queue
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      VoiceService.speak('An error occurred while reading the page.');
    } finally {
      reading = false;
    }
  },

  stopReading() {
    stopFlag = true;
    reading = false;
  },
};

/** Same grouping heuristic as the Pi version's _split_sentences(). */
function splitSentences(text: string): string[] {
  const cleaned = text
    .replace(/-\n/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?;:'"-]/g, '');

  const raw = cleaned.split(/(?<=[.!?])\s+/);
  const sentences: string[] = [];
  let current = '';

  for (const part of raw) {
    current += ` ${part}`;
    if (current.trim().split(/\s+/).length >= 8 || /[.!?]$/.test(part)) {
      sentences.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) sentences.push(current.trim());

  return sentences;
}
