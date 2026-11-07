import {
  assertHardened,
  assertTunedPostgres,
  type HardenedService,
} from "./compose_hardening.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface ComposeModel {
  readonly services: Readonly<
    Record<
      string,
      HardenedService & {
        readonly depends_on?: Readonly<Record<string, unknown>>;
        readonly environment?: Readonly<Record<string, string>>;
        readonly healthcheck?: unknown;
        readonly image?: string;
        readonly read_only?: boolean;
        readonly stop_grace_period?: string;
      }
    >
  >;
}

async function renderCompose(files: readonly string[]): Promise<ComposeModel> {
  const command = new Deno.Command("docker", {
    args: [
      "compose",
      ...files.flatMap((file) => ["-f", file]),
      "config",
      "--format",
      "json",
    ],
    env: { POSTGRES_PASSWORD: "compose-validation-only" },
    stderr: "piped",
    stdout: "piped",
  });
  const output = await command.output();
  assert(
    output.success,
    `Compose render failed with exit ${output.code}: ${
      new TextDecoder().decode(output.stderr)
    }`,
  );
  return JSON.parse(new TextDecoder().decode(output.stdout)) as ComposeModel;
}

Deno.test("OPS-001D production Compose excludes capture mail", async () => {
  const production = await renderCompose(["compose.yaml"]);
  const api = production.services.api;
  assert(api, "production includes API");
  assert(!production.services.mailpit, "production has no Mailpit service");
  assert(
    !api.depends_on?.mailpit,
    "production API has no capture-mail dependency",
  );
});

Deno.test("OPS-001D dev and test Compose retain isolated capture mail", async () => {
  for (const overlay of ["compose.dev.yaml", "compose.test.yaml"] as const) {
    const compose = await renderCompose(["compose.yaml", overlay]);
    const api = compose.services.api;
    assert(api, `${overlay} includes API`);
    assert(compose.services.mailpit, `${overlay} includes Mailpit`);
    assert(
      api.depends_on?.mailpit,
      `${overlay} waits for healthy Mailpit`,
    );
    assert(
      api.environment?.SMTP_HOST === "mailpit" &&
        api.environment?.SMTP_SECURITY === "plain",
      `${overlay} keeps local capture delivery`,
    );
  }
});

Deno.test("GAP-041 dev and test share one local support definition", async () => {
  const [development, test] = await Promise.all([
    renderCompose(["compose.yaml", "compose.dev.yaml"]),
    renderCompose(["compose.yaml", "compose.test.yaml"]),
  ]);
  for (const name of ["mailpit", "object-store"] as const) {
    const shared = (model: ComposeModel) => {
      const service = model.services[name];
      assert(service, `both overlays include ${name}`);
      const { environment, healthcheck, image, read_only, stop_grace_period } =
        service;
      return JSON.stringify({
        environment,
        healthcheck,
        image,
        read_only,
        stop_grace_period,
      });
    };
    assert(
      shared(development) === shared(test),
      `dev and test render ${name} from the same compose.support.yaml definition`,
    );
  }
});

Deno.test("[AUD-G4] every service drops capabilities, forbids privilege gain, and has memory and pid limits", async () => {
  for (
    const files of [
      ["compose.yaml"],
      ["compose.yaml", "compose.dev.yaml"],
      ["compose.yaml", "compose.test.yaml"],
    ] as const
  ) {
    const model = await renderCompose(files);
    assertHardened(model.services, files.join(" + "));
  }
});

Deno.test("[AUD-G4] PostgreSQL starts tuned with pg_stat_statements preloaded", async () => {
  for (
    const files of [
      ["compose.yaml"],
      ["compose.yaml", "compose.dev.yaml"],
      ["compose.yaml", "compose.test.yaml"],
    ] as const
  ) {
    assertTunedPostgres(
      (await renderCompose(files)).services,
      files.join(" + "),
    );
  }
});
