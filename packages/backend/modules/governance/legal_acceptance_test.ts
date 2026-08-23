import {
  createLegalAcceptance,
  type LegalAcceptanceRepository,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};

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
    clock: { now: () => new Date("2026-08-23T10:00:00.000Z") },
    ids: { next: () => "00000000-0000-4000-8000-000000000901" },
    repository,
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
    clock: { now: () => new Date("2026-08-23T10:00:00.000Z") },
    ids: { next: () => "00000000-0000-4000-8000-000000000901" },
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
