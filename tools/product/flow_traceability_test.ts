/**
 * GAP-036: `docs/product/user-flows.yaml` and the Playwright specs agree on
 * which spec proves which flow. Every required flow's `testRefs` exist and
 * carry a test annotated with that flow, and every `flow` annotation names a
 * flow whose `testRefs` include its spec.
 */
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";

const repository = new URL("../../", import.meta.url);
const specDirectory = "tests/e2e";

interface FlowTrace {
  readonly id: string;
  readonly deliveryStatus: string;
  readonly required: boolean;
  readonly testRefs: readonly string[];
}

interface SpecTrace {
  readonly path: string;
  readonly flowAnnotations: readonly string[];
}

/** Reads each flow's id, delivery status, and E2E requirement. */
export function parseFlows(catalog: string): FlowTrace[] {
  const flows = catalog.split(/^ {2}- id: /m).slice(1);
  return flows.map((block) => {
    const id = block.slice(0, block.indexOf("\n")).trim();
    const e2e = block.match(/^ {4}e2e: (\{[^}]*\})/m)?.[1];
    assert(e2e !== undefined, `${id} has no e2e contract`);
    const testRefs = e2e.match(/testRefs: \[([^\]]*)\]/)?.[1];
    assert(testRefs !== undefined, `${id} has no e2e testRefs`);
    return {
      id,
      deliveryStatus: block.match(/^ {4}deliveryStatus: (\S+)$/m)?.[1] ??
        "planned",
      required: /required: true/.test(e2e),
      testRefs: testRefs.split(",").map((ref) => ref.trim()).filter((ref) =>
        ref !== ""
      ),
    };
  });
}

/**
 * Reads the flow IDs a spec's tests carry as `flow` annotations: every
 * `{ type, description }` object literal, keys in either order, quoted with
 * either quote style.
 */
export function flowAnnotations(source: string): string[] {
  const ids: string[] = [];
  for (const object of source.matchAll(/\{([^{}]*)\}/g)) {
    const body = object[1]!;
    const type = body.match(/\btype:\s*(["'])(.*?)\1/)?.[2];
    const description = body.match(/\bdescription:\s*(["'])(.*?)\1/)?.[2];
    if (type === "flow" && description !== undefined) ids.push(description);
  }
  return ids;
}

/** Lists what disagrees between the flow catalog and the specs. */
export function traceabilityProblems(
  flows: readonly FlowTrace[],
  specs: readonly SpecTrace[],
): string[] {
  const problems: string[] = [];
  const specsByPath = new Map(specs.map((spec) => [spec.path, spec]));
  const flowsById = new Map(flows.map((flow) => [flow.id, flow]));
  for (const flow of flows) {
    if (!flow.required) continue;
    if (flow.deliveryStatus === "delivered" && flow.testRefs.length === 0) {
      problems.push(`${flow.id} is delivered without an E2E testRef`);
    }
    for (const ref of flow.testRefs) {
      const spec = specsByPath.get(ref);
      if (!spec) {
        problems.push(`${flow.id} names missing spec ${ref}`);
      } else if (!spec.flowAnnotations.includes(flow.id)) {
        problems.push(`${ref} has no test annotated with flow ${flow.id}`);
      }
    }
  }
  for (const spec of specs) {
    for (const id of new Set(spec.flowAnnotations)) {
      const flow = flowsById.get(id);
      if (!flow) {
        problems.push(`${spec.path} annotates unknown flow ${id}`);
      } else if (!flow.testRefs.includes(spec.path)) {
        problems.push(`${spec.path} annotates ${id}, whose testRefs omit it`);
      }
    }
    const named = spec.path.match(/\.([A-Z]+-\d+[A-Z]?)\.spec\.ts$/)?.[1];
    if (
      named && flowsById.has(named) && !spec.flowAnnotations.includes(named)
    ) {
      problems.push(`${spec.path} is named for ${named} but not annotated`);
    }
  }
  return problems;
}

async function specTraces(): Promise<SpecTrace[]> {
  const specs: SpecTrace[] = [];
  async function walk(directory: string): Promise<void> {
    for await (
      const entry of Deno.readDir(new URL(`${directory}/`, repository))
    ) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.name.endsWith(".spec.ts")) {
        specs.push({
          path,
          flowAnnotations: flowAnnotations(
            await Deno.readTextFile(new URL(path, repository)),
          ),
        });
      }
    }
  }
  await walk(specDirectory);
  return specs.sort((left, right) => left.path.localeCompare(right.path));
}

Deno.test("[GAP-036] required flows and E2E flow annotations agree", async () => {
  const flows = parseFlows(
    await Deno.readTextFile(
      new URL("docs/product/user-flows.yaml", repository),
    ),
  );
  const specs = await specTraces();
  assert(flows.length > 0, "the flow catalog lists flows");
  assert(
    specs.some((spec) => spec.flowAnnotations.length > 0),
    "the specs carry flow annotations",
  );
  assertEquals(traceabilityProblems(flows, specs), []);
});

Deno.test("[GAP-036] the traceability check reports each disagreement", () => {
  const flows = parseFlows(`flows:
  - id: AUTH-001
    deliveryStatus: delivered
    e2e: { required: true, testRefs: [tests/e2e/registration.AUTH-001.spec.ts] }

  - id: PEOPLE-002
    deliveryStatus: delivered
    e2e: {
      required: true,
      testRefs: [
        tests/e2e/people-directory.PEOPLE-002.spec.ts,
        tests/e2e/missing.PEOPLE-002.spec.ts,
      ],
    }

  - id: TODAY-001
    deliveryStatus: delivered
    e2e: { required: true, testRefs: [] }

  - id: BILLING-001
    e2e: { required: true, testRefs: [] }

  - id: OPTIONAL-001
    deliveryStatus: delivered
    e2e: { required: false, testRefs: [tests/e2e/absent.OPTIONAL-001.spec.ts] }
`);
  assertEquals(flows.map((flow) => flow.testRefs.length), [1, 2, 0, 0, 1]);
  assertEquals(flows.map((flow) => flow.required), [
    true,
    true,
    true,
    true,
    false,
  ]);
  const annotated = flowAnnotations(`test("[AUTH-001] a", {
  annotation: [
    { type: "flow", description: "AUTH-001" },
    { type: "leaf", description: "APP-001" },
  ],
}, async () => {});
test("b", { annotation: { type: "flow", description: "PEOPLE-009" } });
test("c", { annotation: [{ description: 'TODAY-001', type: 'flow' }] });
test("d", { annotation: { description: "APP-002C", type: "leaf" } });`);
  assertEquals(annotated, ["AUTH-001", "PEOPLE-009", "TODAY-001"]);

  assertEquals(
    traceabilityProblems(flows, [
      {
        path: "tests/e2e/registration.AUTH-001.spec.ts",
        flowAnnotations: ["AUTH-001", "PEOPLE-009"],
      },
      {
        path: "tests/e2e/people-directory.PEOPLE-002.spec.ts",
        flowAnnotations: [],
      },
      { path: "tests/e2e/shell.TODAY-001.spec.ts", flowAnnotations: [] },
    ]),
    [
      "tests/e2e/people-directory.PEOPLE-002.spec.ts has no test annotated with flow PEOPLE-002",
      "PEOPLE-002 names missing spec tests/e2e/missing.PEOPLE-002.spec.ts",
      "TODAY-001 is delivered without an E2E testRef",
      "tests/e2e/registration.AUTH-001.spec.ts annotates unknown flow PEOPLE-009",
      "tests/e2e/people-directory.PEOPLE-002.spec.ts is named for PEOPLE-002 but not annotated",
      "tests/e2e/shell.TODAY-001.spec.ts is named for TODAY-001 but not annotated",
    ],
  );
  assertEquals(
    traceabilityProblems(flows.slice(0, 1), [
      {
        path: "tests/e2e/registration.AUTH-001.spec.ts",
        flowAnnotations: ["AUTH-001"],
      },
      {
        path: "tests/e2e/other.spec.ts",
        flowAnnotations: ["AUTH-001"],
      },
    ]),
    [
      "tests/e2e/other.spec.ts annotates AUTH-001, whose testRefs omit it",
    ],
  );
});
