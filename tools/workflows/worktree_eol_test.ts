const decoder = new TextDecoder();

function gitAttribute(attribute: string, path: string): string {
  const output = new Deno.Command("git", {
    args: ["check-attr", attribute, "--", path],
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

Deno.test("normal text is LF while the audited schema keeps repository bytes", () => {
  assertEquals(gitAttribute("eol", "AGENTS.md"), "AGENTS.md: eol: lf");
  assertEquals(
    gitAttribute(
      "text",
      "personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
    ),
    "personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql: text: unset",
  );
});
