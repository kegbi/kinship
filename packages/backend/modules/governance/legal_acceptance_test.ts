import {
  createLegalAcceptance,
  type LegalAcceptanceRepository,
} from "./public.ts";
import { assert } from "../../testing/assert.ts";
import * as fixtures from "../../testing/fixtures.ts";
import { fixedClock } from "../../testing/fakes.ts";

const actor = fixtures.actor();

Deno.test("GOVERNANCE-001 accepts one exact required version and makes replay immutable", async () => {
  const accepted: string[] = [];
  const auditEffects: string[] = [];
  const repository: LegalAcceptanceRepository = {
    accept(command) {
      if (accepted.includes(command.documentId)) {
        return Promise.resolve({
          acceptedAt: "2026-08-23T10:00:00.000Z",
          documentId: command.documentId,
          status: "already-accepted",
        });
      }
      accepted.push(command.documentId);
      auditEffects.push("legal-document-accepted");
      return Promise.resolve({
        acceptedAt: command.now.toISOString(),
        documentId: command.documentId,
        status: "accepted",
      });
    },
    requirements() {
      return Promise.resolve({
        documents: [],
        status: "ready",
      });
    },
    publicDocument() {
      return Promise.resolve({ status: "not-found" });
    },
  };
  const legal = createLegalAcceptance({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    ids: { next: () => "00000000-0000-4000-8000-000000000901" },
    repository,
    transaction: { run: (work) => work({ opaque: undefined }) },
  });

  const first = await legal.accept(actor, {
    documentId: "00000000-0000-4000-8000-000000000101",
  });
  const replay = await legal.accept(actor, {
    documentId: "00000000-0000-4000-8000-000000000101",
  });

  assert(first.status === "accepted", "required version was not accepted");
  assert(
    replay.status === "already-accepted" && accepted.length === 1 &&
      auditEffects.join(",") === "legal-document-accepted",
    "acceptance replay created mutable, duplicate, or repeated audit state",
  );
});

Deno.test("GOVERNANCE-001 contains requirement, public review, and acceptance outages", async () => {
  let mode: "accept" | "none" | "public" | "requirements" = "requirements";
  const legal = createLegalAcceptance({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    ids: { next: () => "00000000-0000-4000-8000-000000000901" },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      accept(command) {
        if (mode === "accept") throw new Error("private failure");
        assert(command.ipAddress === "127.0.0.1", "client attribution lost");
        return Promise.resolve({ status: "superseded-version" });
      },
      publicDocument() {
        if (mode === "public") throw new Error("private failure");
        return Promise.resolve({ status: "not-found" });
      },
      requirements() {
        if (mode === "requirements") throw new Error("private failure");
        return Promise.resolve({ documents: [], status: "ready" });
      },
    },
  });

  assert(
    (await legal.requirements(actor)).status === "unavailable",
    "requirement outage escaped",
  );
  mode = "public";
  assert(
    (await legal.publicDocument("privacy")).status === "unavailable",
    "public review outage escaped",
  );
  mode = "accept";
  assert(
    (await legal.accept(actor, {
      documentId: "00000000-0000-4000-8000-000000000101",
    })).status === "unavailable",
    "acceptance outage escaped",
  );
  mode = "none";
  assert(
    (await legal.requirements(actor)).status === "ready" &&
      (await legal.publicDocument("terms")).status === "not-found" &&
      (await legal.accept(actor, {
          documentId: "00000000-0000-4000-8000-000000000101",
          ipAddress: "127.0.0.1",
        })).status === "superseded-version",
    "non-outage outcomes were changed",
  );
});

Deno.test("GOVERNANCE-001 a revoked member neither reads requirements nor accepts", async () => {
  const legal = createLegalAcceptance({
    actors: { revalidate: () => Promise.resolve("revoked" as const) },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    ids: { next: () => "00000000-0000-4000-8000-000000000901" },
    transaction: { run: (work) => work({ opaque: undefined }) },
    repository: {
      accept() {
        throw new Error("a revoked member reached the repository");
      },
      publicDocument() {
        return Promise.resolve({
          document: {
            content: "…",
            documentType: "terms",
            id: "00000000-0000-4000-8000-000000000101",
            version: "1",
          },
          status: "ready",
        });
      },
      requirements() {
        throw new Error("a revoked member reached the repository");
      },
    },
  });

  assert(
    (await legal.requirements(actor)).status === "forbidden",
    "a revoked member was shown what they still owe",
  );
  assert(
    (await legal.accept(actor, {
      documentId: "00000000-0000-4000-8000-000000000101",
    })).status === "forbidden",
    "a revoked member accepted on a workspace's behalf",
  );
  assert(
    (await legal.publicDocument("terms")).status === "ready",
    "the public documents stay readable without a membership",
  );
});
