import { useState } from 'react';
import {
  Check,
  ChevronDown,
  FolderKanban,
  UserRound,
  X,
} from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ProjectResource } from '@vera/client';

import { IconButton } from '@/components/ui/icon-button';
import { palette, radius, shadow, spacing } from '@/design/tokens';
import { projectContextLabel } from './presentation';

export function ProjectContextMenu(props: {
  projects: ProjectResource[];
  selected?: string;
  onSelect: (projectId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const label = projectContextLabel(props.selected, props.projects);

  return (
    <>
      <Pressable
        accessibilityLabel={`Context: ${label}`}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 40,
          maxWidth: 220,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: palette.lineSoft,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.7 : 1,
          backgroundColor: palette.surface,
        })}
      >
        {props.selected === undefined ? (
          <UserRound color={palette.accent} size={16} strokeWidth={1.8} />
        ) : (
          <FolderKanban color={palette.accent} size={16} strokeWidth={1.8} />
        )}
        <Text
          numberOfLines={1}
          selectable
          style={{
            minWidth: 0,
            flexShrink: 1,
            color: palette.textSoft,
            fontSize: 13,
          }}
        >
          {label}
        </Text>
        <ChevronDown color={palette.muted} size={15} strokeWidth={1.8} />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: palette.scrim,
          }}
        >
          <Pressable
            accessibilityLabel="Close project context"
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
            }}
          />
          <View
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: '78%',
              alignSelf: 'center',
              gap: spacing.lg,
              borderWidth: 1,
              borderColor: palette.line,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.xl),
              backgroundColor: palette.canvasRaised,
              boxShadow: shadow.floating,
            }}
          >
            <View
              style={{
                width: 42,
                height: 4,
                alignSelf: 'center',
                borderRadius: radius.pill,
                backgroundColor: palette.line,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text
                  selectable
                  style={{
                    color: palette.text,
                    fontSize: 20,
                    fontWeight: '700',
                  }}
                >
                  Conversation context
                </Text>
                <Text
                  selectable
                  style={{ color: palette.muted, fontSize: 13, lineHeight: 19 }}
                >
                  Vera uses this scope for the next message you send.
                </Text>
              </View>
              <IconButton
                icon={X}
                label="Close project context"
                onPress={() => setOpen(false)}
              />
            </View>
            <ScrollView
              contentContainerStyle={{ gap: spacing.sm }}
              contentInsetAdjustmentBehavior="automatic"
            >
              <ContextOption
                description="Personal memory and general assistance"
                icon={UserRound}
                label="Personal"
                selected={props.selected === undefined}
                onPress={() => {
                  props.onSelect(undefined);
                  setOpen(false);
                }}
              />
              {props.projects.map((project) => (
                <ContextOption
                  description="Project-aware assistance"
                  icon={FolderKanban}
                  key={project.id}
                  label={project.displayName}
                  selected={props.selected === project.id}
                  onPress={() => {
                    props.onSelect(project.id);
                    setOpen(false);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ContextOption(props: {
  description: string;
  icon: typeof UserRound;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 66,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderWidth: 1,
        borderColor: props.selected ? palette.accentLine : palette.lineSoft,
        borderRadius: radius.lg,
        padding: spacing.md,
        opacity: pressed ? 0.72 : 1,
        backgroundColor: props.selected
          ? palette.accentSurface
          : palette.surface,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.md,
          backgroundColor: palette.surfaceStrong,
        }}
      >
        <Icon
          color={props.selected ? palette.accent : palette.textSoft}
          size={19}
          strokeWidth={1.8}
        />
      </View>
      <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          selectable
          style={{ color: palette.text, fontSize: 15, fontWeight: '600' }}
        >
          {props.label}
        </Text>
        <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
          {props.description}
        </Text>
      </View>
      {props.selected ? (
        <Check color={palette.accent} size={19} strokeWidth={2} />
      ) : null}
    </Pressable>
  );
}
