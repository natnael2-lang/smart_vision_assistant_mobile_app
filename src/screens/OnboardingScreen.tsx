/**
 * OnboardingScreen.tsx — spoken walkthrough shown once on first launch.
 * Designed to be usable without ever looking at the screen: everything
 * is also announced, and the whole screen is one big dismiss target.
 */
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView } from 'react-native';
import { VoiceService } from '../services/VoiceService';
import { HapticsService } from '../services/HapticsService';

const STEPS = [
  "Welcome to SmartVision. I'll describe objects around you and read text aloud.",
  'Double tap anywhere on the screen to scan, or to read a page in book mode.',
  'Long press anywhere to repeat the last thing I said. You can also just shake your phone.',
  'Tap the Mode button any time to switch between object detection and book reading.',
  "Let's get started.",
];

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const step of STEPS) {
        if (cancelled) return;
        VoiceService.speak(step, true);
        await new Promise((r) => setTimeout(r, 3200));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = () => {
    HapticsService.confirm();
    onDone();
  };

  return (
    <Pressable style={styles.flex} onPress={finish} accessibilityLabel="Get started">
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>SmartVision</Text>
        <Text style={styles.subtitle}>
          Listen for the walkthrough, then tap anywhere to begin.
        </Text>
        <View style={styles.hintBox}>
          <Text style={styles.hint}>Double tap → Scan / Read page</Text>
          <Text style={styles.hint}>Long press or shake → Repeat</Text>
          <Text style={styles.hint}>Mode button → Switch modes</Text>
        </View>
        <Text style={styles.cta}>Tap anywhere to get started</Text>
      </SafeAreaView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { color: 'white', fontSize: 32, fontWeight: '800', marginBottom: 12 },
  subtitle: { color: '#cbd5e1', fontSize: 16, textAlign: 'center', marginBottom: 32 },
  hintBox: { marginBottom: 40 },
  hint: { color: '#e2e8f0', fontSize: 16, marginBottom: 10, textAlign: 'center' },
  cta: {
    color: '#60a5fa',
    fontSize: 18,
    fontWeight: '700',
    position: 'absolute',
    bottom: 48,
  },
});
