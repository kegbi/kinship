/**
 * The deterministic identities backend and API unit tests share.
 *
 * About forty test modules opened with the same four-line actor literal and
 * the same `00000000-0000-4000-8000-000000000001/2/3` triple, each spelled out
 * by hand. A reader could not tell a deliberate difference (an `admin` actor,
 * a second workspace) from an accidental one, and a test that needed a fourth
 * identifier invented its own padding rule. The builders here are that rule,
 * written once.
 *
 * Identifiers follow the convention the suites already used: a v4-shaped UUID
 * whose last group is the ordinal, zero-padded to twelve decimal digits, so
 * `uuid(3)` is `00000000-0000-4000-8000-000000000003` and the value a test
 * prints stays readable in a failure message.
 *
 * The builders are typed structurally rather than against a module's
 * `public.ts`. The actor shape is identical in `PeopleActor`,
 * `PersonFileActor`, `ExportActor`, `LegalActor`, and their peers, so a
 * structural type satisfies all of them, and the package stays free of any
 * module import: no test's runtime module graph grows because it asked for an
 * identifier, and no unit's private code is reachable through here.
 */

/** The one workspace role vocabulary every module's actor type repeats. */
export type TestRole = "admin" | "member" | "owner";

/** The actor shape shared by every module's `…Actor` type. */
export interface TestActor {
  readonly memberId: string;
  readonly role: TestRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** An actor inside a named active workspace (`ActiveWorkspaceContext`). */
export interface TestWorkspaceActor extends TestActor {
  readonly workspaceName: string;
}

/** A resolved session: the active workspace plus what else it may reach. */
export interface TestSessionActor extends TestWorkspaceActor {
  readonly accessibleWorkspaces: readonly TestWorkspaceActor[];
}

/** A person as the suites' person literals spell one. */
export interface TestPerson {
  readonly familyName: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
}

/** The ordinals the default actor is built from. */
const USER = 1;
const MEMBER = 2;
const WORKSPACE = 3;
const PERSON = 100;

/** The workspace name the suites' named-workspace literals already used. */
export const TEST_WORKSPACE_NAME = "Family";

/** The deterministic identifier for ordinal `ordinal`. */
export function uuid(ordinal: number): string {
  return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

/** The signed-in user's identifier; ordinal 1 unless a test needs another. */
export function userId(ordinal: number = USER): string {
  return uuid(ordinal);
}

/** The membership identifier; ordinal 2 unless a test needs another. */
export function memberId(ordinal: number = MEMBER): string {
  return uuid(ordinal);
}

/** The workspace identifier; ordinal 3 unless a test needs another. */
export function workspaceId(ordinal: number = WORKSPACE): string {
  return uuid(ordinal);
}

/** A person identifier; ordinal 100 unless a test needs another. */
export function personId(ordinal: number = PERSON): string {
  return uuid(ordinal);
}

/** The standard member actor, with any field replaced. */
export function actor(overrides: Partial<TestActor> = {}): TestActor {
  return {
    memberId: memberId(),
    role: "member",
    userId: userId(),
    workspaceId: workspaceId(),
    ...overrides,
  };
}

/** The standard actor inside a named workspace. */
export function workspaceActor(
  overrides: Partial<TestWorkspaceActor> = {},
): TestWorkspaceActor {
  return {
    ...actor(),
    workspaceName: TEST_WORKSPACE_NAME,
    ...overrides,
  };
}

/**
 * The standard resolved session actor. `accessibleWorkspaces` defaults to
 * empty, which is what the API suites assert against.
 */
export function sessionActor(
  overrides: Partial<TestSessionActor> = {},
): TestSessionActor {
  return {
    accessibleWorkspaces: [],
    ...workspaceActor(),
    ...overrides,
  };
}

/** The person the suites name when the name itself carries no meaning. */
export function person(overrides: Partial<TestPerson> = {}): TestPerson {
  return {
    familyName: "Lovelace",
    givenName: "Ada",
    id: personId(),
    isPartial: false,
    ...overrides,
  };
}
