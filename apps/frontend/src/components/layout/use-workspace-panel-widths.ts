import { layout } from '@/design/tokens';
import { usePanelWidth } from './panel-width.ts';
import { clampPanelWidth } from './panel-width-values.ts';

export function useWorkspacePanelWidths(
  viewportWidth: number,
  inspectorOpen: boolean,
) {
  const sidebar = usePanelWidth(
    'vera.layout.sidebar-width',
    layout.sidebarWidth,
  );
  const inspector = usePanelWidth(
    'vera.layout.inspector-width',
    layout.inspectorWidth,
  );
  const unconstrainedInspectorWidth = clampPanelWidth(
    inspector.width,
    layout.inspectorMinWidth,
    layout.inspectorMaxWidth,
  );
  const sidebarMaximumWidth = Math.min(
    layout.sidebarMaxWidth,
    viewportWidth -
      layout.conversationMinWidth -
      (inspectorOpen ? unconstrainedInspectorWidth : 0),
  );
  const sidebarWidth = clampPanelWidth(
    sidebar.width,
    layout.sidebarMinWidth,
    sidebarMaximumWidth,
  );
  const inspectorMaximumWidth = Math.min(
    layout.inspectorMaxWidth,
    viewportWidth - layout.conversationMinWidth - sidebarWidth,
  );

  return {
    sidebar: {
      width: sidebarWidth,
      minimumWidth: layout.sidebarMinWidth,
      maximumWidth: sidebarMaximumWidth,
      onResize: sidebar.setWidth,
      onResizeEnd: sidebar.persist,
    },
    inspector: {
      width: clampPanelWidth(
        inspector.width,
        layout.inspectorMinWidth,
        inspectorMaximumWidth,
      ),
      minimumWidth: layout.inspectorMinWidth,
      maximumWidth: inspectorMaximumWidth,
      onResize: inspector.setWidth,
      onResizeEnd: inspector.persist,
    },
  };
}
