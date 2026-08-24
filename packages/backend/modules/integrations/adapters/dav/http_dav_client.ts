import { XMLParser } from "npm:fast-xml-parser@5.11.0";
import ipaddr from "npm:ipaddr.js@2.5.0";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  type DavRemoteChange,
  type DavRemoteClient,
  DavRemoteFailure,
} from "../../application/dav_sync.ts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
interface TransportResponse {
  readonly body: string;
  readonly status: number;
}
export interface DavPinnedTransport {
  resolve(hostname: string): Promise<readonly string[]>;
  request(
    url: URL,
    init: RequestInit,
    address: string,
  ): Promise<TransportResponse>;
}
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CHANGES = 1_000;
const MAX_PAYLOAD_BYTES = 262_144;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function records(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null
    );
  }
  return typeof value === "object" && value !== null
    ? [value as Record<string, unknown>]
    : [];
}
function property(response: Record<string, unknown>): Record<string, unknown> {
  for (const propstat of records(response.propstat)) {
    for (const prop of records(propstat.prop)) {
      return prop;
    }
  }
  return {};
}
function unfolded(raw: string): readonly string[] {
  return raw.replaceAll("\r\n", "\n").replace(/\n[ \t]/g, "").split("\n");
}
function field(
  lines: readonly string[],
  name: string,
  max = 10_000,
): string | undefined {
  const line = lines.find((candidate) =>
    candidate.slice(0, candidate.indexOf(":")).split(";")[0]?.toUpperCase() ===
      name
  );
  const value = line?.slice((line.indexOf(":") || -1) + 1).trim();
  if (!value || value.length > max) return undefined;
  return value.replaceAll("\\n", "\n").replaceAll("\\,", ",").replaceAll(
    "\\;",
    ";",
  );
}
function vcard(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD_BYTES) {
    return undefined;
  }
  const lines = unfolded(raw);
  const uid = field(lines, "UID", 1_024);
  const structured = field(lines, "N", 2_000)?.split(";") ?? [];
  const display = field(lines, "FN", 1_000) ?? "";
  const givenName = structured[1]?.trim() || display.trim();
  if (!uid || !givenName || givenName.length > 500) return undefined;
  const familyName = structured[0]?.trim();
  return {
    payload: {
      ...(familyName && familyName.length <= 500 ? { familyName } : {}),
      givenName,
    },
    uid,
  };
}
function instant(value: string | undefined): string | undefined {
  const match = value &&
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${
      match[6]
    }.000Z`
    : undefined;
}
function vtodo(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_PAYLOAD_BYTES) {
    return undefined;
  }
  const lines = unfolded(raw);
  if (!lines.some((line) => line.trim() === "BEGIN:VTODO")) return undefined;
  const uid = field(lines, "UID", 1_024);
  const title = field(lines, "SUMMARY", 500);
  if (!uid || !title) return undefined;
  const description = field(lines, "DESCRIPTION", 10_000);
  const dueAt = instant(field(lines, "DUE", 64));
  return {
    payload: {
      ...(description ? { description } : {}),
      ...(dueAt ? { dueAt } : {}),
      title,
    },
    uid,
  };
}
function basic(username: string | undefined, password: string): string {
  return `Basic ${btoa(`${username ?? ""}:${password}`)}`;
}
function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function globalAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (
    parsed.kind() === "ipv6" && "isIPv4MappedAddress" in parsed &&
    parsed.isIPv4MappedAddress()
  ) return false;
  return parsed.range() === "unicast";
}
async function resolveAll(hostname: string): Promise<readonly string[]> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return [literal];
  const [a, aaaa] = await Promise.all([
    Deno.resolveDns(hostname, "A").catch(() => []),
    Deno.resolveDns(hostname, "AAAA").catch(() => []),
  ]);
  return [...a, ...aaaa];
}
function nodeRequest(
  url: URL,
  init: RequestInit,
  address: string,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const request = httpsRequest(url, {
      headers,
      lookup: (_hostname, _options, callback) =>
        callback(null, address, isIP(address) as 4 | 6),
      method: init.method,
      servername: url.hostname,
    }, (response) => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      response.on("data", (chunk: Uint8Array) => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BYTES) {
          request.destroy();
          reject(new DavRemoteFailure("temporary"));
          return;
        }
        chunks.push(chunk);
      });
      response.on(
        "end",
        () =>
          resolve({
            body: new TextDecoder().decode(Buffer.concat(chunks)),
            status: response.statusCode ?? 0,
          }),
      );
    });
    request.on("error", () => reject(new DavRemoteFailure("temporary")));
    const signal = init.signal;
    signal?.addEventListener(
      "abort",
      () => request.destroy(new Error("timeout")),
      { once: true },
    );
    request.end(typeof init.body === "string" ? init.body : undefined);
  });
}
const defaultTransport: DavPinnedTransport = {
  resolve: resolveAll,
  request: nodeRequest,
};
async function boundedResponse(response: Response): Promise<TransportResponse> {
  const reader = response.body?.getReader();
  if (!reader) return { body: "", status: response.status };
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.length;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new DavRemoteFailure("temporary");
    }
    chunks.push(item.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body: new TextDecoder().decode(body), status: response.status };
}

export class HttpDavClient implements DavRemoteClient {
  private readonly fetchOverride?: Fetch;
  private readonly transport: DavPinnedTransport;
  constructor(
    requestOrTransport: Fetch | DavPinnedTransport = defaultTransport,
    private readonly timeoutMilliseconds = 10_000,
  ) {
    if (typeof requestOrTransport === "function") {
      this.fetchOverride = requestOrTransport;
      this.transport = defaultTransport;
    } else this.transport = requestOrTransport;
  }
  async pull(command: Parameters<DavRemoteClient["pull"]>[0]) {
    const url = new URL(command.remoteUrl);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav" xmlns:a="urn:ietf:params:xml:ns:caldav">
  <d:sync-token>${
      escapeXml(command.remoteSyncToken ?? "")
    }</d:sync-token><d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/><c:address-data/><a:calendar-data/></d:prop>
</d:sync-collection>`;
    const init: RequestInit = {
      body,
      headers: {
        Accept: "application/xml, text/xml",
        Authorization: basic(command.username, command.password),
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "1",
      },
      method: "REPORT",
      redirect: "manual",
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    };
    let response: TransportResponse;
    if (this.fetchOverride) {
      response = await boundedResponse(
        await this.fetchOverride(url.toString(), init),
      );
    } else {
      const addresses = await this.transport.resolve(url.hostname);
      if (
        !addresses.length ||
        addresses.some((address) => !globalAddress(address))
      ) throw new DavRemoteFailure("temporary");
      response = await this.transport.request(url, init, addresses[0]!);
      if (new TextEncoder().encode(response.body).length > MAX_RESPONSE_BYTES) {
        throw new DavRemoteFailure("temporary");
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new DavRemoteFailure("auth");
    }
    if (response.status === 409 || response.status === 412) {
      throw new DavRemoteFailure("conflict");
    }
    if (response.status !== 207) throw new DavRemoteFailure("temporary");
    let parsed: Record<string, unknown>;
    try {
      parsed = new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
        removeNSPrefix: true,
      }).parse(response.body) as Record<string, unknown>;
    } catch {
      throw new DavRemoteFailure("temporary");
    }
    const multistatus = records(parsed.multistatus)[0];
    const remoteSyncToken = text(multistatus?.["sync-token"]);
    const entries = records(multistatus?.response);
    if (
      !multistatus || !remoteSyncToken || remoteSyncToken.length > 4_096 ||
      entries.length > MAX_CHANGES
    ) throw new DavRemoteFailure("temporary");
    const changes: DavRemoteChange[] = [];
    for (const item of entries) {
      const href = text(item.href);
      const prop = property(item);
      const etag = text(prop.getetag) ?? "";
      if (!href || href.length > 4_096 || etag.length > 1_024) continue;
      const status = `${text(item.status) ?? ""} ${
        records(item.propstat).map((part) => text(part.status) ?? "").join(" ")
      }`;
      if (/\s404\s/.test(status)) {
        changes.push({
          changeType: "delete",
          etag,
          href,
          kind: href.toLowerCase().endsWith(".ics") ? "task" : "person",
          uid: href,
        });
        continue;
      }
      const rawCard = text(prop["address-data"]);
      const rawCalendar = text(prop["calendar-data"]);
      if (
        (rawCard &&
          new TextEncoder().encode(rawCard).length > MAX_PAYLOAD_BYTES) ||
        (rawCalendar &&
          new TextEncoder().encode(rawCalendar).length > MAX_PAYLOAD_BYTES)
      ) {
        throw new DavRemoteFailure("temporary");
      }
      const contact = rawCard ? vcard(rawCard) : undefined;
      if (contact) {
        changes.push({
          changeType: "update",
          etag,
          href,
          kind: "person",
          ...contact,
          raw: rawCard!,
        });
      }
      const task = rawCalendar ? vtodo(rawCalendar) : undefined;
      if (task) {
        changes.push({
          changeType: "update",
          etag,
          href,
          kind: "task",
          ...task,
          raw: rawCalendar!,
        });
      }
    }
    return { changes, remoteSyncToken };
  }
}
