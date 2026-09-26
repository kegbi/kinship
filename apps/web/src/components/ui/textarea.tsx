import * as React from "react";
import { fieldVariants } from "./variants.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={fieldVariants({
        multiline: true,
        ...(className ? { className } : {}),
      })}
      {...props}
    />
  );
}

export { Textarea };
