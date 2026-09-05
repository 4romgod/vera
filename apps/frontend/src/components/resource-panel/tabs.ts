import {
  Bell,
  Brain,
  CalendarClock,
  CircleAlert,
  Library,
  ListChecks,
  Repeat2,
  Rocket,
  ServerCog,
  PlugZap,
} from 'lucide-react-native';
import type { ResourceTab } from './contracts.ts';

export const resourceTabs: {
  id: ResourceTab;
  label: string;
  icon: typeof Brain;
}[] = [
  { id: 'attention', label: 'Today', icon: CircleAlert },
  { id: 'connections', label: 'Connections', icon: PlugZap },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'knowledge', label: 'Knowledge', icon: Library },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'reminders', label: 'Reminders', icon: CalendarClock },
  { id: 'notifications', label: 'Activity', icon: Bell },
  { id: 'machines', label: 'Machines', icon: ServerCog },
  { id: 'routines', label: 'Routines', icon: Repeat2 },
  { id: 'missions', label: 'Missions', icon: Rocket },
  { id: 'campaigns', label: 'Campaigns', icon: Rocket },
];
