import { Sparkles, UserRound } from 'lucide-react-native';
import { Text, View } from 'react-native';

import type {
  ConversationMessageResource,
  TaskResource,
  VeraApi,
} from '@vera/client';

import { SpokenReplyButton } from '@/components/voice-controls';
import { palette, radius, spacing } from '@/design/tokens';
import {
  AssistantResultCard,
  hasStructuredResult,
} from './assistant-result-card';

export function ConversationMessage(props: {
  message: ConversationMessageResource;
  client: VeraApi;
  task?: TaskResource | null;
  speaking: boolean;
  onSpeak: () => void;
}) {
  const owner = props.message.role === 'owner';
  const structured = !owner && hasStructuredResult(props.task);
  return (
    <View
      style={{
        width: '100%',
        flexDirection: 'row',
        justifyContent: owner ? 'flex-end' : 'flex-start',
        gap: spacing.sm,
      }}
    >
      {!owner ? (
        <View
          style={{
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: palette.accentLine,
            borderRadius: radius.sm,
            backgroundColor: palette.accentSurface,
          }}
        >
          <Sparkles color={palette.accent} size={15} strokeWidth={1.9} />
        </View>
      ) : null}
      <View
        style={{
          maxWidth: owner ? '84%' : structured ? undefined : '88%',
          flexBasis: structured ? 0 : 'auto',
          flexGrow: structured ? 1 : 0,
          flexShrink: 1,
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: owner ? 'flex-end' : 'space-between',
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {owner ? (
              <UserRound color={palette.muted} size={14} strokeWidth={1.8} />
            ) : null}
            <Text
              selectable
              style={{
                color: owner ? palette.muted : palette.accent,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 0.7,
              }}
            >
              {owner ? 'YOU' : 'VERA'}
            </Text>
          </View>
          {!owner ? (
            <SpokenReplyButton
              speaking={props.speaking}
              onPress={props.onSpeak}
            />
          ) : null}
        </View>
        {structured && props.task !== null && props.task !== undefined ? (
          <AssistantResultCard client={props.client} task={props.task} />
        ) : (
          <View
            style={{
              borderWidth: owner ? 1 : 0,
              borderColor: '#3A372A',
              borderCurve: 'continuous',
              borderRadius: owner ? radius.lg : 0,
              paddingHorizontal: owner ? spacing.lg : 0,
              paddingVertical: owner ? spacing.md : 0,
              backgroundColor: owner ? '#181814' : 'transparent',
            }}
          >
            <Text
              selectable
              style={{ color: palette.textSoft, fontSize: 16, lineHeight: 25 }}
            >
              {props.message.content}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
