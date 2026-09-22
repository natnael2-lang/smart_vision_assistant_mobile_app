/**
 * SettingsScreen.tsx — adjust detection sensitivity, speech rate, and
 * accessibility toggles. Every control has a large touch target and an
 * accessibility label so it works well with TalkBack/VoiceOver too.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { SettingsService, Settings, DEFAULT_SETTINGS } from '../services/SettingsService';
import { VoiceService } from '../services/VoiceService';
import { HapticsService } from '../services/HapticsService';

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    SettingsService.load().then(setSettings);
  }, []);

  const patch = (p: Partial<Settings>) => {
    HapticsService.tap();
    SettingsService.update(p);
    setSettings((s) => ({ ...s, ...p }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <Row label={`Detection sensitivity: ${Math.round(settings.confidenceThreshold * 100)}%`}>
          <Slider
            minimumValue={0.3}
            maximumValue={0.9}
            step={0.05}
            value={settings.confidenceThreshold}
            onSlidingComplete={(v) => patch({ confidenceThreshold: v })}
            accessibilityLabel="Detection sensitivity"
          />
        </Row>

        <Row label={`Announcement gap: ${(settings.announceCooldownMs / 1000).toFixed(1)}s`}>
          <Slider
            minimumValue={1000}
            maximumValue={6000}
            step={500}
            value={settings.announceCooldownMs}
            onSlidingComplete={(v) => patch({ announceCooldownMs: v })}
            accessibilityLabel="Time between repeated announcements"
          />
        </Row>

        <Row label={`Speech rate: ${settings.speechRate.toFixed(1)}x`}>
          <Slider
            minimumValue={0.5}
            maximumValue={2.0}
            step={0.1}
            value={settings.speechRate}
            onSlidingComplete={(v) => patch({ speechRate: v })}
            accessibilityLabel="Speech rate"
          />
        </Row>

        <SwitchRow
          label="Haptic feedback"
          value={settings.hapticsEnabled}
          onChange={(v) => {
            HapticsService.setEnabled(v);
            patch({ hapticsEnabled: v });
          }}
        />
        <SwitchRow
          label="Shake to repeat"
          value={settings.shakeToRepeatEnabled}
          onChange={(v) => patch({ shakeToRepeatEnabled: v })}
        />
        <SwitchRow
          label="Torch on by default"
          value={settings.torchDefaultOn}
          onChange={(v) => patch({ torchDefaultOn: v })}
        />

        <Pressable
          style={styles.testButton}
          onPress={() => VoiceService.speak('This is what announcements sound like.', true)}
        >
          <Text style={styles.testButtonText}>Test voice</Text>
        </Pressable>

        <Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Done, go back">
          <Text style={styles.closeButtonText}>Done</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 24, paddingBottom: 48 },
  title: { color: 'white', fontSize: 28, fontWeight: '800', marginBottom: 24 },
  row: { marginBottom: 24 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 6,
  },
  label: { color: '#e2e8f0', fontSize: 16, marginBottom: 8 },
  testButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  testButtonText: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  closeButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
  },
  closeButtonText: { color: 'white', fontSize: 18, fontWeight: '700' },
});
