/**
 * A person's avatar against PostgreSQL and an object store (GAP-045,
 * PEOPLE-007): the upload is the files module's `avatar` kind, the link is
 * people's `person_avatars` row, every reader draws the same descriptor, and
 * an image whose bytes went missing falls back to the initials.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, ORIGIN, type SignedInFixture } from "../support/api.ts";
import { createPerson } from "../support/fixtures.ts";

class CapturedObjectStorage implements ObjectStorage {
  readonly bucket = "captured-avatars";
  readonly objects = new Map<string, Uint8Array>();
  readonly provider = "captured";

  get(command: { readonly key: string }): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.objects.get(command.key));
  }
  health(): Promise<"available"> {
    return Promise.resolve("available");
  }
  put(
    command: { readonly bytes: Uint8Array; readonly key: string },
  ): Promise<void> {
    this.objects.set(command.key, command.bytes.slice());
    return Promise.resolve();
  }
  remove(command: { readonly key: string }): Promise<void> {
    this.objects.delete(command.key);
    return Promise.resolve();
  }
}

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const storage = new CapturedObjectStorage();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
  undefined,
  undefined,
  undefined,
  storage,
);
const api = apiSupport(configured.app, mail, sql);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface AvatarBody {
  readonly avatar?: { readonly color: string; readonly imageUrl?: string };
  readonly code?: string;
  readonly status?: string;
}

function putAvatar(
  fixture: SignedInFixture,
  personId: string,
  bytes: Uint8Array,
  mimeType = "image/png",
): Promise<Response> {
  return Promise.resolve(configured.app.request(
    `${ORIGIN}/api/v1/people/${personId}/avatar`,
    {
      body: bytes.slice().buffer,
      headers: {
        cookie: fixture.cookie,
        "content-type": mimeType,
        origin: ORIGIN,
        "X-File-Name": encodeURIComponent("ada lovelace.png"),
        "X-Workspace-Id": fixture.workspaceId,
      },
      method: "PUT",
    },
  ));
}

async function profileAvatar(fixture: SignedInFixture, personId: string) {
  const response = await api.request(fixture, `/api/v1/people/${personId}`);
  const body = await response.json() as {
    readonly person: { readonly avatar?: AvatarBody["avatar"] };
  };
  return body.person.avatar;
}

async function directoryAvatar(fixture: SignedInFixture, personId: string) {
  const response = await api.request(fixture, "/api/v1/people?limit=50");
  const body = await response.json() as {
    readonly people: readonly {
      readonly avatar?: AvatarBody["avatar"];
      readonly id: string;
    }[];
  };
  return body.people.find((person) => person.id === personId)?.avatar;
}

async function audits(personId: string): Promise<readonly string[]> {
  const rows = await sql<{ readonly action: string }[]>`
    select action from crm.audit_events
    where person_id = ${personId}::uuid
      and (action like 'people.avatar-%' or action like 'files.file-%')
    order by created_at, action
  `;
  return rows.map((row) => row.action);
}

Deno.test("[PEOPLE-007] an avatar is uploaded, drawn, replaced, and removed through the owning modules", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatars-${suffix}@example.test`,
    "Avatars",
  );
  const ada = await createPerson(api, owner, "Ada");

  const before = await profileAvatar(owner, ada);
  assert(
    before !== undefined && before.imageUrl === undefined &&
      /^#[0-9a-f]{6}$/.test(before.color),
    "a person without an avatar is drawn with their initials on a colour",
  );

  const uploaded = await putAvatar(owner, ada, PNG);
  const uploadedBody = await uploaded.json() as AvatarBody;
  assertEquals(uploaded.status, 200, "the avatar is stored");
  const imageUrl = uploadedBody.avatar?.imageUrl;
  assert(imageUrl, "the answer names the image");
  assertEquals(uploadedBody.avatar?.color, before.color, "the colour stays");
  assertEquals((await profileAvatar(owner, ada))?.imageUrl, imageUrl);
  assertEquals((await directoryAvatar(owner, ada))?.imageUrl, imageUrl);

  const [link] = await sql<{
    readonly file_id: string;
    readonly kind: string;
    readonly source: string;
    readonly status: string;
  }[]>`
    select avatar.source, avatar.file_id::text, link.kind, stored.status
    from crm.person_avatars avatar
    join crm.files stored on stored.id = avatar.file_id
    join crm.person_file_links link on link.file_id = stored.id
    where avatar.person_id = ${ada}::uuid
  `;
  assert(
    link?.source === "file" && link.kind === "avatar" &&
      link.status === "available",
    "people links a files-owned avatar-kind file",
  );

  const image = await api.request(owner, imageUrl);
  assertEquals(image.status, 200, "the image is served privately");
  assertEquals(image.headers.get("content-type"), "image/png");
  assertEquals(image.headers.get("cache-control"), "private, no-store");
  assertEquals([...new Uint8Array(await image.arrayBuffer())], [...PNG]);

  const listed = await api.request(owner, `/api/v1/people/${ada}/files`);
  const listedBody = await listed.json() as { readonly files: unknown[] };
  assertEquals(listedBody.files.length, 0, "an avatar is not a listed file");

  const replaced = await putAvatar(
    owner,
    ada,
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    "image/jpeg",
  );
  const replacedBody = await replaced.json() as AvatarBody;
  assertEquals(replaced.status, 200, "the avatar is replaced");
  assert(replacedBody.avatar?.imageUrl !== imageUrl, "with a new image");
  const [old] = await sql<{ readonly status: string }[]>`
    select status from crm.files where id = ${link.file_id}::uuid
  `;
  assertEquals(old?.status, "deleted", "the replaced image is removed");

  const removed = await api.request(
    owner,
    `/api/v1/people/${ada}/avatar`,
    "DELETE",
  );
  const removedBody = await removed.json() as AvatarBody;
  assertEquals(removed.status, 200, "the avatar is removed");
  assertEquals(removedBody.avatar, { color: before.color });
  assertEquals((await profileAvatar(owner, ada))?.imageUrl, undefined);
  const actions = await audits(ada);
  assertEquals(
    actions.filter((action) => action === "people.avatar-updated").length,
    2,
    "each replacement is audited by people",
  );
  assertEquals(
    actions.filter((action) => action === "people.avatar-removed").length,
    1,
  );
  assertEquals(
    actions.includes("files.file-read"),
    false,
    "drawing an avatar records no file read",
  );
});

Deno.test("[PEOPLE-007] an image whose bytes went missing falls back to the initials", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatar-missing-${suffix}@example.test`,
    "Missing",
  );
  const ada = await createPerson(api, owner, "Ada");
  const uploaded = await putAvatar(owner, ada, PNG);
  const imageUrl = (await uploaded.json() as AvatarBody).avatar?.imageUrl;
  assert(imageUrl, "the avatar is stored");
  const [stored] = await sql<{ readonly storage_key: string }[]>`
    select stored.storage_key from crm.person_avatars avatar
    join crm.files stored on stored.id = avatar.file_id
    where avatar.person_id = ${ada}::uuid
  `;
  assert(stored, "the object has a key");
  storage.objects.delete(stored.storage_key);

  const missing = await api.request(owner, imageUrl);
  assertEquals(missing.status, 410, "the missing object is reported");
  assertEquals(
    (await missing.json() as { readonly code: string }).code,
    "file_missing",
  );
  const profile = await profileAvatar(owner, ada);
  assert(
    profile !== undefined && profile.imageUrl === undefined,
    "the profile falls back to the initials once the bytes are missing",
  );
  assertEquals(
    (await directoryAvatar(owner, ada))?.imageUrl,
    undefined,
    "so does the directory",
  );
});

Deno.test("[PEOPLE-007] refused images, archived people, other workspaces, and removed members change nothing", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `avatar-refused-${suffix}@example.test`,
    "Refused",
  );
  const foreign = await api.register(
    `avatar-foreign-${suffix}@example.test`,
    "Foreign",
  );
  const ada = await createPerson(api, owner, "Ada");

  const pdf = await putAvatar(
    owner,
    ada,
    new Uint8Array([0x25, 0x50]),
    "application/pdf",
  );
  assertEquals(pdf.status, 415, "only an image may be an avatar");
  const huge = await putAvatar(owner, ada, new Uint8Array(1024 * 1024 + 1));
  assertEquals(huge.status, 413, "an avatar past its limit is refused");
  assertEquals(
    (await huge.json() as AvatarBody).code,
    "avatar_too_large",
    "by the avatar's own refusal, not the global cap",
  );
  const disguised = await putAvatar(
    owner,
    ada,
    new TextEncoder().encode("not an image"),
  );
  assertEquals(disguised.status, 423, "a disguised image is quarantined");
  const [held] = await sql<{ readonly count: string }[]>`
    select count(*)::text as count from crm.files stored
    join crm.person_file_links link on link.file_id = stored.id
    where link.person_id = ${ada}::uuid and link.kind = 'avatar'
      and stored.status = 'quarantined'
  `;
  assertEquals(held?.count, "1", "the quarantined image is kept for review");
  const [unlinked] = await sql<{ readonly count: string }[]>`
    select count(*)::text as count from crm.person_avatars
    where person_id = ${ada}::uuid and source = 'file'
  `;
  assertEquals(unlinked?.count, "0", "and never linked as the avatar");

  const crossPut = await putAvatar(foreign, ada, PNG);
  assertEquals(crossPut.status, 404, "another workspace cannot see the person");
  const crossDelete = await api.request(
    foreign,
    `/api/v1/people/${ada}/avatar`,
    "DELETE",
  );
  assertEquals(crossDelete.status, 404);

  const stored = await putAvatar(owner, ada, PNG);
  const imageUrl = (await stored.json() as AvatarBody).avatar?.imageUrl;
  assert(imageUrl, "the owner stores an avatar");
  const crossRead = await api.request(foreign, imageUrl);
  assertEquals(crossRead.status, 404, "nor read its image");

  const person = await api.request(owner, `/api/v1/people/${ada}`);
  const { person: identity } = await person.json() as {
    readonly person: { readonly updatedAt: string };
  };
  const archived = await api.request(
    owner,
    `/api/v1/people/${ada}/archive`,
    "POST",
    {
      expectedUpdatedAt: identity.updatedAt,
    },
  );
  assertEquals(archived.status, 200, "the person is archived");
  assertEquals(
    (await putAvatar(owner, ada, PNG)).status,
    409,
    "archived is read-only",
  );
  assertEquals(
    (await api.request(owner, `/api/v1/people/${ada}/avatar`, "DELETE")).status,
    409,
  );
  assertEquals(
    (await profileAvatar(owner, ada))?.imageUrl,
    imageUrl,
    "an archived person keeps their avatar",
  );

  await revokeMembership(sql, owner.memberId);
  const revoked = await putAvatar(owner, ada, PNG);
  assert(
    revoked.status === 401 || revoked.status === 403,
    `a removed member cannot change an avatar (${revoked.status})`,
  );
});
