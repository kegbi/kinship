import { buildOpenApiDocument } from "../../tools/contracts/document.ts";
import { buildExternalOpenApiDocument } from "../../tools/contracts/external.ts";
import * as client from "./generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[FILES-001] generated contract exposes opaque person file operations", () => {
  interface FilePath {
    readonly get: {
      readonly responses: Readonly<
        Record<string, {
          readonly content: Readonly<Record<string, unknown>>;
        }>
      >;
    };
    readonly post: {
      readonly requestBody: {
        readonly content: Readonly<Record<string, unknown>>;
      };
    };
  }
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, FilePath>>;
    readonly components: {
      readonly schemas: Readonly<Record<string, unknown>>;
    };
  };
  assert(
    document.paths["/api/v1/people/{personId}/files"],
    "list/upload path generated",
  );
  assert(
    document.paths["/api/v1/people/{personId}/files/{fileId}/content"],
    "download path generated",
  );
  assert(document.components.schemas.PersonFile, "person file DTO generated");
  assert(typeof client.listPersonFiles === "function", "list client generated");
  assert(
    typeof client.uploadPersonFile === "function",
    "upload client generated",
  );
  assert(
    typeof client.removePersonFile === "function",
    "remove client generated",
  );
  assert(
    typeof client.personFileContentUrl === "function",
    "opaque content URL generated",
  );
  assert(
    document.paths["/api/v1/settings/storage"],
    "workspace storage settings path generated",
  );
  assert(
    typeof client.getStorageSettings === "function",
    "storage settings client generated",
  );
  assert(
    !JSON.stringify(document.components.schemas.StorageSettings).match(
      /accessKey|secretKey|storageKey|checksum/i,
    ),
    "storage diagnostics omit credentials, object keys, and checksums",
  );
  assert(
    !JSON.stringify(document.components.schemas.PersonFile).includes(
      "storageKey",
    ),
    "storage key is absent from transport contract",
  );
  const uploadMedia = document.paths["/api/v1/people/{personId}/files"].post
    .requestBody.content;
  const docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  assert(uploadMedia[docx], "DOCX upload media is documented");
  const downloadMedia = document.paths[
    "/api/v1/people/{personId}/files/{fileId}/content"
  ].get.responses["200"]!.content;
  for (
    const media of [
      "application/pdf",
      docx,
      "text/plain",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]
  ) assert(downloadMedia[media], `${media} download is documented`);
});

Deno.test("[MCP-B8] the bearer document keeps the upload's file headers and leaves storage settings out", () => {
  interface Operation {
    readonly parameters?: readonly {
      readonly in: string;
      readonly name: string;
      readonly required?: boolean;
    }[];
    readonly security?: unknown;
  }
  type Paths = Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  const internal = buildOpenApiDocument() as unknown as { paths: Paths };
  const external = buildExternalOpenApiDocument() as unknown as {
    paths: Paths;
  };
  const upload = external.paths["/api/v1/people/{personId}/files"]?.post;
  const headers = (upload?.parameters ?? []).filter((each) =>
    each.in === "header"
  );
  const required = (name: string) =>
    headers.find((each) => each.name === name)?.required === true;
  assert(
    required("X-File-Kind") && required("X-File-Name") &&
      required("X-File-Title"),
    `the bearer upload documents its file headers: ${JSON.stringify(headers)}`,
  );
  assert(
    !headers.some((each) => each.name === "Origin"),
    "the bearer upload document asks for no Origin",
  );
  assert(
    JSON.stringify(
          internal.paths["/api/v1/settings/storage"]?.get?.security,
        ) === JSON.stringify([{ kinship_session: [] }]) &&
      external.paths["/api/v1/settings/storage"] === undefined,
    "storage diagnostics stay session-only",
  );
});
