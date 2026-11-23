/**
 * The CI dependency gate (quality-gates.md, "Accepted dependency advisories").
 * It fails on every high or critical advisory and on every audit or registry
 * error, and carries no exception: the last one, for `braces`, ended when the
 * audit stopped reporting it (MCP-E4).
 */
if (import.meta.main) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["audit", "--level=high"],
    env: { DENO_NO_PACKAGE_JSON: "1", NO_COLOR: "1" },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(result.code);
}
