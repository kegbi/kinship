export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface PostgresConnectionFields {
  readonly database: string;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly user: string;
}

function requiredField(value: string, name: string): string {
  const hasControl = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (value.length === 0 || hasControl) {
    throw new Error(`${name} must be a non-empty value without controls.`);
  }
  return value;
}

function encoded(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function connectionHost(value: string): string {
  const host = requiredField(value, "PGHOST");
  const authority = host.includes(":") && !host.startsWith("[")
    ? `[${host}]`
    : host;
  let parsed: URL;
  try {
    parsed = new URL(`http://${authority}`);
  } catch {
    throw new Error("PGHOST must be a hostname or IP address.");
  }
  if (
    parsed.username || parsed.password || parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search || parsed.hash
  ) {
    throw new Error("PGHOST must be a hostname or IP address.");
  }
  return parsed.hostname;
}

export function buildPostgresUrl(
  fields: PostgresConnectionFields,
): string {
  if (
    !Number.isInteger(fields.port) || fields.port < 1 || fields.port > 65_535
  ) {
    throw new Error("PGPORT must be an integer between 1 and 65535.");
  }
  const user = requiredField(fields.user, "PGUSER");
  const password = requiredField(fields.password, "PGPASSWORD");
  const database = requiredField(fields.database, "PGDATABASE");
  const host = connectionHost(fields.host);
  return `postgresql://${encoded(user)}:${
    encoded(password)
  }@${host}:${fields.port}/${encoded(database)}`;
}

function validatedDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  return value;
}

export function resolveDatabaseUrl(
  environment: EnvironmentReader,
): string | undefined {
  const direct = environment.get("DATABASE_URL");
  if (direct !== undefined && direct !== "") {
    return validatedDatabaseUrl(direct);
  }

  const values = {
    database: environment.get("PGDATABASE"),
    host: environment.get("PGHOST"),
    password: environment.get("PGPASSWORD"),
    port: environment.get("PGPORT"),
    user: environment.get("PGUSER") ?? environment.get("PGUSERNAME"),
  };
  if (Object.values(values).every((value) => value === undefined)) {
    return undefined;
  }
  for (const [name, value] of Object.entries(values)) {
    if (name !== "port" && value === undefined) {
      throw new Error(`PG${name.toUpperCase()} is required.`);
    }
  }
  const port = values.port === undefined ? 5432 : Number(values.port);
  return buildPostgresUrl({
    database: values.database ?? "",
    host: values.host ?? "",
    password: values.password ?? "",
    port,
    user: values.user ?? "",
  });
}
