interface ProfileRailExpanderOptions {
  readonly accessibleSuffix: string;
  readonly collapsedLabel: string;
  readonly datasetKey: string;
  readonly expandedLabel?: string;
}

export function insertProfileRailExpander(
  list: HTMLUListElement,
  collapsedItems: readonly HTMLLIElement[],
  options: ProfileRailExpanderOptions,
): HTMLButtonElement | undefined {
  if (collapsedItems.length === 0) return undefined;
  const expander = document.createElement("button");
  expander.type = "button";
  expander.className =
    "button-secondary profile-rail-summary-control profile-rail-expander";
  expander.dataset[options.datasetKey] = "";
  const suffix = document.createElement("span");
  suffix.className = "sr-only";
  suffix.textContent = ` ${options.accessibleSuffix}`;
  const setExpanded = (expanded: boolean) => {
    for (const item of collapsedItems) item.hidden = !expanded;
    expander.setAttribute("aria-expanded", String(expanded));
    expander.replaceChildren(
      document.createTextNode(
        expanded
          ? options.expandedLabel ?? "Show fewer"
          : options.collapsedLabel,
      ),
      suffix,
    );
  };
  setExpanded(false);
  expander.addEventListener(
    "click",
    () => setExpanded(expander.getAttribute("aria-expanded") !== "true"),
  );
  list.insertAdjacentElement("afterend", expander);
  return expander;
}
