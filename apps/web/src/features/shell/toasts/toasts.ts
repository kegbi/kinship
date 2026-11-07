/**
 * The application's one toast stack (GAP-033).
 *
 * `ApplicationLayout.astro` draws the permanent `#app-toasts` list and one
 * toast `<template>`; this module clones that template per toast and owns
 * the stack's rules: at most three items, info, success, and warning toasts
 * dismissed after six seconds, errors kept until dismissed, every timer
 * paused while the region is hovered or focused, and focus moved to the last
 * remaining toast when a focused one leaves. Islands announce through
 * `islands/core/toast.ts`, which calls `showToast` here.
 */

import { cloneTemplate, TOAST_TEMPLATE_ID } from "../templates.ts";

export type ToastTone = "error" | "info" | "success" | "warning";

export interface ToastAction {
  readonly label: string;
  onSelect(): void;
}

export interface ToastOptions {
  readonly action?: ToastAction;
  readonly message: string;
  readonly tone?: ToastTone;
}

interface ToastRecord {
  readonly item: HTMLLIElement;
  timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  readonly tone: ToastTone;
}

interface RegionState {
  focused: boolean;
  hovered: boolean;
}

const AUTO_DISMISS_MS = 6_000;
const MAX_TOASTS = 3;
const records = new Map<HTMLLIElement, ToastRecord>();
const regionStates = new WeakMap<HTMLElement, RegionState>();

function clearTimer(record: ToastRecord): void {
  if (record.timer === undefined) return;
  globalThis.clearTimeout(record.timer);
  record.timer = undefined;
}

function removeToast(item: Element): void {
  const record = records.get(item as HTMLLIElement);
  if (record) {
    clearTimer(record);
    records.delete(record.item);
  }
  const region = item.parentElement;
  const containedFocus = item.contains(document.activeElement);
  item.remove();
  if (!containedFocus || !region) return;
  const remaining = region.querySelectorAll<HTMLButtonElement>(
    ":scope > .app-toast .app-toast-dismiss",
  );
  remaining.item(remaining.length - 1)?.focus();
}

function regionIsPaused(item: HTMLLIElement): boolean {
  // Only a connected toast is scheduled, so its region is its parent.
  const state = regionStates.get(item.parentElement!);
  return state?.focused === true || state?.hovered === true;
}

function schedule(record: ToastRecord): void {
  if (
    record.tone === "error" ||
    record.timer !== undefined ||
    !record.item.isConnected ||
    regionIsPaused(record.item)
  ) return;
  record.timer = globalThis.setTimeout(
    () => removeToast(record.item),
    AUTO_DISMISS_MS,
  );
}

function pauseTimers(): void {
  for (const record of records.values()) clearTimer(record);
}

function restartTimers(): void {
  // Restarting the full duration keeps pause handling deliberately simple.
  for (const record of records.values()) schedule(record);
}

function mountRegionEvents(region: HTMLElement): void {
  if (regionStates.has(region)) return;
  const state: RegionState = { focused: false, hovered: false };
  regionStates.set(region, state);
  region.addEventListener("pointerenter", () => {
    state.hovered = true;
    pauseTimers();
  });
  region.addEventListener("pointerleave", () => {
    state.hovered = false;
    if (!state.focused) restartTimers();
  });
  region.addEventListener("focusin", () => {
    state.focused = true;
    pauseTimers();
  });
  region.addEventListener("focusout", (event) => {
    const next = (event as FocusEvent).relatedTarget;
    state.focused = next instanceof Node && region.contains(next);
    if (!state.focused && !state.hovered) restartTimers();
  });
}

/**
 * Adds a toast to `#app-toasts`; a page without the region or its template
 * ignores it.
 */
export function showToast(options: ToastOptions): void {
  const region = document.querySelector<HTMLElement>("#app-toasts");
  const item = region
    ? cloneTemplate(TOAST_TEMPLATE_ID)?.firstElementChild
    : undefined;
  if (!region || !(item instanceof HTMLLIElement)) return;
  mountRegionEvents(region);

  // Errors stay persistent, but they still yield to the three-item stack cap.
  while (region.children.length >= MAX_TOASTS) {
    removeToast(region.firstElementChild!);
  }

  const tone = options.tone ?? "info";
  item.dataset.tone = tone;
  item.querySelector(".app-toast-message")!.textContent = options.message;
  const action = item.querySelector<HTMLButtonElement>(".app-toast-action")!;
  if (options.action) {
    const { label, onSelect } = options.action;
    action.textContent = label;
    action.addEventListener("click", () => {
      try {
        onSelect();
      } finally {
        removeToast(item);
      }
    });
  } else {
    action.remove();
  }
  item.querySelector(".app-toast-dismiss")!.addEventListener(
    "click",
    () => removeToast(item),
  );

  const record: ToastRecord = { item, timer: undefined, tone };
  records.set(item, record);
  region.append(item);
  schedule(record);
}

/**
 * Adds a toast unless the region still shows one with the same message, so a
 * failure that every retry repeats is said once until it is dismissed
 * (AUD-F2).
 */
export function showToastOnce(options: ToastOptions): void {
  const shown = document.querySelectorAll(
    "#app-toasts > .app-toast > .app-toast-message",
  );
  if ([...shown].some((message) => message.textContent === options.message)) {
    return;
  }
  showToast(options);
}

/** Removes every toast and its pending timer. */
export function clearToasts(): void {
  for (const record of [...records.values()]) removeToast(record.item);
  document.querySelector("#app-toasts")?.replaceChildren();
}
