import { describe, expect, it } from "vitest";
import type { PersonFile } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  countText,
  filesOf,
  filesReducer,
  fileStatusLabel,
  initialFiles,
  readableSize,
} from "./files.ts";

const file = (kind: PersonFile["kind"], fileId: string) =>
  ({ fileId, kind }) as PersonFile;

describe("FILES-001 file card wording", () => {
  it("names sizes, statuses, and counts", () => {
    expect(readableSize(1023)).toBe("1023 B");
    expect(readableSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(fileStatusLabel("available")).toBe("Available");
    expect(fileStatusLabel("missing")).toBe("Bytes missing");
    expect(fileStatusLabel("quarantined")).toBe("Quarantined");
    expect(fileStatusLabel("processing" as PersonFile["status"])).toBe(
      "Processing",
    );
    expect(countText("document", 0)).toBe("No documents saved.");
    expect(countText("photo", 1)).toBe("1 photo saved.");
    expect(countText("photo", 3)).toBe("3 photos saved.");
  });
});

describe("FILES-001 files reducer", () => {
  const loaded = filesReducer(initialFiles(false), {
    continued: false,
    files: [file("document", "a"), file("photo", "b")],
    nextCursor: "next",
    type: "loaded",
  });

  it("starts loading with nothing to attach", () => {
    expect(initialFiles(true)).toMatchObject({
      archived: true,
      list: { status: "loading" },
      listed: false,
    });
  });

  it("replaces the list on a first page and appends a continuation", () => {
    expect(loaded).toMatchObject({ listed: true, nextCursor: "next" });
    expect(filesOf(loaded, "document").map((entry) => entry.fileId)).toEqual([
      "a",
    ]);
    const more = filesReducer(loaded, {
      continued: true,
      files: [file("document", "c")],
      nextCursor: undefined,
      type: "loaded",
    });
    expect(filesOf(more, "document").map((entry) => entry.fileId)).toEqual([
      "a",
      "c",
    ]);
    const fresh = filesReducer(more, {
      continued: false,
      files: [],
      nextCursor: undefined,
      type: "loaded",
    });
    expect(fresh.files).toEqual([]);
  });

  it("keeps the rows but offers no page after a failure, clearing notices", () => {
    const noticed = filesReducer(loaded, {
      kind: "photo",
      notice: "Removing file…",
      type: "notice",
    });
    const failed = filesReducer(noticed, { detail: "Offline", type: "failed" });
    expect(failed).toMatchObject({
      list: { detail: "Offline", status: "error" },
      nextCursor: undefined,
      notices: {},
    });
    expect(failed.files).toHaveLength(2);
  });

  it("opens and closes one card's editor, never on an archived person", () => {
    const opened = filesReducer(loaded, { kind: "photo", type: "open" });
    expect(opened.editors).toEqual({ document: false, photo: true });
    const noticed = filesReducer(opened, {
      kind: "photo",
      notice: "Uploading file…",
      type: "notice",
    });
    const closed = filesReducer(noticed, { kind: "photo", type: "close" });
    expect(closed.editors.photo).toBe(false);
    expect(closed.notices.photo).toBe("Uploading file…");
    expect(
      filesReducer(opened, {
        kind: "photo",
        notice: "Upload cancelled. No file was stored.",
        type: "close",
      }).notices.photo,
    ).toBe("Upload cancelled. No file was stored.");
    const archived = filesReducer(opened, {
      archived: true,
      type: "lifecycle",
    });
    expect(archived.editors).toEqual({ document: false, photo: false });
    expect(filesReducer(archived, { kind: "document", type: "open" })).toBe(
      archived,
    );
    const restored = filesReducer(opened, {
      archived: false,
      type: "lifecycle",
    });
    expect(restored.editors.photo).toBe(true);
  });

  it("holds the list for a write and releases the file it removed", () => {
    const busy = filesReducer(loaded, {
      busy: true,
      removing: "a",
      type: "busy",
    });
    expect(busy).toMatchObject({ busy: true, removing: "a" });
    expect(
      filesReducer(busy, { busy: false, removing: "a", type: "busy" }),
    ).toMatchObject({ busy: false, removing: undefined });
  });
});
