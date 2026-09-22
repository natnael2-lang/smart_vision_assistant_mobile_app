import React, { useEffect, useState } from 'react';
import { StatusBar, ActivityIndicator, View } from 'react-native';
import MainScreen from './src/screens/MainScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { SettingsService } from './src/services/SettingsService';

export default function App() {
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    SettingsService.isOnboarded().then((done) => {
      setShowOnboarding(!done);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  return (
    <>
      <StatusBar hidden />
      {showOnboarding ? (
        <OnboardingScreen
          onDone={() => {
            SettingsService.setOnboarded();
            setShowOnboarding(false);
          }}
        />
      ) : (
        <MainScreen />
      )}
    </>
  );
}
