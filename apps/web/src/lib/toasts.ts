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

function removeToast(item: HTMLLIElement): void {
  const record = records.get(item);
  if (record) {
    clearTimer(record);
    records.delete(item);
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
  const region = item.parentElement;
  const state = region ? regionStates.get(region) : undefined;
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

export function showToast(options: ToastOptions): void {
  const region = document.querySelector<HTMLElement>("#app-toasts");
  if (!region) return;
  mountRegionEvents(region);

  // Errors stay persistent, but they still yield to the three-item stack cap.
  while (region.children.length >= MAX_TOASTS) {
    const oldest = region.firstElementChild;
    if (!(oldest instanceof HTMLLIElement)) {
      oldest?.remove();
      continue;
    }
    removeToast(oldest);
  }

  const item = document.createElement("li");
  item.className = "app-toast";
  const tone = options.tone ?? "info";
  item.dataset.tone = tone;

  const message = document.createElement("p");
  message.className = "app-toast-message";
  message.textContent = options.message;
  item.append(message);

  if (options.action) {
    const action = document.createElement("button");
    action.className = "app-toast-action";
    action.type = "button";
    action.textContent = options.action.label;
    action.addEventListener("click", () => {
      try {
        options.action?.onSelect();
      } finally {
        removeToast(item);
      }
    });
    item.append(action);
  }

  const dismiss = document.createElement("button");
  dismiss.className = "app-toast-dismiss";
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss notification");
  const dismissIcon = document.createElement("span");
  dismissIcon.setAttribute("aria-hidden", "true");
  dismissIcon.textContent = "×";
  dismiss.append(dismissIcon);
  dismiss.addEventListener("click", () => removeToast(item));
  item.append(dismiss);

  const record: ToastRecord = { item, timer: undefined, tone };
  records.set(item, record);
  region.append(item);
  schedule(record);
}

export function clearToasts(): void {
  for (const record of [...records.values()]) removeToast(record.item);
  document.querySelector("#app-toasts")?.replaceChildren();
}
