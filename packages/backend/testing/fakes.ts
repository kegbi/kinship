/**
 * The test doubles backend and API unit tests share.
 *
 * Injected time, injected identifiers, an audit port, a `Map`-backed
 * repository, mail, and object storage are the six collaborators nearly every
 * use case takes, and nearly every suite re-implemented them: fifty-eight
 * inline `{ now: () => new Date("…") }` clocks, two `MemoryFiles` classes that
 * share a name and nothing else, and a `Map` plus a `string[]` recorder written
 * out again in each `fixture()` helper.
 *
 * Each fake here is generic and small. A behaviour that belongs to one test —
 * "the second put fails", "the attachment disappears between the read and the
 * write" — stays a bespoke double in that test: these are the boring parts, not
 * a framework.
 *
 * The fakes are typed against the shared kernel's contracts (`Clock`,
 * `IdGenerator`, `AuditEventRecorder`, `Logger`) and otherwise structurally, so the
 * package imports no module, reaches into no unit's private code, and adds
 * nothing to a test's runtime module graph — every import below is a type.
 */

import type { Clock } from "../shared-kernel/clock.ts";
import type { IdGenerator } from "../shared-kernel/ids.ts";
import type { AuditEventWrite } from "../shared-kernel/audit_event.ts";
import type { LogEvent, Logger } from "../shared-kernel/telemetry.ts";

// --- Time ----------------------------------------------------------------

/**
 * A clock stopped at `instant`. Every `now()` returns a fresh `Date`, so a
 * caller that mutates the value it received cannot move the test's clock.
 */
export function fixedClock(instant: Date | string): Clock {
  const fixed = instant instanceof Date ? instant.toISOString() : instant;
  return { now: () => new Date(fixed) };
}

// --- Identifiers ---------------------------------------------------------

/** A deterministic identifier source that also remembers what it issued. */
export interface SequentialIds extends IdGenerator {
  /** The identifiers issued so far, in order. */
  readonly issued: readonly string[];
  /** The `{ next() }` spelling the file and export ports use. */
  next(): string;
}

/**
 * Identifiers in issue order: `prefix` with the ordinal appended, padded to
 * the twelve-digit tail `fixtures.uuid` uses, so `sequentialIds()` yields
 * `00000000-0000-4000-8000-000000000001`, `…0002`, and so on.
 */
export function sequentialIds(
  options: { readonly prefix?: string; readonly start?: number } = {},
): SequentialIds {
  const prefix = options.prefix ?? "00000000-0000-4000-8000-";
  const issued: string[] = [];
  const create = (): string => {
    const ordinal = (options.start ?? 1) + issued.length;
    const id = `${prefix}${String(ordinal).padStart(12, "0")}`;
    issued.push(id);
    return id;
  };
  return { create, issued, next: create };
}

// --- Audit ---------------------------------------------------------------

/**
 * What a recording audit accepts: either a module's own audit command, which
 * names its `action` directly, or a kernel `AuditEventWrite`, which carries the
 * action inside its event.
 */
export interface RecordableAuditCommand {
  readonly action?: string;
  readonly event?: { readonly action: string };
}

/** A recorder that stores what it was asked to write and asserts nothing. */
export interface RecordingAudit<Command, Id extends string | void = string> {
  /** Each command's action name, in order — the usual assertion target. */
  readonly actions: readonly string[];
  /** Every command the port received, in order. */
  readonly commands: readonly Command[];
  record(command: Command): Promise<Id>;
  recordWhen(
    command: Command & { readonly when: boolean },
  ): Promise<Id | undefined>;
  assertRecorded(command: Command): Promise<void>;
  assertPostcondition(command: Command): Promise<void>;
  assertFailurePostcondition(command: Command): Promise<void>;
}

/**
 * Records audit writes in memory.
 *
 * The default `Command` is the kernel's `AuditEventWrite`, so the result
 * satisfies `AuditEventRecorder` and a test may wire the real
 * `describe…Event`/`…AuditFrom` factories through it. A test that injects a
 * module's own audit port names that port's command instead, as in
 * `recordingAudit<Parameters<GiftAudit["record"]>[0]>()`.
 *
 * `Id` is what the port's `record` resolves to: the written row's identifier
 * for most modules, `void` for the few whose port discards it
 * (`recordingAudit<ApiTokenAuditCommand, void>()`).
 *
 * The postcondition methods succeed: a fake cannot re-read a row it never
 * wrote, and the tests that care about a failing postcondition supply their own
 * double that throws.
 */
export function recordingAudit<
  Command extends RecordableAuditCommand = AuditEventWrite,
  Id extends string | void = string,
>(): RecordingAudit<Command, Id> {
  const commands: Command[] = [];
  // Its own identifier family, so a recorded audit id is never mistaken for
  // a fixture identity in a failure message.
  const ids = sequentialIds({ prefix: "0a000000-0000-4000-8000-" });
  const record = (command: Command): Promise<Id> => {
    commands.push(command);
    // One identifier is issued either way; a `void` port simply drops it.
    return Promise.resolve(ids.create() as unknown as Id);
  };
  return {
    get actions() {
      return commands.map((command) =>
        command.action ?? command.event?.action ?? ""
      );
    },
    commands,
    record,
    recordWhen: (command) =>
      command.when ? record(command) : Promise.resolve(undefined),
    assertRecorded: () => Promise.resolve(),
    assertPostcondition: () => Promise.resolve(),
    assertFailurePostcondition: () => Promise.resolve(),
  };
}

// --- Telemetry -----------------------------------------------------------

/** A logger that keeps every event it was given, in order. */
export interface RecordingLogger extends Logger {
  readonly events: readonly LogEvent[];
}

/**
 * The kernel `Logger` as a test sees it: the events exactly as the code under
 * test logged them, before the platform adapter would redact anything.
 */
export function recordingLogger(): RecordingLogger {
  const events: LogEvent[] = [];
  return {
    events,
    log: (event) => {
      events.push(event);
    },
  };
}

// --- Repositories --------------------------------------------------------

/**
 * A `Map` behind the four operations a repository double needs. A test wraps it
 * in the port shape its use case expects; the storage itself is not worth
 * writing twice.
 */
export interface InMemoryRepository<Item> {
  /** The live store, for a test that seeds or corrupts one row directly. */
  readonly entries: Map<string, Item>;
  readonly size: number;
  save(item: Item): Item;
  find(key: string): Item | undefined;
  list(matches?: (item: Item) => boolean): readonly Item[];
  delete(key: string): boolean;
  clear(): void;
}

/** Stores items by `keyOf(item)`, in insertion order. */
export function inMemoryRepository<Item>(
  keyOf: (item: Item) => string,
): InMemoryRepository<Item> {
  const entries = new Map<string, Item>();
  return {
    entries,
    get size() {
      return entries.size;
    },
    save(item) {
      entries.set(keyOf(item), item);
      return item;
    },
    find: (key) => entries.get(key),
    list: (matches) => [...entries.values()].filter(matches ?? (() => true)),
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
  };
}

// --- Mail ----------------------------------------------------------------

export type SentMailKind = "invitation" | "password-reset" | "verification";

/** One captured outbound message. */
export interface SentMail {
  readonly email: string;
  readonly expiresAt: Date;
  readonly kind: SentMailKind;
  readonly token: string;
  readonly workspaceName?: string;
}

/**
 * Captures the three single-use messages the workspaces and identity modules
 * send. The three methods together satisfy `VerificationMail`,
 * `InvitationMail`, and `PasswordRecoveryMail`.
 */
export interface FakeMail {
  /** Every message sent, in order. */
  readonly sent: readonly SentMail[];
  sendInvitation(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
    readonly workspaceName: string;
  }): Promise<void>;
  sendPasswordReset(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
  sendVerification(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
  /** The last message of one kind, or `undefined` when none was sent. */
  last(kind: SentMailKind): SentMail | undefined;
}

export function fakeMail(): FakeMail {
  const sent: SentMail[] = [];
  return {
    sent,
    sendInvitation(message) {
      sent.push({ ...message, kind: "invitation" });
      return Promise.resolve();
    },
    sendPasswordReset(message) {
      sent.push({ ...message, kind: "password-reset" });
      return Promise.resolve();
    },
    sendVerification(message) {
      sent.push({ ...message, kind: "verification" });
      return Promise.resolve();
    },
    last: (kind) => sent.filter((message) => message.kind === kind).at(-1),
  };
}

// --- Object storage ------------------------------------------------------

/** An in-memory object store with the `ObjectStorage` port's shape. */
export interface FakeObjectStore {
  readonly bucket: string;
  /** Every operation, as `get:<key>`, `put:<key>`, or `remove:<key>`. */
  readonly calls: readonly string[];
  readonly objects: Map<string, Uint8Array>;
  readonly provider: string;
  get(command: { readonly key: string }): Promise<Uint8Array | undefined>;
  health(): Promise<"available">;
  list(prefix?: string): readonly string[];
  put(command: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly mimeType?: string;
  }): Promise<void>;
  remove(command: { readonly key: string }): Promise<void>;
}

/** Stores bytes in a `Map` and records every call it received. */
export function fakeObjectStore(
  options: { readonly bucket?: string } = {},
): FakeObjectStore {
  const calls: string[] = [];
  const objects = new Map<string, Uint8Array>();
  return {
    bucket: options.bucket ?? "test-files",
    calls,
    objects,
    provider: "memory",
    get(command) {
      calls.push(`get:${command.key}`);
      return Promise.resolve(objects.get(command.key));
    },
    health: () => Promise.resolve("available"),
    list: (prefix) =>
      [...objects.keys()].filter((key) => key.startsWith(prefix ?? "")),
    put(command) {
      calls.push(`put:${command.key}`);
      objects.set(command.key, command.bytes.slice());
      return Promise.resolve();
    },
    remove(command) {
      calls.push(`remove:${command.key}`);
      objects.delete(command.key);
      return Promise.resolve();
    },
  };
}
