/**
 * The public privacy and terms pages' document (GAP-033, ADR 0007).
 *
 * `/privacy` and `/terms` render on demand: the renderer reads the active
 * version from the API's public read while it draws the page, so the text is
 * in the HTML, reads without JavaScript, and the pages ship no script. The
 * gateway keeps a successful page for five minutes; every other answer is
 * rendered again on the next request. Acceptance never reads this page: the
 * required legal review (`features/compliance/`) asks the API itself.
 */

import { legalDocumentReady } from "../../../../packages/contracts/schemas/governance.ts";
import { formatInstant } from "./time-presentation.ts";

export type LegalDocumentType = "privacy" | "terms";

/** The page the renderer draws, with the status it answers. */
export type PublicLegalPage =
  | {
    readonly status: 200;
    readonly title: string;
    readonly version: string;
    readonly content: string;
  }
  | {
    readonly status: 404 | 503;
    readonly title: string;
    readonly message: string;
  };

export interface PublicLegalReadOptions {
  /** The private API origin the renderer reaches (`API_ORIGIN`). */
  readonly apiOrigin: string;
  /** The gateway's request identifier, forwarded for correlation. */
  readonly requestId?: string | null | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const TITLES: Readonly<Record<LegalDocumentType, string>> = {
  privacy: "Privacy policy",
  terms: "Terms of service",
};

/** The identifier shape the API's request-ID middleware keeps. */
const REQUEST_ID = /^[\w-]{1,128}$/;

/** Below the gateway's 10-second read timeout for the page itself. */
const DEFAULT_TIMEOUT_MS = 3_000;

export async function readPublicLegalPage(
  documentType: LegalDocumentType,
  options: PublicLegalReadOptions,
): Promise<PublicLegalPage> {
  const title = TITLES[documentType];
  const unavailable = {
    status: 503,
    title,
    message: "This legal document is temporarily unavailable.",
  } as const;
  const headers = new Headers({ accept: "application/json" });
  if (options.requestId && REQUEST_ID.test(options.requestId)) {
    headers.set("x-request-id", options.requestId);
  }
  try {
    const response = await (options.fetch ?? globalThis.fetch)(
      new URL(`/api/v1/legal-documents/${documentType}`, options.apiOrigin),
      {
        headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      },
    );
    if (response.status === 404) {
      return {
        status: 404,
        title,
        message: `This ${title.toLowerCase()} has not been published yet.`,
      };
    }
    if (!response.ok) return unavailable;
    const parsed = legalDocumentReady.safeParse(await response.json());
    if (!parsed.success) return unavailable;
    const { content, publishedAt, version } = parsed.data.document;
    return {
      status: 200,
      title,
      version: `Version ${version}${
        publishedAt
          ? ` · Published ${
            formatInstant(publishedAt, {
              locale: "en",
              effectiveTimezone: "UTC",
            })
          }`
          : ""
      }`,
      content,
    };
  } catch {
    return unavailable;
  }
}
