/** Base UI combobox parts, styled over the same tokens as the header palette. */
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { cn } from "@/lib/utils.ts";

const Combobox = ComboboxPrimitive.Root;
const ComboboxInput = ComboboxPrimitive.Input;

function ComboboxList(
  { className, ...props }: ComboboxPrimitive.List.Props & {
    className?: string;
  },
) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        "max-h-64 overflow-y-auto rounded-(--radius-sm) border border-solid border-(--line-1) bg-popover p-1 text-popover-foreground shadow-(--shadow-2)",
        className,
      )}
      data-slot="combobox-list"
      {...props}
    />
  );
}

function ComboboxItem(
  { className, ...props }: ComboboxPrimitive.Item.Props & {
    className?: string;
  },
) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "grid min-h-13 min-w-0 cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-(--space-3) rounded-(--radius-md) px-(--space-3) py-(--space-2) outline-none select-none data-highlighted:bg-muted",
        className,
      )}
      data-slot="combobox-item"
      {...props}
    />
  );
}

export { Combobox, ComboboxInput, ComboboxItem, ComboboxList };
