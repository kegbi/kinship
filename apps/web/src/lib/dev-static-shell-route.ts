import { UUID_SOURCE as uuid } from "./uuid.ts";

const shellRoutes = [
  [
    new RegExp(`^/app/people/${uuid}/activity-report/?$`),
    "/internal/activity-report-shell",
  ],
  [
    new RegExp(`^/app/people/${uuid}/audit/?$`),
    "/internal/person-audit-shell",
  ],
  [
    new RegExp(`^/app/people/${uuid}/?$`),
    "/internal/person-profile-shell",
  ],
  [new RegExp(`^/app/journal/${uuid}/?$`), "/internal/journal-item-shell"],
  [
    new RegExp(`^/app/settings/import/${uuid}/?$`),
    "/internal/import-report-shell",
  ],
  // ADR 0007: every invitation link shares one static shell.
  [/^\/invite\/[^/]+$/, "/internal/invite-shell"],
] as const;

export function resolveDevStaticShellRoute(
  requestedUrl: string | undefined,
): string | undefined {
  if (!requestedUrl) return undefined;
  const queryStart = requestedUrl.indexOf("?");
  const pathname = queryStart === -1
    ? requestedUrl
    : requestedUrl.slice(0, queryStart);
  const search = queryStart === -1 ? "" : requestedUrl.slice(queryStart);
  const route = shellRoutes.find(([pattern]) => pattern.test(pathname));
  return route ? `${route[1]}${search}` : undefined;
}
