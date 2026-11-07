import {
  AuthenticationSubjectDigester,
  type AuthenticationSubjectKeyset,
  SIGN_IN_DEVICE_LIFETIME_SECONDS,
  SignInDeviceTokens,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";

function keyset(
  activeVersion: number,
  keys: Record<number, number>,
): AuthenticationSubjectKeyset {
  return {
    activeVersion,
    keys: new Map(
      Object.entries(keys).map((
        [version, byte],
      ) => [Number(version), new Uint8Array(32).fill(byte)]),
    ),
  };
}

const digester = new AuthenticationSubjectDigester(keyset(1, { 1: 0x52 }));
const issuedAt = new Date("2026-11-07T12:00:00.000Z");

async function recognized(
  devices: SignInDeviceTokens,
  token: string | undefined,
  subject: string,
  at: Date,
): Promise<boolean> {
  return await devices.recognizes({
    at,
    digests: await digester.digestCandidates("password", subject),
    token,
  });
}

Deno.test("[AUD-A3] a sign-in device token is bound to its subject and lifetime", async () => {
  const devices = new SignInDeviceTokens(keyset(1, { 1: 0x44 }), digester);
  const device = await devices.issue({
    issuedAt,
    subject: "Owner@Example.Test",
  });
  assert(
    /^v1\.[0-9]+\.[A-Za-z0-9_-]{43}$/.test(device.token),
    "the token is versioned, cookie-safe, and carries no subject",
  );
  assert(
    device.expiresAt.getTime() ===
        issuedAt.getTime() + SIGN_IN_DEVICE_LIFETIME_SECONDS * 1_000 &&
      SIGN_IN_DEVICE_LIFETIME_SECONDS === 30 * 24 * 60 * 60 &&
      device.maxAgeSeconds === SIGN_IN_DEVICE_LIFETIME_SECONDS,
    "a device token, and the cookie that carries it, live thirty days",
  );
  assert(
    await recognized(devices, device.token, "owner@example.test", issuedAt),
    "the subject is normalized exactly as the throttle normalizes it",
  );
  assert(
    await recognized(
      devices,
      device.token,
      "owner@example.test",
      new Date(device.expiresAt.getTime() - 1),
    ),
    "the token is recognized until it expires",
  );
  assert(
    !await recognized(
      devices,
      device.token,
      "owner@example.test",
      device.expiresAt,
    ),
    "an expired token is ignored",
  );
  assert(
    !await recognized(devices, device.token, "other@example.test", issuedAt),
    "a token for another subject is ignored",
  );
});

Deno.test("[AUD-A3] forged, malformed, and foreign-key device tokens are ignored", async () => {
  const devices = new SignInDeviceTokens(keyset(1, { 1: 0x44 }), digester);
  const { token } = await devices.issue({
    issuedAt,
    subject: "owner@example.test",
  });
  const [version, expiry, mac] = token.split(".") as [string, string, string];
  const flipped = `${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
  const candidates = [
    undefined,
    "",
    "garbage",
    `${version}.${expiry}.${flipped}`,
    `${version}.${Number(expiry) + 1}.${mac}`,
    `v2.${expiry}.${mac}`,
    `${version}.${expiry}.${mac}.extra`,
    `${version}.${Number(expiry) + SIGN_IN_DEVICE_LIFETIME_SECONDS}.${mac}`,
  ];
  for (const candidate of candidates) {
    assert(
      !await recognized(devices, candidate, "owner@example.test", issuedAt),
      `a malformed or forged token is ignored: ${candidate}`,
    );
  }
  const otherDeployment = new SignInDeviceTokens(
    keyset(1, { 1: 0x45 }),
    digester,
  );
  assert(
    !await recognized(otherDeployment, token, "owner@example.test", issuedAt),
    "a token signed with another key is ignored",
  );
});

Deno.test("[AUD-A3] device tokens survive device-key rotation while the old key is retained", async () => {
  const before = new SignInDeviceTokens(keyset(1, { 1: 0x44 }), digester);
  const { token } = await before.issue({
    issuedAt,
    subject: "owner@example.test",
  });
  const rotated = new SignInDeviceTokens(
    keyset(2, { 1: 0x44, 2: 0x46 }),
    digester,
  );
  assert(
    await recognized(rotated, token, "owner@example.test", issuedAt),
    "a retained key still recognizes its tokens",
  );
  const fresh = await rotated.issue({
    issuedAt,
    subject: "owner@example.test",
  });
  assert(fresh.token.startsWith("v2."), "new tokens use the active key");
  const retired = new SignInDeviceTokens(keyset(2, { 2: 0x46 }), digester);
  assert(
    !await recognized(retired, token, "owner@example.test", issuedAt),
    "a retired key no longer recognizes its tokens",
  );
});
