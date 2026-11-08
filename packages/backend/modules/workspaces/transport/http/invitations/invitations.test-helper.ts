/**
 * The invitation coordinator every invitation suite starts from.
 *
 * GAP-021 split `invitations_test.ts` into one suite per step of the flow.
 * Each starts from the same fake coordinator, whose every operation succeeds
 * unless the test overrides it, and from the same secure headers: this flow
 * runs over HTTPS, so the cookies it sets are checked as secure ones.
 */

import type { InvitationHttpServices } from "../invitations.ts";

export function services(overrides: {
  readonly accept?: InvitationHttpServices["invitations"]["accept"];
  readonly acceptVerifiedEntry?:
    InvitationHttpServices["invitations"]["acceptVerifiedEntry"];
  readonly create?: InvitationHttpServices["invitations"]["create"];
  readonly list?: InvitationHttpServices["invitations"]["list"];
  readonly revoke?: InvitationHttpServices["invitations"]["revoke"];
  readonly resolve?: InvitationHttpServices["protectedSessions"]["resolve"];
  readonly inspect?: InvitationHttpServices["invitations"]["inspect"];
  readonly registerInvitee?:
    InvitationHttpServices["invitations"]["registerInvitee"];
  readonly retryInviteeVerification?:
    InvitationHttpServices["invitations"]["retryInviteeVerification"];
  readonly signIn?: InvitationHttpServices["protectedSessions"]["signIn"];
  readonly completeMfa?:
    InvitationHttpServices["protectedSessions"]["completeMfa"];
} = {}): InvitationHttpServices {
  const unresolved = Promise.resolve(undefined);
  return {
    browserSecurity: { origin: "https://kinship.test", secureCookie: true },
    hasher: {
      hash: (value) => Promise.resolve(`hash:${value}`),
      needsUpgrade: () => false,
      verify: () => Promise.resolve(true),
    },
    invitations: {
      accept: overrides.accept ??
        (() =>
          Promise.resolve({
            invitationId: "invitation",
            invitedByMemberId: "member",
            memberId: "member-2",
            role: "member" as const,
            status: "accepted" as const,
            workspaceId: "workspace",
            workspaceName: "Circle",
          })),
      create: overrides.create ?? (() => Promise.resolve("created" as const)),
      inspect: overrides.inspect ??
        (() =>
          Promise.resolve({
            email: "invitee@example.test",
            role: "member" as const,
            status: "pending" as const,
            workspaceName: "Circle",
          })),
      list: overrides.list ??
        (() =>
          Promise.resolve({
            invitations: [],
            members: [],
            status: "ready" as const,
          })),
      revoke: overrides.revoke ?? (() => Promise.resolve("revoked" as const)),
      registerInvitee: overrides.registerInvitee ??
        (() => Promise.resolve("verification-required" as const)),
      retryInviteeVerification: overrides.retryInviteeVerification ??
        (() => Promise.resolve("sent" as const)),
      acceptVerifiedEntry: overrides.acceptVerifiedEntry ??
        (() =>
          Promise.resolve({
            expiresAt: new Date("2026-08-16T00:00:00.000Z"),
            invitationId: "invitation",
            invitedByMemberId: "member",
            memberId: "member-2",
            role: "member" as const,
            sessionToken: "new-session",
            status: "accepted" as const,
            userId: "user-2",
            workspaceId: "workspace",
            workspaceName: "Circle",
          })),
    },
    protectedSessions: {
      completeMfa: overrides.completeMfa ?? (() => unresolved),
      establishVerifiedEntry: () => unresolved,
      resolve: overrides.resolve ?? (() =>
        Promise.resolve({
          accessibleWorkspaces: [],
          memberId: "member",
          role: "owner" as const,
          userId: "user",
          workspaceId: "workspace",
          workspaceName: "Circle",
        })),
      signIn: overrides.signIn ?? (() => unresolved),
      signOut: () => Promise.resolve(true),
    } as unknown as InvitationHttpServices["protectedSessions"],
  };
}

export const secureHeaders = {
  "content-type": "application/json",
  cookie: "__Host-kinship_session=session-secret",
  origin: "https://kinship.test",
};
