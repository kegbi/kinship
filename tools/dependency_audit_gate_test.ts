import { acceptsToolingAdvisory } from "./dependency_audit_gate.ts";

const braces =
  `╭ braces vulnerable to stack-exhaustion denial of service through deeply nested patterns
│ Severity:   high
│ Package:    braces
│ Vulnerable: <=3.0.3
╰ Info:       https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

Found 4 vulnerabilities
Severity: 0 low, 3 moderate, 1 high, 0 critical
`;

Deno.test("audit gate accepts only the approved tooling finding", () => {
  if (!acceptsToolingAdvisory(1, braces)) {
    throw new Error("the exact approved advisory should be accepted");
  }
  if (!acceptsToolingAdvisory(1, braces.replaceAll("\n", "\r\n"))) {
    throw new Error("Windows line endings should preserve the same result");
  }
});

Deno.test("audit gate fails closed for other findings and audit errors", () => {
  for (
    const [code, output] of [
      [1, braces.replace("GHSA-vfj7-8cjw-p6xm", "GHSA-aaaa-bbbb-cccc")],
      [1, braces.replace("│ Package:    braces", "│ Package:    other")],
      [1, braces.replace("1 high", "2 high")],
      [1, braces.replace("0 critical", "1 critical")],
      [1, braces + "Registry request failed\n"],
      [1, "Registry request failed\n"],
      [1, braces + braces],
      [2, braces],
      [1, ""],
    ] as const
  ) {
    if (acceptsToolingAdvisory(code, output)) {
      throw new Error(`unexpected acceptance: ${code} ${output}`);
    }
  }
});
