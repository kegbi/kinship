const PROFILE_PATH = "docs/planning/mvp-capacity-profile.json";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

interface MvpCapacityProfile {
  readonly checkpoint: string;
  readonly clients: {
    readonly browserEngines: readonly string[];
    readonly primary: string;
    readonly responsiveSmoke: {
      readonly height: number;
      readonly width: number;
    };
    readonly timingEngine: string;
  };
  readonly concurrency: {
    readonly burstUsers: number;
    readonly steadyUsers: number;
    readonly workspaces: number;
  };
  readonly datasets: Readonly<
    Record<"large" | "medium" | "small", {
      readonly historyRecords: number;
      readonly people: number;
    }>
  >;
  readonly functionalCeilingsMs: {
    readonly boundedImportExportCompletion: number;
    readonly interactivePage: number;
    readonly ordinaryApiMutation: number;
    readonly ordinaryApiRead: number;
    readonly representativeQuery: number;
    readonly workerDueToDelivery: number;
  };
  readonly functionalBoundaryGuards: Readonly<
    Record<
      string,
      readonly { readonly markers: readonly string[]; readonly path: string }[]
    >
  >;
  readonly largeBoundaryUse: readonly string[];
  readonly longRunningWork: {
    readonly currentPortableMaxPeople: number;
    readonly largeFileRepresentation: string;
    readonly note: string;
    readonly operations: readonly string[];
    readonly requirements: readonly string[];
  };
}

async function loadProfile(): Promise<MvpCapacityProfile> {
  return JSON.parse(
    await Deno.readTextFile(PROFILE_PATH),
  ) as MvpCapacityProfile;
}

Deno.test("PERF-001 fixes the accepted MVP capacity and latency profile", async () => {
  const profile = await loadProfile();

  assertEquals(profile.checkpoint, "mvp-feature-acceptance");
  assertEquals(profile.concurrency, {
    burstUsers: 3,
    steadyUsers: 1,
    workspaces: 1,
  });
  assertEquals(profile.clients, {
    browserEngines: ["chromium", "firefox", "webkit"],
    primary: "desktop",
    responsiveSmoke: { height: 844, width: 390 },
    timingEngine: "chromium",
  });
  assertEquals(profile.datasets, {
    large: { historyRecords: 250_000, people: 10_000 },
    medium: { historyRecords: 50_000, people: 2_000 },
    small: { historyRecords: 5_000, people: 250 },
  });
  assertEquals(profile.functionalCeilingsMs, {
    boundedImportExportCompletion: 10_000,
    interactivePage: 2_000,
    ordinaryApiMutation: 1_000,
    ordinaryApiRead: 500,
    representativeQuery: 250,
    workerDueToDelivery: 10_000,
  });
  assertEquals(profile.largeBoundaryUse, [
    "cursor-pagination",
    "import-export-manifest-accounting",
    "growth-regression",
  ]);
  assertEquals(profile.longRunningWork, {
    currentPortableMaxPeople: 500,
    largeFileRepresentation: "metadata-and-manifests",
    note:
      "The delivered portable payload remains bounded to 500 people. A future operation above that bound must run as durable background work and must not extend an ordinary request timeout.",
    operations: ["import", "export"],
    requirements: [
      "durable-status",
      "visible-status",
      "resumable-or-retryable",
    ],
  });
});

Deno.test("PERF-001 keeps functional regression guards beside measured boundaries", async () => {
  const profile = await loadProfile();
  assertEquals(Object.keys(profile.functionalBoundaryGuards).sort(), [
    "api",
    "export",
    "import",
    "page",
    "query",
    "worker",
  ]);

  for (const proofs of Object.values(profile.functionalBoundaryGuards)) {
    for (const proof of proofs) {
      const source = await Deno.readTextFile(proof.path);
      for (const marker of proof.markers) {
        if (!source.includes(marker)) {
          throw new Error(
            `functional marker drifted from ${proof.path}: ${marker}`,
          );
        }
      }
    }
  }
});
