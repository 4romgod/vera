import type { ComponentType } from 'react';

type PanelResizeHandleProps = {
  edge: 'left' | 'right';
  width: number;
  minimumWidth: number;
  maximumWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
};

export const PanelResizeHandle: ComponentType<PanelResizeHandleProps> = () =>
  null;
