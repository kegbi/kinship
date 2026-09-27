/**
 * A person's documents and photos as one island (GAP-033). It replaces
 * `lib/person-files.ts`.
 *
 * The profile shows the two as sibling cards, and one list read answers
 * both. One component owns that state for both cards, as the gifts island
 * does: it renders the documents card into the section it is mounted on and
 * the photos card into its sibling through a portal, so there is one list
 * request, one upload or removal at a time, and one refresh after it. Its
 * state moves through `filesReducer`; every read goes through one
 * latest-request slot; while a write owns the list its Remove controls are
 * unavailable and Load more files is hidden until the refresh has answered.
 *
 * Both cards keep the markup the shell drew — the section, its heading,
 * glyph, badge, and state line — so the page looks the same before and after
 * hydration, and every `data-file-*` hook the page and its tests use.
 */

import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  listPersonFiles,
  type PersonFile,
  personFileContentUrl,
  removePersonFile,
  uploadPersonFile,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeVariants,
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  LoadMore,
  mountIsland,
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { SectionGlyph } from "../section-glyph.tsx";
import { SectionLoading } from "../section-loading.tsx";
import type { SectionMount } from "../section-mounts.ts";
import {
  countText,
  FILE_CARDS,
  FILE_KINDS,
  type FileKind,
  FILES_UNAVAILABLE,
  filesOf,
  filesReducer,
  type FilesState,
  fileStatusLabel,
  initialFiles,
  readableSize,
} from "./files.ts";

export const PERSON_FILES_ISLAND = "person-files";

export interface PersonFilesProps {
  readonly archived: boolean;
  readonly personId: string;
  readonly workspaceId: string;
  /** The two cards the shell drew; the documents card is the island's root. */
  readonly sections: Readonly<Record<FileKind, HTMLElement>>;
  /** Called once, when the first list answer has settled either way. */
  readonly onSettled?: () => void;
}

export function PersonFiles(props: PersonFilesProps) {
  const { personId, sections, workspaceId } = props;
  const [state, dispatch] = useReducer(
    filesReducer,
    props.archived,
    initialFiles,
  );
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  /** Reads the first page, or the page after `cursor`; answers whether it landed. */
  const refresh = (cursor?: string): Promise<boolean> =>
    request(() =>
      listPersonFiles(personId, workspaceId, cursor ? { cursor } : {})
    ).then((answer) => {
      if (!answer) return false;
      if (answer.status !== "ready") {
        dispatch({
          detail: answer.problem?.detail ?? FILES_UNAVAILABLE,
          type: "failed",
        });
        return false;
      }
      dispatch({
        continued: cursor !== undefined,
        files: answer.data!.files,
        nextCursor: answer.data!.nextCursor,
        type: "loaded",
      });
      return true;
    });

  const first = useEffectEvent(() => refresh());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    for (const kind of FILE_KINDS) {
      sections[kind].setAttribute(
        "data-section-state",
        state.list.status === "ready"
          ? filesOf(state, kind).length === 0 ? "empty" : "ready"
          : state.list.status,
      );
    }
  });

  useDocumentEvent<
    CustomEvent<{ readonly archived?: unknown; readonly personId?: unknown }>
  >("person-lifecycle-changed", (event) => {
    const detail = event.detail;
    if (detail?.personId !== personId || typeof detail.archived !== "boolean") {
      return;
    }
    dispatch({ archived: detail.archived, type: "lifecycle" });
  });

  /**
   * The one write flag, rendered: it disables every Remove control and hides
   * Load more files, and each write checks it first. A click or submission
   * is a discrete event, so the next one already sees the flag it set.
   */
  const lock = (busy: boolean, removing?: string) =>
    dispatch({ busy, removing, type: "busy" });

  // The reducer keeps an archived person's editors closed.
  const open = (kind: FileKind) => dispatch({ kind, type: "open" });

  const cancel = (kind: FileKind) =>
    dispatch({
      kind,
      notice: "Upload cancelled. No file was stored.",
      type: "close",
    });

  const upload = async (
    kind: FileKind,
    event: SyntheticEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (state.archived || state.busy) return;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const file = form.querySelector<HTMLInputElement>('input[name="file"]')
      ?.files?.[0];
    if (!file || !title) {
      dispatch({
        kind,
        notice: "Choose a file and add a title.",
        type: "notice",
      });
      return;
    }
    lock(true);
    dispatch({ kind, notice: "Uploading file…", type: "notice" });
    const answer = await settle(() =>
      uploadPersonFile(personId, { file, kind, title }, workspaceId)
    );
    if (answer.status !== "ready") {
      lock(false);
      dispatch({
        kind,
        notice: answer.problem?.detail ?? "The file could not be uploaded.",
        type: "notice",
      });
      return;
    }
    form.reset();
    dispatch({ kind, type: "close" });
    const refreshed = await refresh();
    lock(false);
    if (!refreshed) return;
    dispatch({
      kind,
      notice: answer.data!.file.status === "quarantined"
        ? "File saved in quarantine and cannot be downloaded."
        : "File uploaded.",
      type: "notice",
    });
  };

  /** Removes `file` from the card of `kind` that lists it. */
  const remove = async (file: PersonFile, kind: FileKind) => {
    if (state.archived || state.busy) return;
    lock(true, file.fileId);
    dispatch({ kind, notice: "Removing file…", type: "notice" });
    const answer = await settle(() =>
      removePersonFile(personId, file.fileId, workspaceId)
    );
    if (answer.status !== "ready") {
      lock(false);
      dispatch({
        kind,
        notice: answer.problem?.detail ?? "The file could not be removed.",
        type: "notice",
      });
      return;
    }
    const refreshed = await refresh();
    lock(false);
    if (refreshed) dispatch({ kind, notice: "File removed.", type: "notice" });
  };

  const card = (kind: FileKind) => (
    <FilesCard
      kind={kind}
      onCancel={() => cancel(kind)}
      onLoadMore={(cursor) => refresh(cursor)}
      onOpen={() => open(kind)}
      onRemove={(file) => void remove(file, kind)}
      onRetry={() => void refresh()}
      onUpload={(event) => void upload(kind, event)}
      state={state}
    />
  );

  return (
    <>
      {card("document")}
      {createPortal(card("photo"), sections.photo)}
    </>
  );
}

function FilesCard(
  props: {
    readonly kind: FileKind;
    readonly onCancel: () => void;
    readonly onLoadMore: (cursor: string) => Promise<unknown>;
    readonly onOpen: () => void;
    readonly onRemove: (file: PersonFile) => void;
    readonly onRetry: () => void;
    readonly onUpload: (event: SyntheticEvent<HTMLFormElement>) => void;
    readonly state: FilesState;
  },
) {
  const { kind, state } = props;
  const { id, noun, plural, title: heading } = FILE_CARDS[kind];
  const listId = `${id}-list`;
  const files = filesOf(state, kind);
  const open = state.editors[kind];
  const title = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) title.current?.focus();
  }, [open]);
  // An archived person's draft upload is dropped with its editor.
  useLayoutEffect(() => {
    if (state.archived) form.current?.reset();
  }, [state.archived]);
  const cancel = () => {
    form.current?.reset();
    props.onCancel();
    add.current?.focus();
  };
  const badge = state.list.status === "loading"
    ? "Loading"
    : state.list.status === "error"
    ? "Unavailable"
    : `${files.length} saved`;
  const line: ReactNode = state.notices[kind] ??
    (state.list.status === "error"
      ? state.list.detail
      : state.list.status === "ready"
      ? countText(kind, files.length)
      : <SectionLoading label={`Loading ${plural}…`} />);
  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph className="profile-section-glyph" name={id} />
        <div className="profile-section-title">
          <h3 id={`profile-section-${id}-heading`}>{heading}</h3>
          <span
            className={badgeVariants({ variant: "status" })}
            data-file-badge=""
          >
            {badge}
          </span>
        </div>
        <button
          ref={add}
          className={buttonVariants({ className: "profile-section-cta" })}
          data-file-add=""
          hidden={!state.listed || state.archived}
          onClick={props.onOpen}
          type="button"
        >
          Attach {noun}
        </button>
      </header>
      <p className="section-state" data-file-state="">{line}</p>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-file-refresh=""
        hidden={state.list.status !== "error"}
        onClick={props.onRetry}
        type="button"
      >
        Retry loading
      </button>
      <ul
        aria-label={`Saved ${plural}`}
        className="person-file-list"
        data-file-list=""
        id={listId}
      >
        {files.map((file) => (
          <FileItem
            archived={state.archived}
            busy={state.busy}
            file={file}
            key={file.fileId}
            onRemove={props.onRemove}
            removing={state.removing === file.fileId}
          />
        ))}
      </ul>
      <LoadMore
        controls={listId}
        cursor={state.busy ? undefined : state.nextCursor}
        label="Load more files"
        list="files"
        onLoad={props.onLoadMore}
      />
      <form
        ref={form}
        className="profile-fact-form"
        data-file-form=""
        hidden={!open}
        method="post"
        noValidate
        onSubmit={props.onUpload}
      >
        <label>
          Title <input ref={title} maxLength={500} name="title" required />
        </label>
        <label>
          File{" "}
          <input
            accept={kind === "photo"
              ? "image/jpeg,image/png,image/webp"
              : "application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
            name="file"
            required
            type="file"
          />
        </label>
        <p className="form-hint">Maximum file size: 10 MB.</p>
        <div className={formActionsVariants()} data-form-actions="">
          <button
            className={buttonVariants()}
            disabled={state.busy}
            type="submit"
          >
            Upload
          </button>
          <button
            className={buttonVariants({ variant: "outline" })}
            data-file-cancel=""
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

function FileItem(
  props: {
    readonly archived: boolean;
    readonly busy: boolean;
    readonly file: PersonFile;
    readonly onRemove: (file: PersonFile) => void;
    readonly removing: boolean;
  },
) {
  const { file } = props;
  return (
    <li data-file-id={file.fileId} data-file-status={file.status}>
      <div>
        <strong>{file.title}</strong>
        <p>{`${file.filename} · ${readableSize(file.byteSize)}`}</p>
        <span
          className={badgeVariants({
            className: "mt-(--space-1)",
            variant: file.status === "available" ? "secondary" : "default",
          })}
        >
          {fileStatusLabel(file.status)}
        </span>
      </div>
      <div
        className={formActionsVariants({ className: "person-file-actions" })}
      >
        {file.status === "available"
          ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={personFileContentUrl(file.personId, file.fileId)}
            >
              Download
            </a>
          )
          : null}
        {props.archived ? null : (
          <button
            className={buttonVariants({
              className: "person-file-remove",
              variant: "destructive",
            })}
            data-file-remove={file.fileId}
            disabled={props.busy}
            aria-busy={props.removing ? "true" : undefined}
            onClick={() => props.onRemove(file)}
            type="button"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Mounts the island over both cards inside `container` and resolves, once
 * the first list answer has settled, with the function that unmounts it.
 * Without both cards there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonFiles: SectionMount = (container, props) => {
  const document = container.querySelector<HTMLElement>(
    '[data-person-files="document"]',
  );
  const photo = container.querySelector<HTMLElement>(
    '[data-person-files="photo"]',
  );
  if (!document || !photo) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    // The photos card renders through a portal, which appends; its shell
    // content goes in the same task as the first commit.
    photo.replaceChildren();
    const unmount = mountIsland(
      document,
      PERSON_FILES_ISLAND,
      <PersonFiles
        archived={props.archived}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        sections={{ document, photo }}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
