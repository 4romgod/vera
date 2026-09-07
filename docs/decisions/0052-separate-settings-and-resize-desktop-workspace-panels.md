# ADR-0052: Separate settings and resize desktop workspace panels

**Status:** Accepted
**Date:** 6 September 2026

## Context

Vera's right inspector accumulated both active resources and configuration.
Voice and integration setup appeared beside Today, Memory, Tasks, and Activity,
making settings harder to find and forcing a long horizontal tab row into a
narrow panel. The desktop conversation list and inspector also had fixed widths,
even though available screen space and owner preferences vary substantially.

Mobile drawers and sheets should remain touch-oriented. Desktop users, however,
expect pointer-resizable panels and enough space for their current task.

## Decision

Settings is a dedicated universal frontend route. Its first domains are Voice,
Connections, and Notifications, exposed as accessible, deep-linkable tabs.
Today, Memory, Tasks, Activity, Knowledge, Reminders, Machines, Routines,
Missions, and Campaigns remain workspaces or contextual resources rather than
settings.

On pointer-precise web layouts, the conversation sidebar's right border and the
resource inspector's left border are drag handles. Each handle:

- advertises horizontal resize through the pointer cursor and hover treatment;
- supports accessibility increment and decrement actions;
- clamps its panel to explicit minimum and maximum widths;
- reserves a minimum conversation width; and
- persists only the final width in device-local storage.

Compact layouts retain the existing modal conversation drawer and bottom-sheet
resource inspector. They do not expose drag handles or inherit desktop widths.

## Rationale

A full settings destination scales to more configuration domains without
polluting the assistant workspace or compressing controls into an inspector.
Bounded resizing gives desktop owners agency without allowing either sidebar to
make the core conversation unusable. Device-local persistence matches a layout
preference better than server-owned operational state.

## Consequences

- The main sidebar contains primary workspaces plus one Settings destination.
- Connection management and notification preferences no longer compete with
  activity content.
- The right inspector's tab strip is shorter and has explicit vertical breathing
  room, preventing pill borders from being visually clipped.
- Clearing site data resets remembered desktop widths.
- A future settings domain can be added without adding another main-workspace
  destination.
