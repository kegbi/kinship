/**
 * How the module talks to somebody else's DAV server.
 *
 * One method, because one direction is supported: the remote is pulled and
 * never written to. It answers with the changes since the sync token it was
 * given and the token to use next time, or throws a `DavRemoteFailure`, which
 * is the only vocabulary a remote gets to speak in.
 */

import type { DavRemoteChange } from "../domain/dav_rules.ts";

export interface DavRemoteClient {
  pull(
    command: {
      readonly password: string;
      readonly remoteSyncToken?: string;
      readonly remoteUrl: string;
      readonly username?: string;
    },
  ): Promise<
    {
      readonly changes: readonly DavRemoteChange[];
      readonly remoteSyncToken: string;
    }
  >;
}
