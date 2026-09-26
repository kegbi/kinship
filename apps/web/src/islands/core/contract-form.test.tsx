// @vitest-environment happy-dom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debtStatusInput } from "../../../../../packages/contracts/schemas/gifts.ts";
import type { ProblemDetails } from "../../../../../packages/contracts/generated/auth-client.ts";
import { problemFieldName, useContractForm } from "./contract-form.ts";
import { z } from "zod";

afterEach(cleanup);

function problem(errors?: Record<string, string>): ProblemDetails {
  return {
    code: "invalid_request",
    detail: "Check the highlighted fields.",
    status: 400,
    title: "Invalid request",
    type: "https://kinship.test/problems/invalid_request",
    ...(errors ? { errors } : {}),
  };
}

const note = z.strictObject({
  title: z.string().trim().min(1),
  detail: z.strictObject({ body: z.string() }),
});

/** A form whose errors the render reads, as a component showing them would. */
function useSubscribedNoteForm() {
  const form = useContractForm(note, {
    defaultValues: { detail: { body: "" }, title: "" },
  });
  void form.formState.errors;
  return form;
}

describe("GAP-026 problemFieldName", () => {
  it("reads a field name or an RFC 6901 pointer as a form path", () => {
    expect(problemFieldName("title")).toBe("title");
    expect(problemFieldName("/title")).toBe("title");
    expect(problemFieldName("/detail/body")).toBe("detail.body");
    expect(problemFieldName("/a~1b/c~0d")).toBe("a/b.c~d");
    expect(problemFieldName("")).toBe("");
  });
});

describe("GAP-026 useContractForm", () => {
  it("validates with the published contract schema before submitting", async () => {
    const submitted = vi.fn();
    function StatusForm() {
      const form = useContractForm(debtStatusInput, {
        defaultValues: { status: "" as "open" },
      });
      return (
        <form onSubmit={form.handleSubmit(submitted)} noValidate>
          <label>
            Status
            <input {...form.register("status")} />
          </label>
          {form.formState.errors.status
            ? <p role="alert">{form.formState.errors.status.message}</p>
            : null}
          <button type="submit">Save</button>
        </form>
      );
    }
    const user = userEvent.setup();
    render(<StatusForm />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(submitted).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Status"), "settled");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    expect(submitted.mock.calls[0]?.[0]).toEqual({ status: "settled" });
  });

  it("says a missing field is required instead of naming types", async () => {
    const titled = z.strictObject({ title: z.string() });
    const { result } = renderHook(() => {
      const form = useContractForm(titled);
      void form.formState.errors;
      return form;
    });
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.formState.errors.title?.message).toBe("Required.");
  });

  it("lets a surface word an issue and keeps the default wording otherwise", async () => {
    const limited = z.strictObject({
      labels: z.array(z.string()).max(1),
      title: z.string().max(3),
      type: z.string(),
    });
    const { result } = renderHook(() => {
      const form = useContractForm(limited, {
        defaultValues: { labels: ["a", "b"], title: "long" },
        issueMessage: (issue) =>
          issue.code === "too_big"
            ? `${issue.path?.join(".")} holds at most ${String(issue.maximum)}.`
            : undefined,
      });
      void form.formState.errors;
      return form;
    });
    await act(async () => {
      await result.current.trigger();
    });
    const { errors } = result.current.formState;
    expect(errors.title?.message).toBe("title holds at most 3.");
    expect(errors.labels?.message).toBe("labels holds at most 1.");
    expect(errors.type?.message).toBe("Required.");
  });

  it("maps a problem's field errors onto the matching fields", () => {
    const { result } = renderHook(() => useSubscribedNoteForm());
    let mapped: readonly string[] = [];
    act(() => {
      mapped = result.current.applyProblem(problem({
        "/detail/body": "Too long.",
        title: "Required.",
        unknown: "Not a field.",
      }));
    });
    expect(mapped).toEqual(["detail.body", "title"]);
    expect(result.current.getFieldState("title").error?.message).toBe(
      "Required.",
    );
    expect(result.current.getFieldState("detail.body").error?.message).toBe(
      "Too long.",
    );
    expect(result.current.formState.errors.root?.["server"]?.message).toBe(
      "Check the highlighted fields.",
    );
  });

  it("keeps a problem without field errors on the form root", () => {
    const { result } = renderHook(() => useSubscribedNoteForm());
    let mapped: readonly string[] = ["unchanged"];
    act(() => {
      mapped = result.current.applyProblem(problem());
    });
    expect(mapped).toEqual([]);
    expect(result.current.formState.errors.root?.["server"]?.message).toBe(
      "Check the highlighted fields.",
    );
  });
});
