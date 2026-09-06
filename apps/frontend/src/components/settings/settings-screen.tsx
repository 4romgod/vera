import { useCallback, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useVeraClient } from '@/api/use-vera-client';
import { ErrorToast } from '@/components/assistant/run-status';
import {
  parseSettingsSection,
  SettingsNavigation,
  type SettingsSection,
} from '@/components/settings/settings-navigation';
import { ConnectionsSettingsTab } from '@/components/settings/tabs/connections-settings-tab';
import { NotificationSettingsTab } from '@/components/settings/tabs/notification-settings-tab';
import { VoiceSettingsTab } from '@/components/settings/tabs/voice-settings-tab';
import { palette, radius, spacing } from '@/design/tokens';

const SETTINGS_COMPACT_BREAKPOINT = 760;

export function SettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < SETTINGS_COMPACT_BREAKPOINT;
  const section = parseSettingsSection(params.section);
  const [error, setError] = useState<string>();
  const client = useVeraClient();
  const returnToVera = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  function selectSection(next: SettingsSection): void {
    router.setParams({ section: next });
  }

  return (
    <View
      style={{
        minHeight: 0,
        flex: 1,
        paddingTop: insets.top,
        backgroundColor: palette.canvas,
      }}
    >
      <Stack.Screen options={{ title: 'Vera settings' }} />
      <View
        style={{
          minHeight: 72,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: palette.lineSoft,
          paddingHorizontal: compact ? spacing.md : spacing.xxl,
          backgroundColor: palette.canvasRaised,
        }}
      >
        <Pressable
          accessibilityLabel="Back to Vera"
          accessibilityRole="button"
          onPress={returnToVera}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: palette.lineSoft,
            borderRadius: radius.md,
            opacity: pressed ? 0.68 : 1,
            backgroundColor: palette.surface,
          })}
        >
          <ArrowLeft color={palette.textSoft} size={20} />
        </Pressable>
        <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <Text
            selectable
            style={{ color: palette.text, fontSize: 20, fontWeight: '700' }}
          >
            Settings
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: palette.muted, fontSize: 12 }}
          >
            Configure your Vera experience
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          width: '100%',
          maxWidth: 1180,
          flexGrow: 1,
          alignSelf: 'center',
          paddingTop: spacing.xxl,
          paddingBottom: Math.max(insets.bottom, spacing.xxxl),
          gap: spacing.xl,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
          <Text
            selectable
            style={{
              color: palette.accent,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1,
            }}
          >
            PERSONALIZE VERA
          </Text>
          <Text
            selectable
            style={{
              color: palette.text,
              fontSize: compact ? 28 : 34,
              fontWeight: '700',
              letterSpacing: -1,
            }}
          >
            Make Vera yours
          </Text>
          <Text
            selectable
            style={{
              maxWidth: 620,
              color: palette.muted,
              fontSize: 14,
              lineHeight: 21,
            }}
          >
            Choose how Vera sounds, reaches you, and connects to the services
            you trust.
          </Text>
        </View>

        <View
          style={{
            minHeight: 0,
            flexDirection: compact ? 'column' : 'row',
            alignItems: 'flex-start',
            gap: spacing.xxl,
          }}
        >
          <SettingsNavigation
            compact={compact}
            selected={section}
            onSelect={selectSection}
          />
          <View
            style={{
              width: compact ? '100%' : undefined,
              minWidth: 0,
              maxWidth: 760,
              flex: compact ? undefined : 1,
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
            }}
          >
            {section === 'voice' ? (
              <VoiceSettingsTab client={client} onError={setError} />
            ) : null}
            {section === 'connections' ? (
              <ConnectionsSettingsTab client={client} onError={setError} />
            ) : null}
            {section === 'notifications' ? (
              <NotificationSettingsTab
                client={client}
                onAttention={returnToVera}
                onError={setError}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>

      {error === undefined ? null : (
        <ErrorToast
          bottom={Math.max(insets.bottom, spacing.lg)}
          error={error}
          onClose={() => setError(undefined)}
        />
      )}
    </View>
  );
}
