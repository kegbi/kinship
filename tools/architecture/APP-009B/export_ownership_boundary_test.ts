const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("[EXPORT-001] import-export reads people and artifacts only through owning public boundaries", async () => {
  const [application, repository, people, files] = await Promise.all([
    read(
      "packages/backend/modules/import-export/application/export_management.ts",
    ),
    read(
      "packages/backend/modules/import-export/adapters/postgres/export_repository.ts",
    ),
    read(
      "packages/backend/modules/people/adapters/postgres/export_people_boundary.ts",
    ),
    read(
      "packages/backend/modules/files/adapters/postgres/export_file_boundary.ts",
    ),
  ]);
  if (
    !application.includes('from "../../people/public.ts"') ||
    !application.includes('from "../../files/public.ts"')
  ) {
    throw new Error("export orchestration must consume owning public facades");
  }
  if (/crm\.(people|person_contact_methods|files)\b/.test(repository)) {
    throw new Error(
      "import-export repository crossed a source-module table boundary",
    );
  }
  if (
    !/crm\.people\b/.test(people) ||
    !/crm\.person_contact_methods\b/.test(people)
  ) {
    throw new Error("people-owned export projection is missing");
  }
  if (!/crm\.files\b/.test(files)) {
    throw new Error("files-owned export artifact boundary is missing");
  }
});
