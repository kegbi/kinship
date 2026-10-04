/**
 * Temporary tooling-only exception approved 2026-10-04 in quality-gates.md.
 * Deno 2.9.5 has no JSON audit output, and its native ignore option does not
 * exclude this advisory. Accept only the exact high finding and summary;
 * additional findings, errors, or output format changes fail closed.
 */
export function acceptsToolingAdvisory(
  code: number,
  output: string,
): boolean {
  const expectedFinding =
    "╭ braces vulnerable to stack-exhaustion denial of service through deeply nested patterns\n" +
    "│ Severity:   high\n" +
    "│ Package:    braces\n" +
    "│ Vulnerable: <=3.0.3\n" +
    "╰ Info:       https://github.com/advisories/GHSA-vfj7-8cjw-p6xm\n\n";
  const normalized = output.replaceAll("\r\n", "\n").trim();
  if (code !== 1 || !normalized.startsWith(expectedFinding)) return false;
  const summary = normalized.slice(expectedFinding.length);
  return /^Found \d+ vulnerabilities\nSeverity: \d+ low, \d+ moderate, 1 high, 0 critical$/
    .test(summary);
}

if (import.meta.main) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["audit", "--level=high"],
    env: { DENO_NO_PACKAGE_JSON: "1", NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.stdout.write(result.stdout);
  await Deno.stderr.write(result.stderr);
  const decoder = new TextDecoder();
  const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
  if (acceptsToolingAdvisory(result.code, output)) {
    console.error(
      "Accepted temporary tooling exception: GHSA-vfj7-8cjw-p6xm (quality-gates.md).",
    );
    Deno.exit(0);
  }
  Deno.exit(result.code);
}
