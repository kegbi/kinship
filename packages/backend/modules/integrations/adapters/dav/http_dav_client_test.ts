import { DavRemoteFailure } from "../../domain/dav_rules.ts";
import { HttpDavClient } from "./http_dav_client.ts";
import { assert } from "../../../../testing/assert.ts";

Deno.test("DAV adapter sends auth and sync token and parses CardDAV plus VTODO", async () => {
  let request: RequestInit | undefined;
  const client = new HttpDavClient((_url, init) => {
    request = init;
    return Promise.resolve(
      new Response(
        `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav" xmlns:a="urn:ietf:params:xml:ns:caldav">
        <d:sync-token>token-2</d:sync-token>
        <d:response><d:href>/ada.vcf</d:href><d:propstat><d:prop>
          <d:getetag>&quot;ada-1&quot;</d:getetag><c:address-data>BEGIN:VCARD\nUID:ada\nN:Lovelace;Ada;;;\nFN:Ada Lovelace\nEND:VCARD</c:address-data>
        </d:prop></d:propstat></d:response>
        <d:response><d:href>/notes.ics</d:href><d:propstat><d:prop>
          <d:getetag>&quot;task-1&quot;</d:getetag><a:calendar-data>BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:notes\nSUMMARY:Write notes\nDUE:20260825T120000Z\nEND:VTODO\nEND:VCALENDAR</a:calendar-data>
        </d:prop></d:propstat></d:response>
      </d:multistatus>`,
        { status: 207 },
      ),
    );
  });
  const result = await client.pull({
    password: "secret",
    remoteSyncToken: "token-1",
    remoteUrl: "https://dav.example.test/collection/",
    username: "ada",
  });
  assert(request?.method === "REPORT", "expected REPORT");
  assert(request?.signal instanceof AbortSignal, "expected bounded timeout");
  assert(String(request?.body).includes("token-1"), "expected prior token");
  assert(result.remoteSyncToken === "token-2", "expected next token");
  assert(result.changes[0]?.kind === "person", "expected contact");
  assert(result.changes[1]?.kind === "task", "expected VTODO");
});

Deno.test("DAV adapter classifies authentication and conflict responses", async () => {
  for (const [status, kind] of [[401, "auth"], [412, "conflict"]] as const) {
    const client = new HttpDavClient(() =>
      Promise.resolve(new Response("", { status }))
    );
    try {
      await client.pull({
        password: "secret",
        remoteUrl: "https://dav.example.test",
      });
      throw new Error("expected remote failure");
    } catch (error) {
      assert(
        error instanceof DavRemoteFailure && error.kind === kind,
        `expected ${kind}`,
      );
    }
  }
});

Deno.test("DAV adapter classifies temporary and malformed successful responses", async () => {
  const temporary = new HttpDavClient(() =>
    Promise.resolve(new Response("", { status: 500 }))
  );
  try {
    await temporary.pull({
      password: "secret",
      remoteUrl: "https://dav.example.test",
    });
    throw new Error("expected temporary failure");
  } catch (error) {
    assert(
      error instanceof DavRemoteFailure && error.kind === "temporary",
      "temporary response classified",
    );
  }
  const malformed = new HttpDavClient(() =>
    Promise.resolve(
      new Response("<multistatus></multistatus>", { status: 207 }),
    )
  );
  try {
    await malformed.pull({
      password: "secret",
      remoteUrl: "https://dav.example.test",
    });
    throw new Error("expected missing token failure");
  } catch (error) {
    assert(
      error instanceof DavRemoteFailure && error.kind === "temporary",
      "missing token classified",
    );
  }
});

Deno.test("DAV transport validates every resolved address and pins the chosen connection", async () => {
  const connected: string[] = [];
  const client = new HttpDavClient({
    request: (_url, _init, address) => {
      connected.push(address);
      return Promise.resolve({
        body:
          '<multistatus xmlns="DAV:"><sync-token>next</sync-token></multistatus>',
        status: 207,
      });
    },
    resolve: () => Promise.resolve(["203.0.113.5", "127.0.0.1"]),
  });
  try {
    await client.pull({
      password: "secret",
      remoteUrl: "https://dav.example.test",
    });
    throw new Error("expected unsafe resolution rejection");
  } catch (error) {
    assert(error instanceof DavRemoteFailure, "unsafe DNS rejected");
  }
  assert(connected.length === 0, "no connection follows mixed DNS answer");
  const pinned = new HttpDavClient({
    request: (_url, _init, address) => {
      connected.push(address);
      return Promise.resolve({
        body:
          '<multistatus xmlns="DAV:"><sync-token>next</sync-token></multistatus>',
        status: 207,
      });
    },
    resolve: () => Promise.resolve(["93.184.216.34"]),
  });
  await pinned.pull({
    password: "secret",
    remoteUrl: "https://dav.example.test",
  });
  assert(
    connected[0] === "93.184.216.34",
    "validated address pins the connection",
  );
});

Deno.test("DAV transport accepts only true global unicast IPv6", async () => {
  const rejected = [
    "2001:2::1",
    "2001:db8::1",
    "2002:808:808::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "::1",
  ];
  for (const address of rejected) {
    let connected = false;
    const client = new HttpDavClient({
      request: () => {
        connected = true;
        return Promise.resolve({ body: "", status: 207 });
      },
      resolve: () => Promise.resolve([address]),
    });
    try {
      await client.pull({
        password: "secret",
        remoteUrl: "https://dav.example.test",
      });
      throw new Error(`expected ${address} rejection`);
    } catch (error) {
      assert(error instanceof DavRemoteFailure, `${address} rejected`);
    }
    assert(!connected, `${address} never reaches transport`);
  }

  let pinned = "";
  const publicClient = new HttpDavClient({
    request: (_url, _init, address) => {
      pinned = address;
      return Promise.resolve({
        body:
          '<multistatus xmlns="DAV:"><sync-token>next</sync-token></multistatus>',
        status: 207,
      });
    },
    resolve: () => Promise.resolve(["2606:4700:4700::1111"]),
  });
  await publicClient.pull({
    password: "secret",
    remoteUrl: "https://dav.example.test",
  });
  assert(pinned === "2606:4700:4700::1111", "global IPv6 pinned");
});

Deno.test("DAV adapter escapes sync tokens and rejects oversized responses", async () => {
  let body = "";
  const client = new HttpDavClient((_url, init) => {
    body = String(init.body);
    return Promise.resolve(
      new Response("x".repeat(2_000_000), { status: 207 }),
    );
  });
  try {
    await client.pull({
      password: "secret",
      remoteSyncToken: "</d:sync-token><evil/>",
      remoteUrl: "https://dav.example.test",
    });
    throw new Error("expected oversized response rejection");
  } catch (error) {
    assert(error instanceof DavRemoteFailure, "oversized response rejected");
  }
  assert(body.includes("&lt;/d:sync-token&gt;"), "sync token XML escaped");
  assert(!body.includes("<evil/>"), "token cannot inject XML");
});
