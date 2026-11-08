import { assert, assertEquals } from "../backend/testing/assert.ts";
import {
  cookieValue,
  expiredSessionCookie,
  sessionCookie,
  sessionCookieDuplicated,
  sessionCookieName,
  sessionToken,
  setCookie,
} from "./cookies.ts";

const secure = { origin: "https://app.test", secureCookie: true };
const insecure = { origin: "http://127.0.0.1:4321", secureCookie: false };
const SESSION_COOKIE = "kinship_session";

Deno.test("[GAP-019] a cookie is read out of a header of several", () => {
  const header = `theme=dark; ${SESSION_COOKIE}=abc.def; kinship_entry=xyz`;

  assertEquals(
    cookieValue(header, SESSION_COOKIE),
    "abc.def",
    "the session token is read whole",
  );
  assertEquals(
    cookieValue(header, "kinship_entry"),
    "xyz",
    "a later cookie is found too",
  );
  assertEquals(
    cookieValue(header, "kinship"),
    undefined,
    "a name that is only a prefix does not match",
  );
  assertEquals(
    cookieValue(undefined, SESSION_COOKIE),
    undefined,
    "no header is no cookie",
  );
  assertEquals(
    cookieValue(`${SESSION_COOKIE}=`, SESSION_COOKIE),
    "",
    "an emptied cookie reads as empty, not missing",
  );
});

Deno.test("[GAP-019] every cookie this API sets is HttpOnly and SameSite=Strict", () => {
  const set = setCookie(secure, {
    maxAgeSeconds: 3_600,
    name: SESSION_COOKIE,
    path: "/",
    value: "token",
  });

  assertEquals(
    set,
    `${SESSION_COOKIE}=token; HttpOnly; SameSite=Strict; Secure; Max-Age=3600; Path=/`,
    "the attributes, in the order the invitation cookies already used",
  );
});

Deno.test("[GAP-019] Secure follows the configured origin, and an age is never negative", () => {
  const overLoopback = setCookie(insecure, {
    maxAgeSeconds: -5,
    name: "kinship_entry",
    path: "/api/v1/workspace-invitations",
    value: "",
  });

  assert(
    !overLoopback.includes("Secure"),
    "a loopback deployment cannot set a Secure cookie",
  );
  assert(
    overLoopback.includes("Max-Age=0"),
    "an expired cookie asks for zero, not a negative age",
  );
  assert(
    setCookie(secure, {
      maxAgeSeconds: 12.9,
      name: "n",
      path: "/",
      value: "v",
    }).includes("Max-Age=12"),
    "a fractional age is floored to whole seconds",
  );
});

Deno.test("[AUD-K4] the session cookie is __Host- prefixed exactly when it is Secure", () => {
  assertEquals(sessionCookieName(secure), "__Host-kinship_session");
  assertEquals(sessionCookieName(insecure), "kinship_session");
  assertEquals(
    sessionCookie(secure, "token", 60),
    "__Host-kinship_session=token; HttpOnly; SameSite=Strict; Secure; Max-Age=60; Path=/",
    "Secure, Path=/, and no Domain, as the prefix requires",
  );
  assertEquals(
    expiredSessionCookie(insecure),
    "kinship_session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/",
  );
});

Deno.test("[AUD-K4] one session cookie is a token; none, an empty one, or two are not", () => {
  assertEquals(
    sessionToken("theme=dark; __Host-kinship_session=abc", secure),
    "abc",
  );
  assertEquals(
    sessionToken("kinship_session=abc", secure),
    undefined,
    "the unprefixed name is not read over HTTPS",
  );
  assertEquals(sessionToken("kinship_session=", insecure), undefined);
  assertEquals(sessionToken(undefined, insecure), undefined);
  const pair = "kinship_session=a; theme=dark; kinship_session=b";
  assertEquals(sessionToken(pair, insecure), undefined, "two are nobody");
  assert(sessionCookieDuplicated(pair, insecure), "and are a duplicate");
  assert(
    !sessionCookieDuplicated(
      "kinship_session=a; __Host-kinship_session=b",
      secure,
    ),
    "a stray unprefixed cookie is no duplicate over HTTPS",
  );
});
