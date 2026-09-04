import { Modal, Pressable, View } from 'react-native';
import { palette } from '@/design/tokens';
import { PanelContent } from './resource-panel/content.tsx';
import type { ResourcePanelProps } from './resource-panel/contracts.ts';

export type {
  ResourcePanelProps,
  ResourceTab,
} from './resource-panel/contracts.ts';

export function ResourcePanel(props: ResourcePanelProps) {
  if (!props.open) return null;
  const content = <PanelContent {...props} />;
  if (!props.compact) return content;
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: palette.scrim,
        }}
      >
        <Pressable
          accessibilityLabel="Close your Vera"
          accessibilityRole="button"
          onPress={props.onClose}
          style={{ flex: 1 }}
        />
        {content}
      </View>
    </Modal>
  );
}
