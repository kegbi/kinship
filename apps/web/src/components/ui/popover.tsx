/**
 * shadcn/ui `popover` (base-nova, Base UI), restyled over the Kinship tokens
 * (GAP-053). Base UI owns what a popover must do: it opens from its trigger,
 * closes on Escape or a click outside, moves focus into the popup and back
 * to the trigger, and names the popup by its title.
 */

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  align = "end",
  className,
  children,
  sideOffset = 8,
  ...props
}: PopoverPrimitive.Popup.Props & {
  readonly align?: PopoverPrimitive.Positioner.Props["align"];
  readonly className?: string;
  readonly sideOffset?: number;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        className="isolate z-50"
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "grid max-h-[min(32rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] gap-(--space-3) overflow-auto rounded-(--radius-lg) border border-solid border-(--line-1) bg-popover p-(--space-4) text-popover-foreground shadow-(--shadow-2) outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverTitle({
  className,
  ...props
}: PopoverPrimitive.Title.Props & { className?: string }) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("m-0 text-[1rem] leading-[1.3] font-bold", className)}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverTitle, PopoverTrigger };
