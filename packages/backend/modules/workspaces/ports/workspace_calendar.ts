/**
 * Which calendar a workspace keeps.
 *
 * A recurring debt that falls due "on the 1st" falls due on the workspace's
 * 1st, so a module that schedules by calendar date asks for the workspace's
 * time zone here rather than reading `workspace_settings` itself.
 */

export interface WorkspaceCalendarTransaction {
  readonly opaque: unknown;
}

export interface WorkspaceCalendarBoundary {
  /**
   * The default time zone each named workspace set. A workspace that set none
   * is left out, and its caller falls back to UTC.
   */
  timezones(command: {
    readonly transaction: WorkspaceCalendarTransaction;
    readonly workspaceIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}
