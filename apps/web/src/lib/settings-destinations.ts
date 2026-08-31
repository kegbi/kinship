export const groups = [
  {
    label: "Personal",
    danger: false,
    destinations: [
      {
        id: "settings.profile",
        label: "Profile",
        href: "/app/settings/profile",
        access: "member",
      },
      {
        id: "settings.preferences",
        label: "Preferences",
        href: "/app/settings/preferences",
        access: "member",
      },
      {
        id: "settings.security",
        label: "Security & sessions",
        href: "/app/settings/security",
        access: "member",
      },
    ],
  },
  {
    label: "Workspace",
    danger: false,
    destinations: [
      {
        id: "settings.workspace",
        label: "General",
        href: "/app/settings/workspace",
        access: "admin",
      },
      {
        id: "settings.members",
        label: "Members",
        href: "/app/settings/members",
        access: "admin",
      },
      {
        id: "settings.personalization",
        label: "Personalization",
        href: "/app/settings/personalization?section=profile-modules",
        access: "admin",
      },
    ],
  },
  {
    label: "Data",
    danger: false,
    destinations: [
      {
        id: "settings.storage",
        label: "Storage",
        href: "/app/settings/storage",
        access: "admin",
      },
      {
        id: "settings.import",
        label: "Import",
        href: "/app/settings/import",
        access: "admin",
      },
      {
        id: "settings.export",
        label: "Export",
        href: "/app/settings/export",
        access: "admin",
      },
      {
        id: "settings.audit",
        label: "Audit history",
        href: "/app/settings/audit",
        access: "admin",
      },
    ],
  },
  {
    label: "Developer",
    danger: false,
    destinations: [
      {
        id: "settings.integrations",
        label: "Integrations",
        href: "/app/settings/integrations",
        access: "admin",
      },
      {
        id: "settings.api-access",
        label: "API access",
        href: "/app/settings/api",
        access: "admin",
      },
    ],
  },
  {
    label: "Workspace actions",
    danger: true,
    destinations: [
      {
        id: "settings.workspace-danger",
        label: "Workspace danger zone",
        href: "/app/settings/workspace/danger-zone",
        access: "owner",
      },
    ],
  },
] as const;
