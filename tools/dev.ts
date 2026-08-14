const tasks = ["dev:api", "dev:web"] as const;

const children = tasks.map((task) =>
  new Deno.Command(Deno.execPath(), {
    args: ["task", task],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn()
);

const statuses = children.map((child, index) =>
  child.status.then((status) => ({ index, status }))
);

try {
  const first = await Promise.race(statuses);
  if (!first.status.success) {
    throw new Error(
      `${tasks[first.index]} exited with code ${first.status.code}`,
    );
  }
} finally {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process already exited.
    }
  }
  await Promise.allSettled(statuses);
}
