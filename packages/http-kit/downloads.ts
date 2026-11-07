/**
 * Handing a stored file back to a browser.
 *
 * Three routes — an export artifact, a vCard, and a person's file — each built
 * the same response and the same `Content-Disposition` out of two copies of
 * the same nine lines. Both live here now, because the disposition is the
 * awkward part and getting it wrong is a header-injection bug rather than a
 * cosmetic one.
 *
 * The disposition is written twice on purpose. `filename=` is the ASCII
 * fallback an old client reads, with every quote, backslash, and control
 * character replaced so a crafted name cannot close the quoted string or start
 * a second header line; `filename*=` is RFC 5987's percent-encoded UTF-8, which
 * is what a current browser actually uses, so an accented or non-Latin name
 * survives intact.
 */

/** The `Content-Disposition` value for a file offered as a download. */
export function attachmentFilename(filename: string): string {
  const fallback = filename.replace(/[\r\n"\\]/g, "_").replace(
    /[^\x20-\x7e]/g,
    "_",
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${
    encodeURIComponent(filename)
  }`;
}

/** One stored file, as the module that read it hands it over. */
export interface DownloadedFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

/**
 * How long a browser may reuse content addressed by an immutable id (D3).
 *
 * An avatar is served at its file id, and a new image is a new file id, so
 * the bytes behind one URL never change: the browser may keep them for a day
 * without asking again. `private` keeps them out of every shared cache.
 */
export const IMMUTABLE_PRIVATE_CONTENT = "private, max-age=86400, immutable";

/** How a download may be cached; by default it is never stored. */
export interface DownloadCaching {
  /** The URL names content that can never change (D3: avatars only). */
  readonly immutable?: boolean;
}

/**
 * The response a private download is served with.
 *
 * `no-store` keeps somebody else's file out of every cache on the way; only
 * content whose URL is its version may be kept, and then only privately.
 * `X-Content-Type-Options: nosniff` is not set here: the gateway adds it to
 * every response (`secure_headers.ts`), and a second copy is a contradiction
 * waiting to happen (SECA-13).
 */
export function fileDownload(
  file: DownloadedFile,
  caching: DownloadCaching = {},
): Response {
  return new Response(file.bytes.slice().buffer, {
    headers: {
      "Cache-Control": caching.immutable
        ? IMMUTABLE_PRIVATE_CONTENT
        : "private, no-store",
      "Content-Disposition": attachmentFilename(file.filename),
      "Content-Length": String(file.bytes.byteLength),
      "Content-Type": file.mimeType,
    },
  });
}
