const FLOW_CATALOG_PATH = "docs/product/user-flows.yaml";
const PAGE_CATALOG_PATH = "docs/product/page-catalog.yaml";
const RELEASE_PATH = "docs/product/release-slices.md";
const PLANNING_README_PATH = "docs/planning/README.md";
const ROADMAP_PATH = "docs/planning/roadmap.md";
const TRACEABILITY_PATH = "docs/planning/traceability.md";

const EXPECTED_FLOW_IDS = [
  "AUTH-001",
  "AUTH-002",
  "AUTH-003",
  "AUTH-004",
  "AUTH-005",
  "WORKSPACE-001",
  "WORKSPACE-002",
  "WORKSPACE-003",
  "TODAY-001",
  "PEOPLE-001",
  "PEOPLE-002",
  "PEOPLE-003",
  "PEOPLE-004",
  "PEOPLE-005",
  "PEOPLE-006",
  "RELATIONSHIP-001",
  "INTERACTION-001",
  "INTERACTION-002",
  "PLANNING-001",
  "PLANNING-002",
  "FILES-001",
  "GIFTS-001",
  "JOURNAL-001",
  "IMPORT-001",
  "EXPORT-001",
  "API-001",
  "INTEGRATION-001",
  "GOVERNANCE-001",
  "GOVERNANCE-002",
  "BILLING-001",
] as const;

const EXPECTED_PAGE_IDS = [
  "public.home",
  "public.features",
  "legal.privacy",
  "legal.terms",
  "auth.sign-in",
  "auth.sign-up",
  "auth.verify-email",
  "auth.recover",
  "auth.reset",
  "auth.mfa",
  "invitation.accept",
  "app.today",
  "people.index",
  "people.archived",
  "people.create",
  "people.profile",
  "people.activity-report",
  "people.audit",
  "tasks.index",
  "journal.index",
  "journal.item",
  "settings.index",
  "settings.profile",
  "settings.preferences",
  "settings.security",
  "settings.workspace",
  "settings.members",
  "settings.personalization",
  "settings.workspace-danger",
  "settings.storage",
  "settings.api-access",
  "settings.integrations",
  "settings.import",
  "settings.import-new",
  "settings.import-report",
  "settings.export",
  "settings.audit",
  "settings.billing",
  "compliance.accept",
] as const;

type CatalogEntry = {
  id: string;
  block: string;
};

type FlowAssignment = {
  id: string;
  priority: string;
  slice: number;
};

type ReleaseSlice = {
  number: number;
  section: string;
  flowParagraphs: string[];
};

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    fail(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertIncludes(
  source: string,
  expected: string,
  message: string,
): void {
  assert(
    source.includes(expected),
    `${message}: missing ${JSON.stringify(expected)}`,
  );
}

function assertMatches(
  source: string,
  expected: RegExp,
  message: string,
): void {
  assert(expected.test(source), `${message}: did not match ${expected}`);
}

function assertNotMatches(
  source: string,
  forbidden: RegExp,
  message: string,
): void {
  assert(
    !forbidden.test(source),
    `${message}: unexpectedly matched ${forbidden}`,
  );
}

function assertExactIds(
  actual: string[],
  expected: readonly string[],
  label: string,
): void {
  assertEquals(
    new Set(actual).size,
    actual.length,
    `${label} IDs must be unique`,
  );
  assertEquals(
    [...actual].sort().join("\n"),
    [...expected].sort().join("\n"),
    `${label} identities changed`,
  );
}

function capture(
  match: RegExpMatchArray,
  index: number,
  label: string,
): string {
  const value = match[index];
  assert(value !== undefined, `missing ${label} capture`);
  return value;
}

function parseCatalogEntries(
  source: string,
  collection: string,
): CatalogEntry[] {
  const marker = `\n${collection}:\n`;
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, `catalog must contain ${collection}`);
  const body = source.slice(markerIndex + marker.length);
  const starts = [...body.matchAll(/^[ ]{2}- id: (\S+)$/gm)];
  return starts.map((match, index) => ({
    id: capture(match, 1, `${collection} ID`),
    block: body.slice(match.index, starts[index + 1]?.index ?? body.length),
  }));
}

function scalar(block: string, key: string): string | undefined {
  return block.match(new RegExp(`^    ${key}: (.+)$`, "m"))?.[1];
}

function catalogList(block: string, key: string): string[] {
  const value = scalar(block, key);
  if (value !== undefined) {
    const match = value.match(/^\[(.*)\]$/);
    assert(match !== null, `${key} must be a YAML list`);
    const content = capture(match, 1, key).trim();
    return content === "" ? [] : content.split(",").map((item) => item.trim());
  }
  const multiline = block.match(
    new RegExp(`^    ${key}:\\n((?:[ ]{6}- .+\\n?)+)`, "m"),
  );
  assert(multiline !== null, `missing ${key}`);
  return [...capture(multiline, 1, key).matchAll(/^[ ]{6}- (.+)$/gm)]
    .map((match) => capture(match, 1, `${key} item`).trim());
}

function markdownSection(source: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `missing section ${marker}`);
  const next = source.indexOf("\n## ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function parseFlowAssignments(traceability: string): FlowAssignment[] {
  const section = markdownSection(traceability, "Flow-To-Slice Matrix");
  return [
    ...section.matchAll(
      /^\| `([A-Z]+-\d{3})`\s+\| (P[0-2])\s+\|\s+(\d+)\s+\|/gm,
    ),
  ]
    .map((match) => ({
      id: capture(match, 1, "flow assignment ID"),
      priority: capture(match, 2, "flow assignment priority"),
      slice: Number(capture(match, 3, "flow assignment slice")),
    }));
}

function parseReleaseSlices(source: string): ReleaseSlice[] {
  const headings = [...source.matchAll(/^## Slice (\d+):[^\n]+$/gm)];
  return headings.map((heading, index) => {
    const section = source.slice(
      heading.index,
      headings[index + 1]?.index ?? source.length,
    );
    return {
      number: Number(capture(heading, 1, "release slice number")),
      section,
      flowParagraphs: section.split(/\n\s*\n/)
        .filter((paragraph) => paragraph.startsWith("Flows:"))
        .map((paragraph) => paragraph.slice("Flows:".length).trim()),
    };
  });
}

function withoutBlockquotes(source: string): string {
  return source.split("\n").filter((line) => !/^\s*>/.test(line)).join("\n");
}

function maxSlice(
  assignments: FlowAssignment[],
  priorities: Set<string>,
): number {
  const selected = assignments.filter((assignment) =>
    priorities.has(assignment.priority)
  );
  assert(
    selected.length > 0,
    "milestone derivation must select at least one flow",
  );
  return Math.max(...selected.map((assignment) => assignment.slice));
}

const [
  flowCatalog,
  pageCatalog,
  release,
  planningReadme,
  roadmap,
  traceability,
] = await Promise.all([
  Deno.readTextFile(FLOW_CATALOG_PATH),
  Deno.readTextFile(PAGE_CATALOG_PATH),
  Deno.readTextFile(RELEASE_PATH),
  Deno.readTextFile(PLANNING_README_PATH),
  Deno.readTextFile(ROADMAP_PATH),
  Deno.readTextFile(TRACEABILITY_PATH),
]);

const flows = parseCatalogEntries(flowCatalog, "flows");
const pages = parseCatalogEntries(pageCatalog, "pages");
const assignments = parseFlowAssignments(traceability);
const priorities = new Map(
  flows.map((flow) => [flow.id, scalar(flow.block, "priority")]),
);
const p0Cut = maxSlice(assignments, new Set(["P0"]));
const coreCut = maxSlice(assignments, new Set(["P0", "P1"]));
const optionalCut = maxSlice(assignments, new Set(["P2"]));
const catalogCompleteCut = maxSlice(assignments, new Set(["P0", "P1", "P2"]));
const publicProductPages = pages.filter((page) =>
  scalar(page.block, "access") === "public" &&
  scalar(page.block, "owner") === "web" &&
  catalogList(page.block, "flowIds").length === 0
);
const workspaceFlowPages = pages.filter((page) =>
  catalogList(page.block, "flowIds").includes("WORKSPACE-001")
);
const requiredSlice1PageIds = [
  ...publicProductPages,
  ...workspaceFlowPages,
].map((page) => page.id);

Deno.test("PRODUCT-001 catalog extraction controls", () => {
  assertExactIds(flows.map((flow) => flow.id), EXPECTED_FLOW_IDS, "flow");
  assertExactIds(pages.map((page) => page.id), EXPECTED_PAGE_IDS, "page");

  assertIncludes(
    flowCatalog,
    "defaultDeliveryStatus: planned",
    "flow delivery default",
  );
  assertIncludes(
    pageCatalog,
    "defaultDeliveryStatus: planned",
    "page delivery default",
  );
  const deliveredFlows = new Map([
    ["AUTH-001", "tests/e2e/auth-001.spec.ts"],
    ["AUTH-003", "tests/e2e/auth-003.spec.ts"],
  ]);
  for (const flow of flows) {
    const deliveredTestRef = deliveredFlows.get(flow.id);
    assertEquals(
      scalar(flow.block, "deliveryStatus") ?? "planned",
      deliveredTestRef ? "delivered" : "planned",
      `${flow.id} effective delivery status`,
    );
    assertIncludes(
      flow.block,
      deliveredTestRef
        ? `e2e: { required: true, testRefs: [${deliveredTestRef}] }`
        : "e2e: { required: true, testRefs: [] }",
      `${flow.id} E2E state`,
    );
  }

  const priorityTotals = { P0: 0, P1: 0, P2: 0 };
  for (const priority of priorities.values()) {
    assert(
      priority === "P0" || priority === "P1" || priority === "P2",
      "known priority",
    );
    priorityTotals[priority]++;
  }
  assertEquals(
    JSON.stringify(priorityTotals),
    JSON.stringify({ P0: 17, P1: 10, P2: 3 }),
    "priority totals",
  );

  assertExactIds(
    assignments.map((assignment) => assignment.id),
    EXPECTED_FLOW_IDS,
    "flow-to-slice",
  );
  for (const assignment of assignments) {
    assertEquals(
      assignment.priority,
      priorities.get(assignment.id),
      `${assignment.id} mapped priority`,
    );
  }
  assertEquals(p0Cut, 7, "catalog-derived P0 cut");
  assertEquals(coreCut, 7, "catalog-derived P0/P1 cut");
  assertEquals(optionalCut, 8, "catalog-derived P2 cut");
  assertEquals(catalogCompleteCut, 8, "catalog-derived complete-catalog cut");

  assertMatches(
    pageCatalog,
    /defaultStates:\n[ ]{2}public:\n[ ]{4}- ready\n[ ]{4}- not-found/,
    "current public state catalog",
  );
  for (const page of publicProductPages) {
    const id = page.id;
    assertEquals(scalar(page.block, "access"), "public", `${id} access`);
    assertEquals(scalar(page.block, "rendering"), "static", `${id} rendering`);
    assertEquals(
      catalogList(page.block, "flowIds").length,
      0,
      `${id} flow IDs`,
    );
  }
});

Deno.test("PRODUCT-001 AC-01 accepts exact slice ownership", () => {
  const violations: string[] = [];
  const expect = (condition: boolean, message: string): void => {
    if (!condition) violations.push(message);
  };
  const expectMatch = (
    source: string,
    pattern: RegExp,
    message: string,
  ): void => {
    expect(pattern.test(source), message);
  };
  const expectNoMatch = (
    source: string,
    pattern: RegExp,
    message: string,
  ): void => {
    expect(!pattern.test(source), message);
  };

  const releaseSlices = parseReleaseSlices(release);
  const flowOccurrences = new Map<string, number[]>();
  for (const sliceNumber of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const slice = releaseSlices.find((candidate) =>
      candidate.number === sliceNumber
    );
    expect(slice !== undefined, `Slice ${sliceNumber} section is missing`);
    if (slice === undefined) continue;
    expect(
      slice.flowParagraphs.length === 1,
      `Slice ${sliceNumber} must have exactly one authoritative non-blockquoted Flows paragraph; found ${slice.flowParagraphs.length}`,
    );
    for (const paragraph of slice.flowParagraphs) {
      const fractional = paragraph.match(/\b(portion|part|subset)\b/i)?.[1];
      expect(
        fractional === undefined,
        `Slice ${sliceNumber} Flows paragraph must not use fractional qualifier ${
          JSON.stringify(fractional)
        }`,
      );
      for (const match of paragraph.matchAll(/`([A-Z]+-\d{3})`/g)) {
        const id = capture(match, 1, "release flow ID");
        const slices = flowOccurrences.get(id) ?? [];
        slices.push(sliceNumber);
        flowOccurrences.set(id, slices);
      }
    }
  }

  for (const assignment of assignments) {
    const actualSlices = flowOccurrences.get(assignment.id) ?? [];
    expect(
      actualSlices.length === 1 && actualSlices[0] === assignment.slice,
      `${assignment.id} must appear exactly once as a complete flow in Slice ${assignment.slice}; found ${
        actualSlices.length === 0
          ? "no authoritative assignment"
          : `Slice ${actualSlices.join(", Slice ")}`
      }`,
    );
  }
  for (const id of flowOccurrences.keys()) {
    expect(
      priorities.has(id),
      `release Flows paragraphs contain unknown flow ${id}`,
    );
  }

  const slice1 = markdownSection(
    release,
    "Slice 1: Identity, Workspace, And People Core",
  );
  const slice2 = markdownSection(
    release,
    "Slice 2: Complete Profile Facts And Relationships",
  );
  const slice6 = markdownSection(release, "Slice 6: Journal And Governance");
  const acceptedSlice1 = withoutBlockquotes(slice1);
  const acceptedSlice2 = withoutBlockquotes(slice2);
  const acceptedSlice6 = withoutBlockquotes(slice6);

  expectMatch(
    acceptedSlice1,
    /typed[^.\n]*`PEOPLE-003`[^.\n]*shell[^.\n]*planned/i,
    "Slice 1 must own a typed, still-planned PEOPLE-003 shell outside proposal text",
  );
  for (const pageId of requiredSlice1PageIds) {
    expect(
      acceptedSlice1.includes(`\`${pageId}\``),
      `catalog-derived Slice 1 page ${pageId} must be owned in accepted Slice 1 prose`,
    );
  }
  for (
    const expected of ["`ready`", "`not-found`", "navigation", "accessibility"]
  ) {
    expect(
      acceptedSlice1.includes(expected),
      `accepted Slice 1 page contract must include ${expected}`,
    );
  }
  expectMatch(
    acceptedSlice1,
    /public\.home[^.\n]*public\.features[^.\n]*no stable (?:user-)?flow ID/i,
    "accepted Slice 1 must retain empty public-page flow IDs",
  );
  expectNoMatch(
    slice1,
    /Proposed Slice 1 flow amendment/i,
    "Slice 1 must not retain a proposed PRODUCT-001 amendment",
  );
  expectMatch(
    acceptedSlice2,
    /edit[^.\n]*archive[^.\n]*restore[^.\n]*delete/i,
    "accepted Slice 2 must state indivisible PEOPLE-004 edit/archive/restore/delete behavior",
  );
  expectMatch(
    acceptedSlice6,
    /complete `PEOPLE-003`/i,
    "complete PEOPLE-003 must belong to accepted Slice 6 prose",
  );
  expectMatch(
    acceptedSlice6,
    /after every enabled core person section/i,
    "accepted Slice 6 must require every enabled core person section before PEOPLE-003 completion",
  );
  expectNoMatch(
    slice6,
    /Proposed Slice 6 amendment/i,
    "Slice 6 must not retain a proposed PRODUCT-001 amendment",
  );

  if (violations.length > 0) {
    fail(`AC-01 release ownership violations:\n- ${violations.join("\n- ")}`);
  }
});

Deno.test("PRODUCT-001 AC-02 accepts catalog-derived milestone meanings", () => {
  const milestones = markdownSection(release, "Milestone Contract");
  const planningMilestones = markdownSection(
    planningReadme,
    "Milestone Definitions",
  );

  for (
    const name of [
      "Foundation complete",
      "Core alpha",
      "Proposed MVP",
      "Core feature complete",
      "Optional platform complete",
      "Catalog complete",
      "AI-enabled complete",
      "Production ready",
    ]
  ) {
    assertIncludes(milestones, name, `release milestone ${name}`);
  }
  assertMatches(
    milestones,
    /Foundation complete[^\n]*Slice 0/i,
    "Foundation cut",
  );
  assertMatches(milestones, /Core alpha[^\n]*Slice 4/i, "Core alpha cut");
  assertMatches(
    milestones,
    new RegExp(`Proposed MVP[^\\n]*Slice ${p0Cut}`, "i"),
    "derived MVP cut",
  );
  assertMatches(
    milestones,
    new RegExp(`Core feature complete[^\\n]*Slice ${coreCut}`, "i"),
    "derived core cut",
  );
  assertMatches(
    milestones,
    new RegExp(`Optional platform complete[^\\n]*Slice ${optionalCut}`, "i"),
    "derived optional-platform cut",
  );
  assertMatches(
    milestones,
    new RegExp(`Catalog complete[^\\n]*Slice ${catalogCompleteCut}`, "i"),
    "derived complete-catalog cut",
  );
  assertMatches(
    milestones,
    /Proposed MVP[^\n]*(?:every|all) P0/i,
    "MVP priority membership",
  );
  assertMatches(
    milestones,
    /Core feature complete[^\n]*(?:every|all) P0 and P1/i,
    "core priority membership",
  );
  assertMatches(
    milestones,
    /Optional platform complete[^\n]*(?:enabled|selected)[^\n]*P2[^\n]*(?:disableable|disabled)[^\n]*(?:core|CRM)/i,
    "optional-platform substantive meaning",
  );
  assertMatches(
    milestones,
    /Catalog complete[^\n]*(?:all|every)[^\n]*P0[^\n]*P1[^\n]*P2/i,
    "catalog-complete substantive meaning",
  );
  assertMatches(
    milestones,
    /AI-enabled complete[^\n]*approved AI[^\n]*product[^\n]*privacy[^\n]*provider-neutral[^\n]*(?:isolation|safety)[^\n]*evaluation/i,
    "AI-enabled substantive meaning",
  );
  assertMatches(
    milestones,
    /Production ready[^\n]*independent/i,
    "production readiness remains independent",
  );
  assertNotMatches(
    milestones,
    /\b(?:17 P0|10 P1|30 flows?)\b/i,
    "milestone authority is not a fixed count",
  );

  assertNotMatches(
    planningMilestones,
    /pending DG-07|expected Slice 7/i,
    "planning milestones are accepted",
  );
  assertMatches(
    planningMilestones,
    /Core alpha[^\n]*Slice 4/i,
    "planning Core alpha cut",
  );
  assertMatches(
    planningMilestones,
    new RegExp(`Proposed MVP[^\\n]*Slice ${p0Cut}`, "i"),
    "planning MVP cut",
  );
  assertMatches(
    planningMilestones,
    new RegExp(`Core feature complete[^\\n]*Slice ${coreCut}`, "i"),
    "planning core cut",
  );
  assertMatches(
    planningMilestones,
    new RegExp(`Optional platform complete[^\\n]*Slice ${optionalCut}`, "i"),
    "planning optional-platform cut",
  );
  assertMatches(
    planningMilestones,
    new RegExp(`Catalog complete[^\\n]*Slice ${catalogCompleteCut}`, "i"),
    "planning complete-catalog cut",
  );
  assertMatches(
    planningMilestones,
    /Optional platform complete[^\n]*(?:enabled|selected)[^\n]*P2[^\n]*(?:disableable|disabled)[^\n]*(?:core|CRM)/i,
    "planning optional-platform substantive meaning",
  );
  assertMatches(
    planningMilestones,
    /Catalog complete[^\n]*(?:all|every)[^\n]*P0[^\n]*P1[^\n]*P2/i,
    "planning catalog-complete substantive meaning",
  );
  assertMatches(
    planningMilestones,
    /AI-enabled complete[^\n]*approved AI[^\n]*product[^\n]*privacy[^\n]*provider-neutral[^\n]*(?:isolation|safety)[^\n]*evaluation/i,
    "planning AI-enabled substantive meaning",
  );
});

Deno.test("PRODUCT-001 AC-03 synchronizes subordinate planning without delivery claims", () => {
  const roadmapAssumption = markdownSection(roadmap, "Delivery Assumption");
  const decisionControl = markdownSection(roadmap, "Decision Gates");
  const traceIntro = traceability.slice(
    0,
    traceability.indexOf("## Module Delivery Matrix"),
  );
  const flowMatrix = markdownSection(traceability, "Flow-To-Slice Matrix");
  const pageMatrix = markdownSection(traceability, "Page Delivery Matrix");

  assertMatches(
    planningReadme,
    /PRODUCT-001[^\n]*(?:accepted|approval)/i,
    "planning status names accepted PRODUCT-001 subset",
  );
  assertIncludes(
    planningReadme,
    "30 total: 17 P0, 10 P1, and 3 P2",
    "planning catalog totals",
  );
  assertIncludes(
    planningReadme,
    "Delivered flows              | 0",
    "planning keeps zero delivered flows",
  );
  assertNotMatches(
    roadmapAssumption,
    /pending DG-07|pending[^.\n]*release-slice amendment/i,
    "roadmap cut is no longer pending",
  );
  assertMatches(
    decisionControl,
    /DG-07[^\n]*(?:PRODUCT-001|accepted subset)/i,
    "DG-07 records bounded acceptance",
  );
  assertMatches(
    decisionControl,
    /DG-07[^\n]*(?:follow-up|remain|deferred|open)/i,
    "DG-07 retains follow-up gates",
  );

  assertIncludes(
    traceIntro,
    "30 required flows: 17 P0, 10 P1, and 3 P2",
    "traceability catalog totals",
  );
  assertNotMatches(
    traceIntro,
    /proposed slice[^\n]*complete contract|DG-07[^\n]*before[^\n]*authoritative/i,
    "traceability assignments are accepted",
  );
  assertNotMatches(
    flowMatrix,
    /remains conditional on DG-07|proposed MVP/i,
    "flow cuts are no longer proposal-only",
  );
  assertNotMatches(
    pageMatrix,
    /proposed for Slice 1|DG-07[^\n]*public-product flow/i,
    "public-page Slice 1 assignment is accepted",
  );
});

Deno.test("PRODUCT-001 AC-04 keeps deferred product gates explicit and undecided", () => {
  const deferred = markdownSection(release, "Deferred Product Gates");
  for (
    const expected of [
      /life-event (?:mutation )?flow/i,
      /operations (?:user interface|UI)/i,
      /page\.flowIds/i,
      /state inheritance/i,
      /multi-workspace/i,
      /security settings/i,
      /avatar/i,
      /help|what(?:'|’)s new/i,
      /saved filters?/i,
      /external API parity/i,
      /P2 (?:page )?availability/i,
      /romantic metadata/i,
      /optional-source import/i,
    ]
  ) {
    assertMatches(deferred, expected, `deferred gate ${expected}`);
  }
  assertMatches(
    deferred,
    /no (?:new )?stable ID/i,
    "deferred gates add no stable ID",
  );
  assertMatches(
    deferred,
    /(?:no branch|does not choose|remain(?:s)? undecided)/i,
    "deferred gates choose no branch",
  );
  assertMatches(
    deferred,
    /`ready`[^\n]*`not-found`[^\n]*state inheritance[^\n]*(?:deferred|undecided|later)/i,
    "public states do not decide inheritance",
  );
});
