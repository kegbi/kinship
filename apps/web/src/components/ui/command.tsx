/**
 * shadcn/ui `command` (base-nova, cmdk), restyled over the Kinship tokens.
 *
 * Only the parts a surface renders are vendored: the root, the list, and its
 * items. `CommandInput` and `CommandDialog` are left out: the people palette owns its input (it moves
 * between the header and the dialog and keeps the id the flows address), and
 * it composes `Command` inside the Base UI `Dialog` itself.
 */

import * as React from "react";
import {
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandRoot as CommandPrimitive,
  useCommandState,
} from "cmdk";
import { cn } from "@/lib/utils";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("grid min-w-0 gap-(--space-3) outline-none", className)}
      {...props}
    />
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandListPrimitive>) {
  return (
    <CommandListPrimitive
      data-slot="command-list"
      className={cn(
        "min-w-0 outline-none **:[[cmdk-list-sizer]]:grid **:[[cmdk-list-sizer]]:gap-(--space-1)",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandItemPrimitive>) {
  return (
    <CommandItemPrimitive
      data-slot="command-item"
      className={cn(
        "grid min-h-13 min-w-0 cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-(--space-3) rounded-(--radius-md) px-(--space-3) py-(--space-2) select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-55 data-[selected=true]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandItem, CommandList, useCommandState };
