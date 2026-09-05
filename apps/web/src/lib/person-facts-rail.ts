export type PersonFactRailSectionId =
  | "addresses"
  | "contact-methods"
  | "first-meeting"
  | "food-preferences"
  | "important-dates"
  | "pets"
  | "relationships"
  | "stay-in-touch"
  | "work";

export type PersonVitalStat = "birthday" | "first-meeting" | "work";

function railSection(
  sectionId: PersonFactRailSectionId,
): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(
    `[data-profile-section="${sectionId}"]`,
  ) ?? undefined;
}

export function setRailCount(
  sectionId: PersonFactRailSectionId,
  count: number | undefined,
  scope: "total" | "page" = "total",
): void {
  const target = railSection(sectionId)?.querySelector<HTMLElement>(
    "[data-profile-rail-count]",
  );
  if (!target) return;
  target.textContent = count === undefined
    ? ""
    : `${count}${scope === "page" ? " on this page" : ""}`;
  target.hidden = count === undefined;
}

export function setRailEmpty(
  sectionId: PersonFactRailSectionId,
  empty: boolean,
): void {
  const target = railSection(sectionId);
  if (!target) return;
  if (empty) target.dataset.railEmpty = "true";
  else target.removeAttribute("data-rail-empty");
}

function vitalTarget(slot: PersonVitalStat): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(
    `[data-person-vital-value="${slot}"]`,
  ) ?? undefined;
}

export function setVitalStat(
  slot: PersonVitalStat,
  text: string | undefined,
): void {
  const target = vitalTarget(slot);
  if (target) target.textContent = text || "Not recorded";
}

function renderFirstMeeting(target: HTMLElement): void {
  target.textContent = target.dataset.firstMeetingDate ||
    target.dataset.firstMeetingPlace || "Not recorded";
}

export function setFirstMeetingDate(text: string | undefined): void {
  const target = vitalTarget("first-meeting");
  if (!target) return;
  if (text) target.dataset.firstMeetingDate = text;
  else target.removeAttribute("data-first-meeting-date");
  renderFirstMeeting(target);
}

export function setFirstMeetingPlace(text: string | undefined): void {
  const target = vitalTarget("first-meeting");
  if (!target) return;
  if (text) target.dataset.firstMeetingPlace = text;
  else target.removeAttribute("data-first-meeting-place");
  renderFirstMeeting(target);
}
