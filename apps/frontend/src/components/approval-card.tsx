import { Pressable, Text, View } from 'react-native';

import type { TaskResource } from '@vera/client';

import { StructuredValue } from '@/components/structured-value';

type Approval = NonNullable<TaskResource['approval']>;

export function ApprovalCard(props: {
  approval: Approval;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
}) {
  const effects = props.approval.authority?.sideEffects ?? [];
  return (
    <View
      style={{
        gap: 14,
        borderWidth: 1,
        borderColor: '#356352',
        borderCurve: 'continuous',
        borderRadius: 18,
        padding: 18,
        backgroundColor: '#101a17',
      }}
    >
      <View style={{ gap: 4 }}>
        <Text
          selectable
          style={{ color: '#65d6aa', fontSize: 11, fontWeight: '700' }}
        >
          YOUR APPROVAL IS REQUIRED
        </Text>
        <Text selectable style={{ color: '#f1f5f3', fontSize: 20 }}>
          {props.approval.capability.name.replaceAll('_', ' ')}
        </Text>
        <Text selectable style={{ color: '#98a49f', lineHeight: 20 }}>
          Vera will execute only the exact arguments and authority shown here.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Fact
          label="Destination"
          value={props.approval.destination?.adapterId ?? 'local'}
        />
        <Fact
          label="Network"
          value={props.approval.authority?.networkAccess ?? 'none'}
        />
        <Fact
          label="Effects"
          value={effects.length === 0 ? 'read only' : effects.join(', ')}
        />
      </View>

      <View
        style={{
          gap: 10,
          borderWidth: 1,
          borderColor: '#1f2b26',
          borderRadius: 12,
          padding: 14,
          backgroundColor: '#090e0c',
        }}
      >
        <Text selectable style={{ color: '#6f7d76', fontSize: 9 }}>
          EXACT ARGUMENTS
        </Text>
        <StructuredValue value={props.approval.proposedArguments} />
      </View>

      <View
        style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}
      >
        <ActionButton
          disabled={props.busy}
          label="Reject"
          secondary
          onPress={() => props.onDecision('rejected')}
        />
        <ActionButton
          disabled={props.busy}
          label="Approve exact action"
          onPress={() => props.onDecision('approved')}
        />
      </View>
    </View>
  );
}

function Fact(props: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 120, flexGrow: 1, gap: 3 }}>
      <Text selectable style={{ color: '#66736e', fontSize: 10 }}>
        {props.label.toUpperCase()}
      </Text>
      <Text selectable style={{ color: '#d5ddd9', fontSize: 12 }}>
        {props.value}
      </Text>
    </View>
  );
}

function ActionButton(props: {
  label: string;
  disabled: boolean;
  secondary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: props.secondary ? '#344039' : '#54c99d',
        borderCurve: 'continuous',
        borderRadius: 11,
        paddingHorizontal: 14,
        paddingVertical: 10,
        opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1,
        backgroundColor: props.secondary ? 'transparent' : '#173e31',
      })}
    >
      <Text
        selectable
        style={{
          color: props.secondary ? '#aab4af' : '#dff8ee',
          fontWeight: '600',
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
