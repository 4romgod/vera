import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import type { ConversationSummaryResource } from '@vera/client';

import { palette, radius, shadow, spacing } from '@/design/tokens';
import { displayConversationTitle } from './presentation.ts';

export function ConversationDeleteDialog(props: {
  conversation?: ConversationSummaryResource;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const visible = props.conversation !== undefined;
  return (
    <Modal
      animationType="fade"
      onRequestClose={props.deleting ? undefined : props.onCancel}
      transparent
      visible={visible}
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: spacing.xl,
          backgroundColor: palette.scrim,
        }}
      >
        <Pressable
          accessibilityLabel="Cancel conversation deletion"
          disabled={props.deleting}
          onPress={props.onCancel}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View
          style={{
            width: '100%',
            maxWidth: 420,
            gap: spacing.lg,
            borderWidth: 1,
            borderColor: palette.line,
            borderRadius: radius.lg,
            padding: spacing.xl,
            backgroundColor: palette.surfaceRaised,
            boxShadow: shadow.floating,
          }}
        >
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              style={{ color: palette.text, fontSize: 20, fontWeight: '700' }}
            >
              Delete conversation?
            </Text>
            <Text style={{ color: palette.textSoft, fontSize: 14 }}>
              “{displayConversationTitle(props.conversation?.title, 80)}” will
              be removed from your conversation history. This cannot be undone.
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: spacing.sm,
            }}
          >
            <DialogButton
              disabled={props.deleting}
              label="Cancel"
              onPress={props.onCancel}
            />
            <DialogButton
              danger
              disabled={props.deleting}
              label={props.deleting ? 'Deleting…' : 'Delete'}
              loading={props.deleting}
              onPress={props.onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DialogButton(props: {
  label: string;
  danger?: boolean;
  disabled: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 42,
        minWidth: 90,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: props.danger ? palette.danger : palette.line,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        opacity: props.disabled ? 0.65 : pressed ? 0.75 : 1,
        backgroundColor: props.danger ? palette.dangerSurface : palette.surface,
      })}
    >
      {props.loading ? (
        <ActivityIndicator color={palette.danger} size="small" />
      ) : null}
      <Text
        style={{
          color: props.danger ? palette.danger : palette.textSoft,
          fontSize: 14,
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
