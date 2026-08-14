import { browserSecurityPolicy } from "./security_config.ts";
import { createApiRuntime } from "./main.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("browser handoff policy is strict outside explicit loopback HTTP", () => {
  assert(
    !browserSecurityPolicy("development", "http://127.0.0.1:4321").secureCookie,
    "loopback development may use an insecure cookie",
  );
  assert(
    browserSecurityPolicy("production", "https://kinship.example").secureCookie,
    "production HTTPS requires Secure",
  );
  for (
    const [environment, origin] of [
      ["production", "http://127.0.0.1:4321"],
      ["development", "http://kinship.example"],
      ["test", "https://kinship.example/path"],
    ] as const
  ) {
    let rejected = false;
    try {
      browserSecurityPolicy(environment, origin);
    } catch {
      rejected = true;
    }
    assert(rejected, `${environment} ${origin} must fail closed`);
  }
});

Deno.test("invalid SMTP configuration fails before database composition or serving", () => {
  for (
    const [name, value] of [
      ["SMTP_PORT", "NaN"],
      ["SMTP_PORT", "8.5"],
      ["SMTP_PORT", "0"],
      ["SMTP_PORT", "65536"],
      ["SMTP_FROM", "hello@example.test\r\nBcc: attacker@example.test"],
      ["SMTP_FROM", "not-a-mailbox"],
    ] as const
  ) {
    let composed = false;
    let error: unknown;
    try {
      createApiRuntime(
        {
          get: (requested) =>
            ({
              APP_ENV: "test",
              DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
              PUBLIC_WEB_ORIGIN: "http://127.0.0.1:4321",
              SMTP_FROM: "hello@kinship.local",
              SMTP_HOST: "127.0.0.1",
              SMTP_PORT: "1025",
              [name]: value,
            })[requested],
        },
        () => {
          composed = true;
          throw new Error("database composition must not be reached");
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, `${name}=${value} must fail startup`);
    assert(
      !composed,
      `${name}=${value} must fail before database composition and Deno.serve`,
    );
  }
});
