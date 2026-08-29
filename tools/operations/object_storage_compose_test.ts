function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const decoder = new TextDecoder();

function composeCommand(
  projectName: string,
  args: readonly string[],
): Deno.Command {
  return new Deno.Command("docker", {
    args: [
      "compose",
      "--file",
      "compose.yaml",
      "--file",
      "compose.test.yaml",
      "--project-name",
      projectName,
      ...args,
    ],
    env: { POSTGRES_PASSWORD: "compose-validation-only" },
    stderr: "piped",
    stdout: "piped",
  });
}

function outputDetails(output: Deno.CommandOutput): string {
  return `stdout:\n${decoder.decode(output.stdout)}\nstderr:\n${
    decoder.decode(output.stderr)
  }`;
}

Deno.test("REL-012 test object storage reaches healthy", async () => {
  const projectName = `kinship-rel-012-${crypto.randomUUID().slice(0, 8)}`;
  let startup: Deno.CommandOutput | undefined;
  let cleanup: Deno.CommandOutput | undefined;

  try {
    startup = await composeCommand(projectName, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "60",
      "object-store",
    ]).output();
  } finally {
    cleanup = await composeCommand(projectName, [
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "10",
    ]).output();
  }

  assert(startup, "Object storage startup command did not return output");
  assert(
    startup.success,
    `Object storage failed to become healthy (exit ${startup.code}). ${
      outputDetails(startup)
    }`,
  );
  assert(cleanup, "Object storage cleanup command did not return output");
  assert(
    cleanup.success,
    `Object storage cleanup failed (exit ${cleanup.code}). ${
      outputDetails(cleanup)
    }`,
  );
});
