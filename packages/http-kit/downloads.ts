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
 * The response a private download is served with.
 *
 * `no-store` keeps somebody else's file out of every cache on the way, and
 * `nosniff` keeps a browser from deciding a document is something executable.
 */
export function fileDownload(file: DownloadedFile): Response {
  return new Response(file.bytes.slice().buffer, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": attachmentFilename(file.filename),
      "Content-Length": String(file.bytes.byteLength),
      "Content-Type": file.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
