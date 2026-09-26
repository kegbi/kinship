import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type ButtonVariantProps, buttonVariants } from "./variants.ts";

function Button({
  className,
  shape = "default",
  variant = "default",
  ...props
}: ButtonPrimitive.Props & ButtonVariantProps & { className?: string }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({
        shape,
        variant,
        ...(className ? { className } : {}),
      })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
