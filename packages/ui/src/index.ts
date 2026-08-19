/**
 * @yohobed/ui — the YohoBed design system.
 *
 * Source-only: consumers add `@yohobed/ui` to `transpilePackages` and point their Tailwind
 * `content` glob at `packages/ui/src`. There is no build step, so a component edit is live in
 * the app's dev server immediately and `'use client'` boundaries survive untouched.
 *
 * Styling is entirely through the app's CSS custom-property tokens (`--brand`, `--ink`,
 * `--surface`, `--avail`…), which is what keeps the dark-by-default theme working: swap the
 * variables, and every component follows without a single class change.
 */

export { cn } from './lib/cn';

// Primitives
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './primitives/button';
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  type SheetContentProps,
  type SheetSide,
} from './primitives/sheet';
export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuLabel,
  MenuSeparator,
  MenuGroup,
  MenuSub,
  MenuSubTrigger,
} from './primitives/menu';
export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from './primitives/overlays';
export {
  Input,
  Field,
  type FieldProps,
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  Switch,
  Checkbox,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './primitives/form';
export {
  Card,
  Badge,
  type BadgeProps,
  type Tone,
  Skeleton,
  EmptyState,
  PageHeader,
} from './primitives/surfaces';

// Patterns
export { CountedChips, type Chip } from './patterns/counted-chips';
export { MoneyFooter, MetricFooter, type MetricColumn } from './patterns/footers';
export { DataGrid, type ColumnDef } from './patterns/data-grid';
export { AuditTrailDrawer, type AuditEntry } from './patterns/audit-trail';
