import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@/design/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <View style={{ flex: 1, backgroundColor: palette.canvas }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: palette.canvas },
              headerShown: false,
            }}
          />
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
