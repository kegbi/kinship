import { assertHardened, assertTunedPostgres } from "./compose_hardening.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function renderCompose(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    POSTGRES_PASSWORD: "compose-validation-only",
    POSTGRES_DB: "kinship",
    POSTGRES_USER: "kinship",
    PUBLIC_WEB_ORIGIN: "https://kinship.example.test",
    GATEWAY_TLS_CERTIFICATE_PATH: "../files/gateway.crt",
    GATEWAY_TLS_PRIVATE_KEY_PATH: "../files/gateway.key",
    RUSTFS_ADMIN_ACCESS_KEY: "validation-admin",
    RUSTFS_ADMIN_SECRET_KEY: "validation-admin-secret",
    OBJECT_STORAGE_ACCESS_KEY: "validation-app",
    OBJECT_STORAGE_SECRET_KEY: "validation-app-secret",
    OBJECT_STORAGE_BUCKET: "kinship-files",
    OBJECT_STORAGE_HOST: "kinship-storage",
    SMTP_PORT: "465",
    SMTP_SECURITY: "tls",
    GATEWAY_TRUSTED_PROXY: "10.0.1.40",
    ...overrides,
  };
  return new Deno.Command("docker", {
    args: [
      "compose",
      "-f",
      "compose.dokploy.yaml",
      "config",
      "--format",
      "json",
    ],
    env: Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] =>
        entry[1] !== undefined
      ),
    ),
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("OPS-001E Dokploy requires explicit SMTP settings shared by preflight and both runtimes", async () => {
  for (const name of ["SMTP_PORT", "SMTP_SECURITY"]) {
    const output = await renderCompose({ [name]: "" });
    assert(
      !output.success,
      `${name} must be explicitly configured before deployment`,
    );
    assert(
      new TextDecoder().decode(output.stderr).includes(name),
      `${name} refusal identifies the missing setting`,
    );
  }
  const output = await renderCompose();
  assert(output.success, "explicit SMTP settings must render");
  const { services } = JSON.parse(new TextDecoder().decode(output.stdout));
  for (const name of ["preflight", "api", "worker"]) {
    assert(
      services[name].environment.SMTP_PORT === "465",
      `${name} uses configured SMTP port`,
    );
    assert(
      services[name].environment.SMTP_SECURITY === "tls",
      `${name} uses configured SMTP security`,
    );
  }
});

Deno.test("OPS-001E Dokploy keeps storage private and gates application startup on scoped initialization", async () => {
  const output = await renderCompose();
  assert(output.success, "Dokploy Compose must render successfully");
  const model = JSON.parse(new TextDecoder().decode(output.stdout));
  const { services } = model;
  for (const name of ["api", "web"]) {
    assert(
      services[name].networks?.default?.aliases?.includes(
        `kinship-private-${name}`,
      ),
      `${name} has a distinct private-network DNS alias`,
    );
  }
  assert(
    Object.keys(services).length === 9,
    "six application services plus storage, initialization and preflight",
  );
  for (
    const [name, service] of Object.entries(services) as [
      string,
      { ports?: unknown[]; networks?: Record<string, unknown> },
    ][]
  ) {
    if (name !== "gateway") {
      assert(!service.ports?.length, `${name} has no published ports`);
      assert(
        !("dokploy-network" in (service.networks ?? {})),
        `${name} has no proxy network access`,
      );
    }
  }
  assert(
    "dokploy-network" in services.gateway.networks,
    "only gateway joins Dokploy edge network",
  );
  assert(
    model.networks["dokploy-network"].external,
    "edge network is externally managed",
  );
  for (const name of ["api", "worker"]) {
    const service = services[name];
    assert(
      service.environment.OBJECT_STORAGE_HOST === "kinship-storage",
      `${name} uses private storage`,
    );
    assert(
      service.environment.OBJECT_STORAGE_USE_SSL === "true",
      `${name} verifies storage TLS`,
    );
    assert(
      service.environment.DENO_CERT === "/run/secrets/storage_ca",
      `${name} trusts only supplied additional CA`,
    );
    assert(
      !service.environment.RUSTFS_ADMIN_SECRET_KEY,
      `${name} has no storage administrator secret`,
    );
    assert(
      service.depends_on["storage-init"].condition ===
        "service_completed_successfully",
      `${name} waits for scoped identity`,
    );
    assert(
      service.depends_on.migrate.condition === "service_completed_successfully",
      `${name} still waits for migrations`,
    );
  }
  const storage = services["kinship-storage"];
  assert(
    storage.image.includes("1.0.0-beta.12@sha256:"),
    "RustFS stays pinned",
  );
  assert(
    storage.environment.RUSTFS_TLS_PATH === "/run/secrets/storage",
    "storage serves TLS",
  );
  assert(
    storage.environment.RUSTFS_CONSOLE_ENABLE === "false",
    "storage console is disabled",
  );
  assert(
    storage.volumes.some((v: { type: string; target: string }) =>
      v.type === "volume" && v.target === "/data"
    ),
    "object bytes use a named volume",
  );
  assert(
    storage.healthcheck.test.includes("--cacert"),
    "storage health verifies CA",
  );
});

Deno.test("[AUD-G4] Dokploy hardens every service and inherits the tuned PostgreSQL", async () => {
  const output = await renderCompose();
  assert(output.success, "Dokploy Compose must render successfully");
  const { services } = JSON.parse(new TextDecoder().decode(output.stdout));
  assertHardened(services, "compose.dokploy.yaml");
  assertTunedPostgres(services, "compose.dokploy.yaml");
});

Deno.test("[AUD-G4] the trusted proxy comes from deployment configuration and fails closed", async () => {
  for (const value of [undefined, ""]) {
    const output = await renderCompose({ GATEWAY_TRUSTED_PROXY: value });
    assert(!output.success, "the trusted proxy has no default");
    assert(
      new TextDecoder().decode(output.stderr).includes("GATEWAY_TRUSTED_PROXY"),
      "the refusal names the missing setting",
    );
  }
  const output = await renderCompose({ GATEWAY_TRUSTED_PROXY: "10.0.7.9" });
  assert(output.success, "a configured proxy renders");
  const { services } = JSON.parse(new TextDecoder().decode(output.stdout));
  for (const name of ["preflight", "gateway"]) {
    assert(
      services[name].environment.GATEWAY_TRUSTED_PROXY === "10.0.7.9",
      `${name} receives the configured proxy`,
    );
  }
  const gateway = services.gateway;
  const directory = "/etc/nginx/trusted-proxy.d";
  assert(
    gateway.environment.NGINX_ENVSUBST_OUTPUT_DIR === directory &&
      // `config` prints Compose's escaped form; the container gets one `$`.
      gateway.environment.NGINX_ENVSUBST_FILTER === "^GATEWAY_TRUSTED_PROXY$$",
    "nginx renders only the trusted proxy into the included directory",
  );
  assert(
    gateway.tmpfs.some((entry: string) => entry.startsWith(`${directory}:`)),
    "the rendered include lives in a private tmpfs on a read-only gateway",
  );
  assert(gateway.read_only === true, "the gateway stays read-only");
  assert(
    services.preflight.command.some((argument: string) =>
      argument.startsWith("--allow-env=") &&
      argument.split(",").includes("GATEWAY_TRUSTED_PROXY")
    ),
    "preflight may read the proxy it validates",
  );
  const nginx = await Deno.readTextFile("gateway/nginx.conf");
  const template = await Deno.readTextFile("gateway/dokploy-proxy.conf");
  assert(
    nginx.includes(`include ${directory}/*.conf;`),
    "proxy trust is opt-in",
  );
  assert(
    template.includes("set_real_ip_from ${GATEWAY_TRUSTED_PROXY};"),
    "the template trusts exactly the configured address",
  );
  assert(
    !/\d+\.\d+\.\d+\.\d+/.test(template),
    "the template carries no literal address",
  );
  const dockerfile = await Deno.readTextFile("Dockerfile.web");
  assert(
    dockerfile.includes(
      "COPY gateway/dokploy-proxy.conf /etc/nginx/trusted-proxy-templates/dokploy.conf.template",
    ),
    "the gateway image carries the reviewed template outside nginx's default template directory",
  );
  assert(
    gateway.environment.NGINX_ENVSUBST_TEMPLATE_DIR ===
      "/etc/nginx/trusted-proxy-templates",
    "only Dokploy points nginx at the template",
  );
});
