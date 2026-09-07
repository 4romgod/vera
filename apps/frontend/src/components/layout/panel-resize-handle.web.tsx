import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { palette } from '@/design/tokens';
import { clampPanelWidth } from './panel-width-values.ts';

const keyboardResizeStep = 24;
const webInteractionStyle = {
  cursor: 'col-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
} as unknown as ViewStyle;

type PanelResizeHandleProps = {
  edge: 'left' | 'right';
  width: number;
  minimumWidth: number;
  maximumWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
};

export function PanelResizeHandle(props: PanelResizeHandleProps) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const handleRef = useRef<ComponentRef<typeof Pressable>>(null);
  const current = useRef(props);
  current.current = props;

  function resizeByKeyboard(direction: -1 | 1) {
    const options = current.current;
    const edgeDirection = options.edge === 'right' ? 1 : -1;
    const next = clampPanelWidth(
      options.width + direction * edgeDirection * keyboardResizeStep,
      options.minimumWidth,
      options.maximumWidth,
    );
    options.onResize(next);
    options.onResizeEnd(next);
  }

  useEffect(() => {
    const element = handleRef.current as unknown as HTMLElement | null;
    if (!element) return;
    const resizeElement = element;

    let pointerId: number | undefined;
    let startX = 0;
    let startWidth = current.current.width;
    let latestWidth = startWidth;
    let previousBodyCursor = '';
    let previousBodyUserSelect = '';

    function restoreDocumentInteraction() {
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousBodyUserSelect;
    }

    function stopTracking() {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', finishPointerDrag);
      document.removeEventListener('pointercancel', finishPointerDrag);
      window.removeEventListener('blur', finishPointerDrag);
    }

    function finishPointerDrag(event?: Event) {
      if (pointerId === undefined) return;
      if (event instanceof PointerEvent && event.pointerId !== pointerId) {
        return;
      }

      if (
        typeof resizeElement.hasPointerCapture === 'function' &&
        resizeElement.hasPointerCapture(pointerId)
      ) {
        resizeElement.releasePointerCapture(pointerId);
      }
      pointerId = undefined;
      stopTracking();
      restoreDocumentInteraction();
      setActive(false);
      current.current.onResizeEnd(latestWidth);
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      const options = current.current;
      const edgeDirection = options.edge === 'right' ? 1 : -1;
      latestWidth = clampPanelWidth(
        startWidth + (event.clientX - startX) * edgeDirection,
        options.minimumWidth,
        options.maximumWidth,
      );
      options.onResize(latestWidth);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || pointerId !== undefined) return;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();

      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = current.current.width;
      latestWidth = startWidth;
      previousBodyCursor = document.body.style.cursor;
      previousBodyUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      try {
        resizeElement.setPointerCapture(pointerId);
      } catch {
        // Document-level listeners still keep the drag intact on older browsers.
      }
      document.addEventListener('pointermove', handlePointerMove, {
        passive: false,
      });
      document.addEventListener('pointerup', finishPointerDrag);
      document.addEventListener('pointercancel', finishPointerDrag);
      window.addEventListener('blur', finishPointerDrag);
      setActive(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      resizeByKeyboard(event.key === 'ArrowRight' ? 1 : -1);
    }

    resizeElement.addEventListener('pointerdown', handlePointerDown, {
      passive: false,
    });
    resizeElement.addEventListener('keydown', handleKeyDown);
    return () => {
      resizeElement.removeEventListener('pointerdown', handlePointerDown);
      resizeElement.removeEventListener('keydown', handleKeyDown);
      stopTracking();
      if (pointerId !== undefined) restoreDocumentInteraction();
    };
  }, []);

  const selected = active || hovered;
  return (
    <Pressable
      ref={handleRef}
      accessibilityActions={[
        { name: 'increment', label: 'Make panel wider' },
        { name: 'decrement', label: 'Make panel narrower' },
      ]}
      accessibilityLabel="Resize panel"
      accessibilityRole="adjustable"
      accessibilityValue={{
        min: props.minimumWidth,
        max: props.maximumWidth,
        now: Math.round(props.width),
      }}
      onAccessibilityAction={(event) => {
        resizeByKeyboard(event.nativeEvent.actionName === 'increment' ? 1 : -1);
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        {
          position: 'absolute',
          top: 0,
          bottom: 0,
          [props.edge]: -6,
          width: 12,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
        },
        webInteractionStyle,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          width: selected ? 3 : 1,
          height: '100%',
          backgroundColor: selected ? palette.accent : palette.lineSoft,
        }}
      />
    </Pressable>
  );
}
