/**
 * The workspaces module's HTTP surface, and the one transport file a
 * composition root imports from it.
 *
 * Six route groups sit behind it, each still built and mounted on its own so
 * the root keeps deciding which of them a deployment serves: registration and
 * verification, signing in and the session read, invitations, settings, and
 * the personal and workspace lifecycle pages.
 */

export {
  type AuthenticationHttpServices,
  createAuthenticationRoutes,
  type SessionLegalRequirements,
} from "./authentication.ts";
export {
  createInvitationRoutes,
  type InvitationHttpServices,
} from "./invitations.ts";
export {
  createPersonalLifecycleRoutes,
  type PersonalLifecycleHttpServices,
} from "./personal_lifecycle.ts";
export {
  createRegistrationRoutes,
  type RegistrationHttpServices,
} from "./registration.ts";
export { createSettingsRoutes, type SettingsHttpServices } from "./settings.ts";
export {
  createWorkspaceLifecycleRoutes,
  type WorkspaceLifecycleHttpServices,
} from "./workspace_lifecycle.ts";
