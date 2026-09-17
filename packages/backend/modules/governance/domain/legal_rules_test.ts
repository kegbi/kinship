import { assertEquals } from "../../../testing/assert.ts";
import {
  acceptanceValues,
  PUBLIC_LEGAL_DOCUMENT_TYPES,
} from "./legal_rules.ts";

Deno.test("[GAP-018] two documents are readable without an account", () => {
  assertEquals(PUBLIC_LEGAL_DOCUMENT_TYPES, ["privacy", "terms"]);
});

Deno.test("[GAP-018] an acceptance records an address only when there is one", () => {
  assertEquals(
    acceptanceValues({ documentId: "d1", ipAddress: "203.0.113.7" }),
    { documentId: "d1", ipAddress: "203.0.113.7" },
  );
  assertEquals(acceptanceValues({ documentId: "d1" }), { documentId: "d1" });
  assertEquals(
    acceptanceValues({ documentId: "d1", ipAddress: "" }),
    { documentId: "d1" },
    "evidence that claims an empty address is worse than evidence that claims none",
  );
});
