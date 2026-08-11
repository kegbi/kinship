const decoder = new TextDecoder();

function git(...args: string[]): string {
  const output = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  if (!output.success) {
    throw new Error(decoder.decode(output.stderr).trim());
  }

  return decoder.decode(output.stdout).trim();
}

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("LF applies across normal paths and every schema artifact stays binary", () => {
  for (
    const path of [
      "AGENTS.md",
      "docs/development/autonomous-delivery.md",
      ".codex/config.toml",
    ]
  ) {
    assertEquals(git("check-attr", "text", "--", path), `${path}: text: auto`);
    assertEquals(git("check-attr", "eol", "--", path), `${path}: eol: lf`);
  }

  const schemaPaths = git("ls-files", "--", "personal-crm-schema/v1")
    .split(/\r?\n/u)
    .filter((path) => path.length > 0);
  if (schemaPaths.length === 0) {
    throw new Error("Expected tracked schema artifacts");
  }

  for (const path of schemaPaths) {
    if (path.endsWith(".csv")) {
      assertEquals(
        git("check-attr", "text", "--", path),
        `${path}: text: set`,
      );
      assertEquals(
        git("check-attr", "eol", "--", path),
        `${path}: eol: crlf`,
      );
    } else {
      assertEquals(
        git("check-attr", "text", "--", path),
        `${path}: text: unset`,
      );
    }
  }
});
