// GAP-002 (REL-031): the canonical Astro child probe intermittently failed its
// readiness deadline inside the root coverage aggregate while a single isolated
// run passed. One sample cannot prove a timing contract, so this reproduction
// runs the real probe under coverage three times.
//
// It is deliberately excluded from the aggregate gates; run it on demand with
// `deno task test:repro:astro-readiness`.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROBE = "E2E canonical Astro child remains live outside CI";
const RUNS = 3;

Deno.test(
  "[GAP-002] the canonical Astro readiness probe passes three coverage runs",
  async () => {
    for (let run = 1; run <= RUNS; run += 1) {
      const output = await new Deno.Command("deno", {
        args: [
          "test",
          "--clean",
          "--coverage=.coverage/astro-readiness",
          "--coverage-raw-data-only",
          "--allow-env=CI",
          "--allow-net",
          "--allow-run=deno,powershell",
          `--filter=${PROBE}`,
          "tools/e2e_test.ts",
        ],
        cwd: new URL("../", import.meta.url),
        env: { DENO_NO_PACKAGE_JSON: "1" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const report = [output.stdout, output.stderr]
        .map((stream) => new TextDecoder().decode(stream))
        .join("\n");
      assert(
        output.success,
        `coverage run ${run} of "${PROBE}" exited ${output.code}\n${report}`,
      );
      // A renamed probe would filter every test out and still exit zero.
      assert(
        /\b1 passed\b/.test(report),
        `coverage run ${run} did not execute "${PROBE}"\n${report}`,
      );
    }
  },
);
