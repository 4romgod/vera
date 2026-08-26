import { Text, View } from 'react-native';

export function StructuredValue(props: { value: unknown; depth?: number }) {
  const depth = props.depth ?? 0;
  if (props.value === null || typeof props.value !== 'object') {
    return (
      <Text
        selectable
        style={{ color: '#d5ddd9', fontSize: 12, lineHeight: 18 }}
      >
        {formatPrimitive(props.value)}
      </Text>
    );
  }

  if (Array.isArray(props.value)) {
    const values = props.value as readonly unknown[];
    if (values.length === 0) return <EmptyValue label="None" />;
    return (
      <View style={{ gap: 7 }}>
        {values.map((item, index) => (
          <View
            // Approval arguments are immutable snapshots, so their position is
            // a stable identity within this rendered value.
            key={index}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
          >
            <Text selectable style={{ color: '#64716b', fontSize: 11 }}>
              {index + 1}.
            </Text>
            <View style={{ minWidth: 0, flex: 1 }}>
              <StructuredValue depth={depth + 1} value={item} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const entries = Object.entries(props.value as Record<string, unknown>);
  if (entries.length === 0) return <EmptyValue label="No fields" />;
  return (
    <View style={{ gap: depth === 0 ? 10 : 7 }}>
      {entries.map(([key, value]) => (
        <View
          key={key}
          style={{
            gap: 4,
            borderLeftWidth: depth === 0 ? 0 : 1,
            borderLeftColor: '#2a3832',
            paddingLeft: depth === 0 ? 0 : 10,
          }}
        >
          <Text selectable style={{ color: '#6f7d76', fontSize: 9 }}>
            {humanize(key).toUpperCase()}
          </Text>
          <StructuredValue depth={depth + 1} value={value} />
        </View>
      ))}
    </View>
  );
}

function EmptyValue(props: { label: string }) {
  return (
    <Text
      selectable
      style={{ color: '#75817b', fontSize: 12, fontStyle: 'italic' }}
    >
      {props.label}
    </Text>
  );
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'None';
  if (value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return 'Unsupported value';
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/([a-z0-9])([A-Z])/gu, '$1 $2');
}
