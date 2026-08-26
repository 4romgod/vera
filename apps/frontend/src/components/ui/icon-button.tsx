import { Pressable, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { layout, palette, radius } from '@/design/tokens';

export function IconButton(
  props: Omit<PressableProps, 'children' | 'style'> & {
    icon: LucideIcon;
    label: string;
    selected?: boolean;
    danger?: boolean;
    size?: number;
  },
) {
  const {
    danger = false,
    disabled,
    icon: Icon,
    label,
    selected,
    size = layout.touchTarget,
    ...pressableProps
  } = props;
  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{
        disabled: disabled === true,
        selected,
      }}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: selected ? palette.accent : palette.lineSoft,
        borderCurve: 'continuous',
        borderRadius: radius.md,
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        backgroundColor: danger
          ? palette.dangerSurface
          : selected
            ? palette.accentSurfaceStrong
            : palette.surface,
      })}
    >
      <Icon
        color={
          danger
            ? palette.danger
            : selected
              ? palette.accentStrong
              : palette.textSoft
        }
        size={20}
        strokeWidth={1.8}
      />
    </Pressable>
  );
}
