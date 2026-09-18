/**
 * @yohobed/ui — the YohoBed design system.
 *
 * Source-only: consumers add `@yohobed/ui` to `transpilePackages` and point their Tailwind
 * `content` glob at `packages/ui/src`. There is no build step, so a component edit is live in
 * the app's dev server immediately and `'use client'` boundaries survive untouched.
 *
 * Styling is entirely through the app's CSS custom-property tokens (`--brand`, `--brass`,
 * `--ink`, `--surface`, `--avail`…) plus the shared Tailwind preset
 * (`@yohobed/ui/tailwind-preset`): swap the variables and every component follows both themes
 * without a single class change.
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
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  type DialogContentProps,
} from './primitives/dialog';
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
  MenuSubContent,
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
  Textarea,
  Field,
  type FieldProps,
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectSeparator,
  Switch,
  Checkbox,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './primitives/form';
export { SegmentedControl, type SegmentedOption } from './primitives/segmented';
export {
  Card,
  Badge,
  type BadgeProps,
  type Tone,
  Kbd,
  Skeleton,
  EmptyState,
  PageHeader,
} from './primitives/surfaces';

// Patterns
export { CountedChips, type Chip } from './patterns/counted-chips';
export { MoneyFooter, MetricFooter, type MetricColumn } from './patterns/footers';
export { DataGrid, type ColumnDef } from './patterns/data-grid';
export { AuditTrailDrawer, type AuditEntry } from './patterns/audit-trail';
export { StatCard } from './patterns/stat-card';
export { Toaster, toast } from './patterns/toaster';
export { TagChip, TagDot, TagColorPicker, TAG_COLOR_KEYS, tagBarClasses } from './patterns/tag';

// Reservation desk (Development Phase 02)
export { Calendar, type CalendarProps } from './patterns/calendar';
export {
  DatePicker,
  TimePicker,
  StayRangeField,
  type DatePickerProps,
  type TimePickerProps,
  type StayRange,
  type StayRangeFieldProps,
} from './patterns/date-time';
export {
  NumberStepper,
  Combobox,
  CountrySelect,
  countryOptions,
  PhoneInput,
  InlineAlert,
  SummaryList,
  type NumberStepperProps,
  type ComboboxOption,
  type ComboboxProps,
  type PhoneValue,
  type PhoneInputProps,
  type AlertTone,
  type SummaryRow,
} from './patterns/inputs';
export { ConfirmDialog, type ConfirmDialogProps } from './patterns/confirm-dialog';
