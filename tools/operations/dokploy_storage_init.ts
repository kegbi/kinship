export interface StorageCommand {
  readonly args: readonly string[];
  readonly environment: Record<string, string>;
  readonly input?: string;
}

export async function initializeStorage(
  environment: Record<string, string>,
  run: (command: StorageCommand) => Promise<void>,
  writePolicy: (policy: string) => Promise<void>,
): Promise<void> {
  const bucket = environment.OBJECT_STORAGE_BUCKET;
  const access = environment.OBJECT_STORAGE_ACCESS_KEY;
  const secret = environment.OBJECT_STORAGE_SECRET_KEY;
  const adminAccess = environment.RUSTFS_ADMIN_ACCESS_KEY;
  const adminSecret = environment.RUSTFS_ADMIN_SECRET_KEY;
  if (
    !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    !access || !secret || !adminAccess || !adminSecret ||
    access === adminAccess || secret === adminSecret ||
    [access, secret, adminAccess, adminSecret].some((value) =>
      /[\r\n]/.test(value)
    )
  ) {
    throw new Error("Invalid storage initialization configuration");
  }
  const alias = (key: string, password: string) =>
    `https://${encodeURIComponent(key)}:${
      encodeURIComponent(password)
    }@kinship-storage:9000`;
  const admin = { MC_HOST_storage: alias(adminAccess, adminSecret) };
  const app = { MC_HOST_storage: alias(access, secret) };
  await writePolicy(JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
        ],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  }));
  await run({
    args: ["mb", "--ignore-existing", `storage/${bucket}`],
    environment: admin,
  });
  await run({
    args: [
      "admin",
      "policy",
      "create",
      "storage",
      "kinship-objects",
      "/tmp/policy.json",
    ],
    environment: admin,
  });
  await run({
    args: ["admin", "user", "add", "storage"],
    environment: admin,
    input: `${access}\n${secret}\n`,
  });
  await run({
    args: [
      "admin",
      "policy",
      "attach",
      "storage",
      "kinship-objects",
      "--user",
      access,
    ],
    environment: admin,
  });
  await run({ args: ["ls", `storage/${bucket}`], environment: app });
}

async function run(command: StorageCommand): Promise<void> {
  const child = new Deno.Command("/usr/local/bin/mc", {
    args: ["--config-dir", "/tmp/mc", "--quiet", ...command.args],
    env: command.environment,
    stdin: "piped",
    stdout: "null",
    stderr: "null",
    signal: AbortSignal.timeout(60_000),
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    if (command.input) {
      await writer.write(new TextEncoder().encode(command.input));
    }
    await writer.close();
    if (!(await child.status).success) {
      throw new Error("Storage initialization command failed");
    }
  } catch {
    // Never report mc diagnostics: they may contain credentials or object keys.
    await child.status.catch(() => {});
    throw new Error("Storage initialization command failed");
  }
}

if (import.meta.main) {
  try {
    await Deno.mkdir("/tmp/mc/certs/CAs", { recursive: true });
    await Deno.copyFile(
      "/run/secrets/storage_ca",
      "/tmp/mc/certs/CAs/storage.crt",
    );
    const environment = Object.fromEntries([
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_ACCESS_KEY",
      "OBJECT_STORAGE_SECRET_KEY",
      "RUSTFS_ADMIN_ACCESS_KEY",
      "RUSTFS_ADMIN_SECRET_KEY",
    ].map((name) => [name, Deno.env.get(name) ?? ""]));
    await initializeStorage(
      environment,
      run,
      (policy) => Deno.writeTextFile("/tmp/policy.json", policy),
    );
    console.log('{"event":"operator.storage_initialization","state":"ready"}');
  } catch {
    console.error(
      '{"event":"operator.storage_initialization","state":"blocked"}',
    );
    Deno.exit(1);
  }
}
