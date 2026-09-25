/**
 * `cn`: the class-name merger every shadcn/ui component imports through the
 * `utils` alias in `apps/web/components.json`. `clsx` accepts conditional
 * classes; `tailwind-merge` lets a later utility override a conflicting one,
 * which is how an island adjusts a vendored component's default look.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
