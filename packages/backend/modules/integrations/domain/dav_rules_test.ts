import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  DAV_REMOTE_URL_MAX_BYTES,
  type DavRemoteChange,
  DavRemoteFailure,
  publicFailure,
  remoteIdentity,
  validConfiguration,
} from "./dav_rules.ts";

const VALID = {
  name: "Fastmail",
  password: "correct horse",
  remoteUrl: "https://dav.example.com/addressbooks/ada/",
};

Deno.test("[GAP-018] a configuration is stored in the spelling it was checked in", () => {
  assertEquals(validConfiguration(VALID), {
    name: "Fastmail",
    remoteUrl: "https://dav.example.com/addressbooks/ada/",
  });
  assertEquals(
    validConfiguration({ ...VALID, name: "  Fastmail  ", username: " ada " }),
    {
      name: "Fastmail",
      remoteUrl: "https://dav.example.com/addressbooks/ada/",
      username: "ada",
    },
  );
  assertEquals(
    validConfiguration({ ...VALID, remoteUrl: "https://DAV.Example.com/a" }),
    {
      name: "Fastmail",
      remoteUrl: "https://dav.example.com/a",
    },
    "the URL is normalised before it is measured, and stored as measured",
  );
  assertEquals(
    validConfiguration({ ...VALID, username: "   " }),
    { name: "Fastmail", remoteUrl: VALID.remoteUrl },
    "a blank username is no username",
  );
});

Deno.test("[GAP-018] a configuration that could point anywhere is refused", () => {
  for (
    const [reason, input] of [
      ["text that is not a URL", { remoteUrl: "not a url" }],
      ["plain HTTP", { remoteUrl: "http://dav.example.com/a" }],
      ["another scheme", { remoteUrl: "file:///etc/passwd" }],
      [
        "credentials smuggled into the URL",
        { remoteUrl: "https://ada:secret@dav.example.com/a" },
      ],
      [
        "a username smuggled into the URL",
        { remoteUrl: "https://ada@dav.example.com/a" },
      ],
      [
        "a URL longer than the column holds",
        {
          remoteUrl: `https://dav.example.com/${
            "a".repeat(DAV_REMOTE_URL_MAX_BYTES)
          }`,
        },
      ],
      ["no name", { name: "   " }],
      ["a long name", { name: "n".repeat(101) }],
      ["no password", { password: "" }],
      ["a long password", { password: "p".repeat(4_097) }],
      ["a long username", { username: "u".repeat(256) }],
    ] as const
  ) {
    assertEquals(
      validConfiguration({ ...VALID, ...input }),
      undefined,
      `a configuration with ${reason}`,
    );
  }
});

Deno.test("[GAP-018] a remote object keeps one identity across runs", () => {
  const change: DavRemoteChange = {
    changeType: "create",
    etag: '"1"',
    href: "/a/ada.vcf",
    kind: "person",
    payload: { givenName: "Ada" },
    uid: "urn:uuid:ada",
  };
  assertEquals(
    remoteIdentity({ workspaceId: "w1" }, "s1", change),
    "w1:s1:person:urn:uuid:ada",
  );
  assertEquals(
    remoteIdentity({ workspaceId: "w1" }, "s1", {
      ...change,
      href: "/moved/elsewhere.vcf",
    }),
    "w1:s1:person:urn:uuid:ada",
    "the identity survives the server moving the object",
  );
  assertEquals(
    remoteIdentity({ workspaceId: "w1" }, "s1", {
      changeType: "delete",
      etag: '"1"',
      href: "/a/ada.vcf",
      kind: "task",
      uid: "urn:uuid:ada",
    }),
    "w1:s1:task:urn:uuid:ada",
    "and a task and a person of the same uid are two objects",
  );
});

Deno.test("[GAP-018] a remote never gets to write its own message", () => {
  assertEquals(
    new DavRemoteFailure("auth", "401 from the upstream proxy at 10.0.0.4")
      .message,
    "Remote DAV authentication failed.",
  );
  assertEquals(
    new DavRemoteFailure("conflict").message,
    "Remote DAV state changed. A full retry is required.",
  );
  assertEquals(
    new DavRemoteFailure("temporary").message,
    "Remote DAV is temporarily unavailable.",
  );
  assert(
    new DavRemoteFailure("auth") instanceof Error,
    "it is still an error",
  );
});

Deno.test("[GAP-018] only two failures are named, and everything else is one partial sync", () => {
  assertEquals(publicFailure(new DavRemoteFailure("auth")), {
    code: "dav_authentication_failed",
    status: "auth-failure",
  });
  assertEquals(publicFailure(new DavRemoteFailure("conflict")), {
    code: "dav_remote_conflict",
    status: "conflict",
  });
  const partial = { code: "dav_sync_failed", status: "partial" };
  assertEquals(publicFailure(new DavRemoteFailure("temporary")), partial);
  assertEquals(publicFailure(new Error("ECONNRESET")), partial);
  assertEquals(publicFailure("a thrown string"), partial);
  assertEquals(publicFailure(undefined), partial);
});
