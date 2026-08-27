import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowUpRight,
  Brain,
  Clock3,
  Search,
  Sparkles,
} from 'lucide-react-native';
import {
  ActivityIndicator,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  Text,
  View,
  type FlatList as FlatListType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { ConversationMessageResource, TaskResource } from '@vera/client';

import { palette, radius, spacing } from '@/design/tokens';
import { ConversationMessage } from './conversation-message';
import {
  PULL_REFRESH_TRIGGER_DISTANCE,
  pullRefreshDistance,
  shouldTriggerPullRefresh,
} from './pull-to-refresh';

const starters = [
  { icon: Brain, label: 'Remember something', prompt: 'Remember that ' },
  { icon: Clock3, label: 'Plan my day', prompt: 'Help me plan my day. ' },
  { icon: Search, label: 'Research a topic', prompt: 'Research ' },
  {
    icon: ArrowUpRight,
    label: 'Continue a project',
    prompt: 'Continue work on ',
  },
] as const;

export const ConversationView = forwardRef<
  FlatListType<ConversationMessageResource>,
  {
    messages: ConversationMessageResource[];
    taskDetails: ReadonlyMap<string, TaskResource | null>;
    speakingMessageId?: string;
    footer?: ReactNode;
    compact: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    onSuggestion: (prompt: string) => void;
    onSpeak: (message: ConversationMessageResource) => void;
  }
>(function ConversationView(props, ref) {
  const webRefresh = useWebPullToRefresh({
    initiallyAtTop: props.messages.length === 0,
    refreshing: props.refreshing,
    onRefresh: props.onRefresh,
  });
  return (
    <View {...webRefresh.panHandlers} style={{ minHeight: 0, flex: 1 }}>
      {process.env.EXPO_OS !== 'web' ||
      (!props.refreshing && webRefresh.distance === 0) ? null : (
        <View
          accessibilityLiveRegion="polite"
          style={{
            height: props.refreshing ? 44 : webRefresh.distance,
            minHeight: 0,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {props.refreshing ? (
            <ActivityIndicator color={palette.accent} size="small" />
          ) : (
            <Text
              selectable
              style={{ color: palette.muted, fontSize: 11, fontWeight: '600' }}
            >
              {webRefresh.distance >= PULL_REFRESH_TRIGGER_DISTANCE
                ? 'Release to refresh'
                : 'Pull to refresh'}
            </Text>
          )}
        </View>
      )}
      <FlatList
        ref={ref}
        contentContainerStyle={{
          width: '100%',
          maxWidth: 860,
          flexGrow: 1,
          alignSelf: 'center',
          gap: spacing.xxl,
          paddingHorizontal: props.compact ? spacing.lg : spacing.xxxl,
          paddingTop: props.compact ? spacing.xxl : 44,
          paddingBottom: spacing.xxxl,
        }}
        contentInsetAdjustmentBehavior="automatic"
        data={props.messages}
        keyExtractor={(message) => message.id}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyConversation
            compact={props.compact}
            onSuggestion={props.onSuggestion}
          />
        }
        ListFooterComponent={
          props.footer === undefined ? null : (
            <View style={{ paddingTop: spacing.sm }}>{props.footer}</View>
          )
        }
        onContentSizeChange={() => {
          if (
            props.messages.length > 0 &&
            ref !== null &&
            typeof ref !== 'function'
          ) {
            ref.current?.scrollToEnd({ animated: true });
          }
        }}
        onScroll={webRefresh.onScroll}
        refreshControl={
          process.env.EXPO_OS === 'web' ? undefined : (
            <RefreshControl
              colors={[palette.accent]}
              onRefresh={props.onRefresh}
              progressBackgroundColor={palette.surface}
              refreshing={props.refreshing}
              tintColor={palette.accent}
              title="Refreshing Vera"
              titleColor={palette.muted}
            />
          )
        }
        renderItem={({ item }) => (
          <ConversationMessage
            message={item}
            speaking={props.speakingMessageId === item.id}
            task={
              item.taskId === undefined
                ? undefined
                : props.taskDetails.get(item.taskId)
            }
            onSpeak={() => props.onSpeak(item)}
          />
        )}
        scrollEventThrottle={16}
      />
    </View>
  );
});

function useWebPullToRefresh(props: {
  initiallyAtTop: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [distance, setDistance] = useState(0);
  const atTop = useRef(props.initiallyAtTop);
  const refreshing = useRef(props.refreshing);
  const onRefresh = useRef(props.onRefresh);
  refreshing.current = props.refreshing;
  onRefresh.current = props.onRefresh;

  useEffect(() => {
    if (!props.refreshing) setDistance(0);
  }, [props.refreshing]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          process.env.EXPO_OS === 'web' &&
          !refreshing.current &&
          atTop.current &&
          gesture.dy > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          setDistance(pullRefreshDistance(gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          const releasedDistance = pullRefreshDistance(gesture.dy);
          if (
            !refreshing.current &&
            shouldTriggerPullRefresh(releasedDistance)
          ) {
            setDistance(PULL_REFRESH_TRIGGER_DISTANCE);
            onRefresh.current();
          } else {
            setDistance(0);
          }
        },
        onPanResponderTerminate: () => setDistance(0),
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  return {
    distance,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTop.current = event.nativeEvent.contentOffset.y <= 0;
    },
    panHandlers:
      process.env.EXPO_OS === 'web' ? panResponder.panHandlers : undefined,
  };
}

function EmptyConversation(props: {
  compact: boolean;
  onSuggestion: (prompt: string) => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xl,
        paddingVertical: props.compact ? 54 : 80,
      }}
    >
      <LinearGradient
        colors={['rgba(167,129,30,0.18)', 'rgba(9,11,14,0)']}
        style={{
          position: 'absolute',
          top: '14%',
          width: 360,
          height: 280,
          borderRadius: 180,
          pointerEvents: 'none',
        }}
      />
      <View
        style={{
          width: 58,
          height: 58,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: palette.accentLine,
          borderRadius: radius.lg,
          backgroundColor: palette.accentSurface,
        }}
      >
        <Sparkles color={palette.accent} size={26} strokeWidth={1.7} />
      </View>
      <View style={{ maxWidth: 540, alignItems: 'center', gap: spacing.md }}>
        <Text
          selectable
          style={{
            color: palette.accent,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 1.2,
          }}
        >
          READY WHEN YOU ARE
        </Text>
        <Text
          selectable
          style={{
            color: palette.text,
            fontSize: props.compact ? 29 : 36,
            fontWeight: '600',
            letterSpacing: -1,
            lineHeight: props.compact ? 36 : 43,
            textAlign: 'center',
          }}
        >
          What should we get done?
        </Text>
        <Text
          selectable
          style={{
            color: palette.muted,
            fontSize: 14,
            lineHeight: 22,
            textAlign: 'center',
          }}
        >
          Start with what you want. Vera will decide what should happen next and
          keep you in control.
        </Text>
      </View>
      <View
        style={{
          width: '100%',
          maxWidth: 560,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: spacing.sm,
        }}
      >
        {starters.map((starter) => {
          const Icon = starter.icon;
          return (
            <Pressable
              accessibilityRole="button"
              key={starter.label}
              onPress={() => props.onSuggestion(starter.prompt)}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: palette.lineSoft,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                opacity: pressed ? 0.68 : 1,
                backgroundColor: palette.surface,
              })}
            >
              <Icon color={palette.accent} size={15} strokeWidth={1.8} />
              <Text style={{ color: palette.textSoft, fontSize: 12 }}>
                {starter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
