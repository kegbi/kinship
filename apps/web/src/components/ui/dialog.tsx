/**
 * shadcn/ui `dialog` (base-nova, Base UI), restyled over the Kinship tokens.
 * The popup carries no built-in close icon: a Kinship dialog names its close
 * action in words through `DialogClose`. `DialogContent` can keep its portal
 * mounted, which upstream does not offer.
 */

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props & { className?: string }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[color-mix(in_srgb,var(--ink-1)_55%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  keepMounted = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  className?: string;
  /** Keeps the closed popup in the document, hidden, so opening it draws its
   * content in the same commit. */
  keepMounted?: boolean;
}) {
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 gap-(--space-3) overflow-auto rounded-(--radius-lg) border border-solid border-(--line-1) bg-popover p-(--space-5) text-popover-foreground shadow-(--shadow-2) outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props & { className?: string }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 text-[1.15rem] leading-[1.3] font-bold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props & { className?: string }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("m-0", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
};
