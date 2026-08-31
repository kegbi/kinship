import {
  type CommunicationList,
  getPerson,
  type Interaction,
  listCommunicationOptions,
  listPersonCommunications,
  listProfileFacts,
  recordInteraction,
} from "../../../../packages/contracts/generated/auth-client.ts";

let communicationAbort: AbortController | undefined;

const localDateTime = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const parseLocalInstant = (value: FormDataEntryValue | string | null) => {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const option = (id: string, name: string) => {
  const entry = document.createElement("option");
  entry.value = id;
  entry.textContent = name;
  return entry;
};

function messageRow(): HTMLElement {
  const row = document.createElement("fieldset");
  row.dataset.messageRow = "";
  const legend = document.createElement("legend");
  legend.textContent = "Message";
  const directionLabel = document.createElement("label");
  directionLabel.textContent = "Direction ";
  const direction = document.createElement("select");
  direction.name = "messageDirection";
  direction.append(
    option("outbound", "Outbound"),
    option("inbound", "Inbound"),
  );
  directionLabel.append(direction);
  const timeLabel = document.createElement("label");
  timeLabel.textContent = "Written at ";
  const writtenAt = document.createElement("input");
  writtenAt.name = "messageWrittenAt";
  writtenAt.type = "datetime-local";
  writtenAt.required = true;
  writtenAt.value = localDateTime();
  timeLabel.append(writtenAt);
  const contentLabel = document.createElement("label");
  contentLabel.textContent = "Message ";
  const content = document.createElement("textarea");
  content.name = "messageContent";
  content.maxLength = 10_000;
  content.required = true;
  contentLabel.append(content);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button-danger";
  remove.textContent = "Remove message";
  remove.addEventListener("click", () => row.remove());
  row.append(legend, directionLabel, timeLabel, contentLabel, remove);
  return row;
}

function renderRecord(record: Interaction): HTMLLIElement {
  const item = document.createElement("li");
  if (record.kind === "call") {
    item.textContent = `${
      record.contactWasCaller ? "Incoming" : "Outgoing"
    } call · ${new Date(record.calledAt).toLocaleString()}`;
    if (record.content) {
      item.append(document.createElement("br"), record.content);
    }
    if (record.emotions.length) {
      item.append(
        document.createElement("br"),
        `Emotions: ${record.emotions.map((entry) => entry.name).join(", ")}`,
      );
    }
    return item;
  }
  if (record.kind !== "conversation") return item;
  item.textContent = `${
    record.title || record.channelType?.name || "Unknown channel"
  } · ${new Date(record.happenedAt).toLocaleString()}`;
  if (record.contactMethod) {
    item.append(
      document.createElement("br"),
      `Via ${record.contactMethod.value}`,
    );
  }
  if (record.messages.length === 0) {
    item.append(document.createElement("br"), "Direction not recorded");
  }
  for (const message of record.messages) {
    item.append(
      document.createElement("br"),
      `${
        message.direction === "inbound" ? "Inbound" : "Outbound"
      }: ${message.content}`,
    );
  }
  return item;
}

function renderLists(list: CommunicationList): void {
  for (const kind of ["call", "conversation"] as const) {
    const section = document.querySelector<HTMLElement>(
      `[data-communication-kind="${kind}"]`,
    );
    const target = section?.querySelector<HTMLUListElement>(
      "[data-communication-list]",
    );
    const state = section?.querySelector<HTMLElement>(
      "[data-communication-state]",
    );
    const badge = section?.querySelector<HTMLElement>(
      "[data-communication-badge]",
    );
    if (!section || !target || !state || !badge) continue;
    const records = list.items.filter((entry) => entry.kind === kind);
    target.replaceChildren(...records.map(renderRecord));
    state.textContent = records.length
      ? ""
      : `No ${kind === "call" ? "calls" : "conversations"} recorded yet.`;
    badge.textContent = records.length ? `${records.length} recent` : "Empty";
    section.dataset.sectionState = "ready";
  }
}

export async function mountCommunications(
  personId: string,
  workspaceId: string,
  archived: boolean,
  hidden: { readonly calls: boolean; readonly conversations: boolean },
): Promise<void> {
  communicationAbort?.abort();
  const abort = new AbortController();
  communicationAbort = abort;
  const signal = abort.signal;
  const sections = [
    ...document.querySelectorAll<HTMLElement>("[data-communication-kind]"),
  ];
  if (!sections.length) return;
  let lifecycleArchived = archived;
  const applyLifecycleState: Array<() => void> = [];
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
    }>).detail;
    const nextArchived = detail?.archived;
    if (detail?.personId !== personId || typeof nextArchived !== "boolean") {
      return;
    }
    lifecycleArchived = nextArchived;
    for (const apply of applyLifecycleState) apply();
  }, { signal });
  for (const section of sections) {
    const key = section.dataset.communicationKind === "call"
      ? "calls"
      : "conversations";
    section.hidden = hidden[key];
    document.querySelector<HTMLElement>(`[data-section-link="${key}"]`)
      ?.closest("li")?.toggleAttribute("hidden", hidden[key]);
    const retry = section.querySelector<HTMLButtonElement>(
      "[data-communication-load-retry]",
    )!;
    retry.hidden = true;
    retry.addEventListener(
      "click",
      () => {
        void mountCommunications(
          personId,
          workspaceId,
          lifecycleArchived,
          hidden,
        );
      },
      { signal },
    );
  }
  const renderLoadError = () => {
    for (const section of sections.filter((entry) => !entry.hidden)) {
      section.dataset.sectionState = "error";
      section.querySelector<HTMLElement>("[data-communication-state]")!
        .textContent =
          "Communication could not be loaded. Saved data was not changed.";
      section.querySelector<HTMLButtonElement>(
        "[data-communication-load-retry]",
      )!.hidden = false;
    }
  };
  const initial = await Promise.all([
    listPersonCommunications(personId, workspaceId),
    listCommunicationOptions(workspaceId),
  ]).catch(() => undefined);
  if (!initial) {
    if (!signal.aborted) renderLoadError();
    return;
  }
  const [history, options] = initial;
  if (signal.aborted) return;
  if (!history.ok || !options.ok) {
    renderLoadError();
    return;
  }
  renderLists(history.value);
  const refreshAuthoritative = async (): Promise<boolean> => {
    const [historyAttempt, profileAttempt] = await Promise.allSettled([
      listPersonCommunications(personId, workspaceId),
      getPerson(personId, workspaceId),
    ]);
    if (signal.aborted) return false;
    const refreshed = historyAttempt.status === "fulfilled"
      ? historyAttempt.value
      : undefined;
    const profile = profileAttempt.status === "fulfilled"
      ? profileAttempt.value
      : undefined;
    if (refreshed?.ok) renderLists(refreshed.value);
    const lastContact = document.querySelector<HTMLElement>(
      "[data-profile-last-contact]",
    );
    if (lastContact && profile?.ok) {
      lastContact.textContent = profile.value.person.lastContactAt
        ? new Date(profile.value.person.lastContactAt).toLocaleString()
        : "None recorded";
    }
    return refreshed?.ok === true && profile?.ok === true;
  };
  let contactMethods: readonly {
    readonly id: string;
    readonly typeId: string;
    readonly value: string;
  }[] = [];
  let contactMethodsReady = false;
  let contactMethodsPromise: Promise<boolean> | undefined;
  const loadContactMethods = (): Promise<boolean> => {
    if (contactMethodsReady) return Promise.resolve(true);
    if (contactMethodsPromise) return contactMethodsPromise;
    contactMethodsPromise = (async () => {
      const contacts = await listProfileFacts(
        personId,
        "contact-methods",
        {},
        workspaceId,
      ).catch(() => undefined);
      if (signal.aborted) return false;
      if (!contacts?.ok) {
        contactMethodsPromise = undefined;
        return false;
      }
      contactMethods = contacts.value.records.filter((record) =>
        record.section === "contact-methods"
      ).map((record) => ({
        id: record.id,
        typeId: record.value.typeId,
        value: record.value.value,
      }));
      contactMethodsReady = true;
      return true;
    })();
    return contactMethodsPromise;
  };
  for (const section of sections) {
    const kind = section.dataset.communicationKind as "call" | "conversation";
    const add = section.querySelector<HTMLButtonElement>(
      "[data-communication-add]",
    )!;
    const form = section.querySelector<HTMLFormElement>(
      "[data-communication-form]",
    )!;
    const formState = form.querySelector<HTMLElement>(
      "[data-communication-form-state]",
    )!;
    const happenedAt = form.elements.namedItem(
      "happenedAt",
    ) as HTMLInputElement;
    const cancel = form.querySelector<HTMLButtonElement>(
      "[data-communication-cancel]",
    )!;
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    const refresh = form.querySelector<HTMLButtonElement>(
      "[data-communication-refresh]",
    )!;
    let pending = false;
    let requestId: string | undefined;
    const available = options.value.availability[kind];
    let prepareEditor = (): Promise<void> => Promise.resolve();
    const resetDraft = () => {
      requestId = undefined;
      form.reset();
      form.querySelector<HTMLElement>("[data-message-rows]")?.replaceChildren();
      happenedAt.value = localDateTime();
    };
    const applyWriteState = () => {
      const unavailable = lifecycleArchived || !available;
      add.hidden = unavailable || pending || !form.hidden;
      add.disabled = unavailable || pending;
      submit.disabled = lifecycleArchived || pending;
      cancel.disabled = lifecycleArchived || pending;
    };
    const applyLifecycle = () => {
      if (lifecycleArchived) {
        if (!pending) resetDraft();
        form.hidden = true;
      }
      applyWriteState();
    };
    applyLifecycleState.push(applyLifecycle);
    applyLifecycle();
    happenedAt.value = localDateTime();
    if (kind === "call") {
      const emotions = form.elements.namedItem(
        "emotionIds",
      ) as HTMLSelectElement;
      emotions.replaceChildren(
        ...options.value.emotions.map((entry) => option(entry.id, entry.name)),
      );
    } else {
      const channel = form.elements.namedItem(
        "channelTypeId",
      ) as HTMLSelectElement;
      const method = form.elements.namedItem(
        "contactMethodId",
      ) as HTMLSelectElement;
      channel.replaceChildren(
        option("", "Select channel"),
        ...options.value.channelTypes.map((entry) =>
          option(entry.id, entry.name)
        ),
      );
      const refreshMethods = () =>
        method.replaceChildren(
          option("", "No specific method"),
          ...contactMethods.filter((entry) => entry.typeId === channel.value)
            .map((entry) => option(entry.id, entry.value)),
        );
      channel.addEventListener("change", refreshMethods, { signal });
      refreshMethods();
      method.disabled = true;
      prepareEditor = async () => {
        method.disabled = true;
        formState.textContent = "Loading specific contact methods…";
        const loaded = await loadContactMethods();
        if (signal.aborted) return;
        if (!loaded) {
          formState.textContent =
            "Specific contact methods could not be loaded. Close and reopen the editor to try again.";
          return;
        }
        refreshMethods();
        method.disabled = false;
        formState.textContent = "";
      };
      form.querySelector<HTMLButtonElement>("[data-add-message]")
        ?.addEventListener(
          "click",
          () =>
            form.querySelector<HTMLElement>("[data-message-rows]")!.append(
              messageRow(),
            ),
          { signal },
        );
    }
    add.addEventListener("click", () => {
      if (lifecycleArchived || !available || pending) return;
      requestId ??= crypto.randomUUID();
      form.hidden = false;
      applyWriteState();
      happenedAt.focus();
      void prepareEditor();
    }, { signal });
    cancel.addEventListener("click", () => {
      resetDraft();
      form.hidden = true;
      applyWriteState();
      add.focus();
    }, { signal });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      const current = await refreshAuthoritative();
      refresh.disabled = false;
      refresh.hidden = current;
      formState.textContent = current
        ? "Communication view refreshed."
        : "Saved communication still could not be refreshed. Retry or reload the page.";
      formState.focus();
    }, { signal });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (pending || lifecycleArchived) return;
      const data = new FormData(form);
      const instant = parseLocalInstant(data.get("happenedAt"));
      if (!instant) {
        formState.textContent = "Choose a valid occurrence time.";
        formState.focus();
        return;
      }
      const messages = kind === "conversation"
        ? [...form.querySelectorAll<HTMLElement>("[data-message-row]")].map(
          (row) => ({
            content:
              (row.querySelector<HTMLTextAreaElement>("[name=messageContent]")
                ?.value ?? "").trim(),
            direction: row.querySelector<HTMLSelectElement>(
              "[name=messageDirection]",
            )?.value as "inbound" | "outbound",
            writtenAt: parseLocalInstant(
              row.querySelector<HTMLInputElement>("[name=messageWrittenAt]")
                ?.value ?? null,
            ),
          }),
        )
        : [];
      if (messages.some((message) => !message.writtenAt)) {
        formState.textContent = "Choose a valid message time.";
        formState.focus();
        return;
      }
      requestId ??= crypto.randomUUID();
      const input = kind === "call"
        ? {
          calledAt: instant,
          contactWasCaller: data.get("callDirection") === "contact",
          ...(String(data.get("content") ?? "").trim()
            ? { content: String(data.get("content")).trim() }
            : {}),
          emotionIds: data.getAll("emotionIds").map(String),
          kind: "call" as const,
          personId,
          requestId,
        }
        : {
          channelTypeId: String(data.get("channelTypeId")),
          ...(String(data.get("contactMethodId") ?? "")
            ? { contactMethodId: String(data.get("contactMethodId")) }
            : {}),
          happenedAt: instant,
          kind: "conversation" as const,
          messages: messages.map((message) => ({
            content: message.content,
            direction: message.direction,
            writtenAt: message.writtenAt!,
          })),
          personId,
          requestId,
          ...(String(data.get("title") ?? "").trim()
            ? { title: String(data.get("title")).trim() }
            : {}),
        };
      pending = true;
      submit.disabled = true;
      cancel.disabled = true;
      try {
        const result = await recordInteraction(input, workspaceId);
        if (!result.ok) {
          formState.textContent = result.problem.detail;
          formState.focus();
          return;
        }
        document.dispatchEvent(
          new CustomEvent("person-timeline-changed", {
            detail: { personIds: [personId] },
          }),
        );
        requestId = undefined;
        const current = await refreshAuthoritative();
        refresh.hidden = current;
        formState.textContent = current
          ? (kind === "call" ? "Call saved." : "Conversation saved.")
          : `${
            kind === "call" ? "Call" : "Conversation"
          } saved, but the current view could not be refreshed. Retry refresh or reload the page.`;
        if (!current) formState.focus();
      } catch {
        formState.textContent =
          "Save outcome is unknown. Retry to safely check the same request.";
        formState.focus();
      } finally {
        pending = false;
        applyWriteState();
      }
    }, { signal });
  }
}
