/**
 * AUD-G4 expectations shared by the Compose contract tests: every rendered
 * service is hardened, and PostgreSQL starts tuned and observable.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface HardenedService {
  readonly cap_add?: readonly string[];
  readonly cap_drop?: readonly string[];
  readonly command?: readonly string[] | null;
  readonly mem_limit?: string;
  readonly pids_limit?: number;
  readonly security_opt?: readonly string[];
  readonly shm_size?: string | number;
}

/**
 * The only capabilities any service gets back after `cap_drop: [ALL]`. The
 * PostgreSQL entrypoint starts as root, takes ownership of the data and socket
 * directories (`CHOWN`), walks an existing 0700 data directory
 * (`DAC_READ_SEARCH`), and drops to the `postgres` user (`SETGID`, `SETUID`).
 * Every other image already runs as a non-root user on unprivileged ports, or,
 * like Mailpit, as a root that needs no privilege.
 */
export const CAPABILITIES_ADDED: Readonly<Record<string, readonly string[]>> = {
  postgres: ["CHOWN", "DAC_READ_SEARCH", "SETGID", "SETUID"],
};

export function assertHardened(
  services: Readonly<Record<string, HardenedService>>,
  label: string,
): void {
  for (const [name, service] of Object.entries(services)) {
    assert(
      service.security_opt?.includes("no-new-privileges:true"),
      `${label} ${name} forbids privilege gain`,
    );
    assert(
      JSON.stringify(service.cap_drop) === '["ALL"]',
      `${label} ${name} drops every capability`,
    );
    assert(
      JSON.stringify([...(service.cap_add ?? [])].sort()) ===
        JSON.stringify(CAPABILITIES_ADDED[name] ?? []),
      `${label} ${name} adds back only its documented capabilities`,
    );
    assert(
      Number(service.mem_limit) > 0,
      `${label} ${name} has a memory limit`,
    );
    assert(
      Number.isInteger(service.pids_limit) && service.pids_limit! > 0,
      `${label} ${name} has a pid limit`,
    );
  }
}

/**
 * The smallest `/dev/shm` PostgreSQL may start with. A parallel hash join
 * sizes its dynamic shared memory at about work_mem x hash_mem_multiplier (2)
 * x (2 workers + leader), so 16 MB of work_mem needs about 96 MB; Docker's
 * default 64 MB fails with "could not resize shared memory segment".
 */
export const POSTGRES_MIN_SHM_BYTES = 256 * 1024 * 1024;

/** The settings PostgreSQL starts with (BEQ-15). */
export const POSTGRES_SETTINGS = [
  "shared_buffers=512MB",
  "work_mem=16MB",
  "random_page_cost=1.1",
  "shared_preload_libraries=pg_stat_statements",
  "log_min_duration_statement=250ms",
  // A slow statement's log line must never carry its bind values (CRM data).
  "log_parameter_max_length=0",
] as const;

export function assertTunedPostgres(
  services: Readonly<Record<string, HardenedService>>,
  label: string,
): void {
  const command = services.postgres?.command ?? [];
  assert(command[0] === "postgres", `${label} PostgreSQL runs the server`);
  for (const setting of POSTGRES_SETTINGS) {
    const index = command.indexOf(setting);
    assert(
      index > 0 && command[index - 1] === "-c",
      `${label} PostgreSQL starts with -c ${setting}`,
    );
  }
  // Compose renders `shm_size` in bytes.
  assert(
    Number(services.postgres?.shm_size) >= POSTGRES_MIN_SHM_BYTES,
    `${label} PostgreSQL has at least 256 MiB of /dev/shm for parallel hashes`,
  );
}
