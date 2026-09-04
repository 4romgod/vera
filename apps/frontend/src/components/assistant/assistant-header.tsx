import { Menu, RefreshCw, Sparkles } from 'lucide-react-native';
import { Text, View } from 'react-native';

import type { ProjectResource } from '@vera/client';

import { IconButton } from '@/components/ui/icon-button';
import { palette, spacing } from '@/design/tokens';
import { displayConversationTitle } from './presentation.ts';
import { ProjectContextMenu } from './project-context-menu.tsx';

export function AssistantHeader(props: {
  compact: boolean;
  title?: string;
  projects: ProjectResource[];
  selectedProjectId?: string;
  attentionItems: number;
  refreshing: boolean;
  onMenu: () => void;
  onRefresh: () => void;
  onResources: () => void;
  onSelectProject: (projectId?: string) => void;
}) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: palette.lineSoft,
        backgroundColor: palette.canvasRaised,
      }}
    >
      {props.compact ? (
        <View
          style={{
            minHeight: 60,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.md,
          }}
        >
          <IconButton
            icon={Menu}
            label="Open conversations"
            onPress={props.onMenu}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: palette.accentSurfaceStrong,
              }}
            >
              <Sparkles color={palette.accent} size={14} strokeWidth={2} />
            </View>
            <Text
              selectable
              style={{
                color: palette.text,
                fontSize: 18,
                fontWeight: '700',
                letterSpacing: -0.4,
              }}
            >
              Vera
            </Text>
          </View>
          <View>
            <IconButton
              icon={Sparkles}
              label="Open your Vera"
              onPress={props.onResources}
            />
            {props.attentionItems > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  minWidth: 16,
                  height: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: palette.canvasRaised,
                  borderRadius: 8,
                  paddingHorizontal: 3,
                  backgroundColor: palette.accent,
                }}
              >
                <Text
                  style={{
                    color: palette.canvas,
                    fontSize: 8,
                    fontWeight: '800',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {Math.min(props.attentionItems, 9)}
                  {props.attentionItems > 9 ? '+' : ''}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <View
        style={{
          minHeight: 72,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.lg,
          paddingHorizontal: props.compact ? spacing.lg : spacing.xxl,
          paddingVertical: spacing.md,
        }}
      >
        <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
          <Text
            selectable
            style={{
              color: palette.muted,
              fontSize: 11,
              fontWeight: '600',
              letterSpacing: 0.8,
            }}
          >
            {props.title === undefined ? 'START SOMETHING' : 'CONVERSATION'}
          </Text>
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: palette.text,
              fontSize: props.compact ? 18 : 21,
              fontWeight: '700',
              letterSpacing: -0.35,
            }}
          >
            {displayConversationTitle(props.title)}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <ProjectContextMenu
            projects={props.projects}
            selected={props.selectedProjectId}
            onSelect={props.onSelectProject}
          />
          <IconButton
            disabled={props.refreshing}
            icon={RefreshCw}
            label={props.refreshing ? 'Refreshing Vera' : 'Refresh Vera'}
            onPress={props.onRefresh}
          />
        </View>
      </View>
    </View>
  );
}
