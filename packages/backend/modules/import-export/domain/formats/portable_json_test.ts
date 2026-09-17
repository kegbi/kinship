import { assert, assertEquals } from "../../../../testing/assert.ts";
import { canonicalJson } from "./canonical.ts";
import {
  MAX_PORTABLE_PEOPLE,
  PORTABLE_LIMITATIONS,
  PORTABLE_MIME_TYPE,
  PORTABLE_TOO_LARGE,
  portableArtifact,
  portableContact,
  portableFilename,
  portableManifest,
  type PortablePerson,
  readPortableArtifact,
} from "./portable_json.ts";

const ADA: PortablePerson = {
  familyName: "Lovelace",
  givenName: "Ada",
  id: "11111111-1111-4111-8111-111111111111",
  isDeceased: false,
  isPartial: false,
  isStarred: true,
  nickname: "Addy",
};

const ENCODER = new TextEncoder();

Deno.test("[GAP-018] a person renders only the columns Monica's importer accepts", () => {
  assertEquals(portableContact(ADA), {
    id: ADA.id,
    uuid: ADA.id,
    first_name: "Ada",
    last_name: "Lovelace",
    nickname: "Addy",
    is_active: true,
    is_dead: false,
    is_partial: false,
    is_starred: true,
  });
  assertEquals(
    portableContact({
      archived: true,
      deletedAt: "2026-02-01T00:00:00.000Z",
      description: "d",
      familyName: "B",
      foodPreferences: "f",
      givenName: "A",
      id: "p2",
      isDeceased: true,
      isPartial: true,
      isStarred: false,
      middleName: "M",
      nickname: "N",
    }),
    {
      id: "p2",
      uuid: "p2",
      first_name: "A",
      middle_name: "M",
      last_name: "B",
      nickname: "N",
      description: "d",
      food_preferences: "f",
      is_active: false,
      is_dead: true,
      is_partial: true,
      is_starred: false,
      deleted_at: "2026-02-01T00:00:00.000Z",
    },
    "an archived person is written as inactive, which is the column Monica has",
  );
});

Deno.test("[GAP-018] the artifact's digests are pinned to fixed vectors", async () => {
  const contact = portableContact(ADA);
  assertEquals(
    canonicalJson([contact]),
    '[{"first_name":"Ada","id":"11111111-1111-4111-8111-111111111111","is_active":true,"is_dead":false,"is_partial":false,"is_starred":true,"last_name":"Lovelace","nickname":"Addy","uuid":"11111111-1111-4111-8111-111111111111"}]',
  );
  const manifest = await portableManifest([contact]);
  assertEquals(
    manifest.rows.people.sha256,
    "9630361d3236d045de8d11b3f3bac3b324497cf203c4330e8ec4de4bbca06350",
  );
  assertEquals(
    manifest.attachments.sha256,
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  );
  assertEquals(manifest.rows.people.count, 1);
  assertEquals(manifest.attachments.count, 0);
  assertEquals(manifest.attachments.items, []);
  assertEquals(manifest.profile, "monica-json");
  assertEquals(manifest.version, 1);
  assertEquals(manifest.limitations, PORTABLE_LIMITATIONS);

  const artifact = await portableArtifact([ADA]);
  assertEquals(artifact.people, 1);
  assertEquals(
    artifact.checksumSha256,
    "ef6fee542da2f76cb8dbba05040d34c0ac2074760abdae76e43acb8b76f742fb",
  );
  assertEquals(artifact.manifest, manifest);
  assertEquals(
    JSON.parse(new TextDecoder().decode(artifact.bytes)).tables.contacts,
    [contact],
  );
});

Deno.test("[GAP-018] the names and limits the profile publishes", () => {
  assertEquals(portableFilename("e-1"), "kinship-e-1.json");
  assertEquals(PORTABLE_MIME_TYPE, "application/json");
  assertEquals(MAX_PORTABLE_PEOPLE, 500);
  assertEquals(PORTABLE_TOO_LARGE, "Portable export is limited to 500 people.");
  assertEquals(PORTABLE_LIMITATIONS.length, 3);
});

Deno.test("[GAP-018] an artifact this module wrote is read back and re-verified", async () => {
  const artifact = await portableArtifact([ADA]);
  const reread = await readPortableArtifact(artifact.bytes);
  assert(reread, "an untouched artifact is trusted");
  assertEquals(reread.checksumSha256, artifact.checksumSha256);
  assertEquals(reread.people, 1);
  assertEquals(reread.manifest, artifact.manifest);
});

Deno.test("[GAP-018] an artifact that no longer says what it said is discarded", async () => {
  const artifact = await portableArtifact([ADA]);
  const document = JSON.parse(new TextDecoder().decode(artifact.bytes)) as {
    // deno-lint-ignore no-explicit-any
    manifest: any;
    // deno-lint-ignore no-explicit-any
    tables: any;
  };
  const rewritten = (mutate: (value: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(document)) as Record<
      string,
      unknown
    >;
    mutate(copy);
    return ENCODER.encode(JSON.stringify(copy));
  };

  assertEquals(
    await readPortableArtifact(ENCODER.encode("not json at all")),
    undefined,
  );
  for (
    const [reason, mutate] of [
      ["another format", (v: Record<string, unknown>) => v.format = "csv"],
      ["another version", (v: Record<string, unknown>) => v.version = 2],
      ["no manifest", (v: Record<string, unknown>) => delete v.manifest],
      [
        "a manifest of another version",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.version = 2,
      ],
      [
        "a manifest of another profile",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.profile = "csv",
      ],
      ["no contacts", (v: Record<string, unknown>) => v.tables = {}],
      [
        "a count that disagrees with the rows",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.rows.people.count = 9,
      ],
      [
        "a digest that is not one",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.rows.people.sha256 = "nope",
      ],
      [
        "a digest over other rows",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.tables.contacts[0].first_name = "Grace",
      ],
      [
        "attachments it does not carry",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.attachments.count = 1,
      ],
      [
        "an attachment list that is not one",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.attachments.items = "none",
      ],
      [
        "an attachment list with something in it",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.attachments.items = [{}],
      ],
      [
        "an attachment digest over something else",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.attachments.sha256 = "0".repeat(64),
      ],
      [
        "limitations that are not a list",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.limitations = "none",
      ],
      [
        "a limitation that is not text",
        // deno-lint-ignore no-explicit-any
        (v: any) => v.manifest.limitations = [1],
      ],
    ] as const
  ) {
    assertEquals(
      await readPortableArtifact(rewritten(mutate)),
      undefined,
      `an artifact with ${reason} is rebuilt rather than trusted`,
    );
  }
});

Deno.test("[GAP-018] an empty workspace still produces a signed artifact", async () => {
  const artifact = await portableArtifact([]);
  assertEquals(artifact.people, 0);
  assertEquals(artifact.manifest.rows.people.count, 0);
  assertEquals(
    artifact.manifest.rows.people.sha256,
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "no rows canonicalise to the same empty list the manifest signs",
  );
  assert(await readPortableArtifact(artifact.bytes), "and it reads back");
});
