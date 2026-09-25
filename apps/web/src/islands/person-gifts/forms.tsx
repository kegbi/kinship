/**
 * The gift and debt editors.
 *
 * Each validates with the create route's own contract schema before it asks
 * the island to save, and puts the fields a refused save names back on those
 * fields. The labels, field names, and native `<select>`s are the ones the
 * vanilla editors had, so keyboard, mobile pickers, and the GIFTS-001 journey
 * behave as before.
 */

import type { ReactNode } from "react";
import type { FieldError } from "react-hook-form";
import type { ProblemDetails } from "../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useContractForm } from "../core/index.ts";
import { LEGACY_BUTTON, LEGACY_INPUT, LEGACY_TEXTAREA } from "./legacy-look.ts";
import {
  debtForm,
  type DebtFormValues,
  giftForm,
  type GiftFormValues,
} from "./records.ts";

/** A save the island ran: the problem that refused it, if any. */
export type SaveOutcome = ProblemDetails | undefined;

type Choice = { readonly label: string; readonly value: string };

/** The field-level refusal under a control, which the control points at. */
function fieldError(
  id: string,
  error: FieldError | undefined,
): { readonly control: object; readonly message: ReactNode } {
  if (!error?.message) return { control: {}, message: null };
  return {
    control: { "aria-describedby": id, "aria-invalid": true },
    message: <small id={id} data-field-error="">{error.message}</small>,
  };
}

function EditorActions(
  props: { readonly disabled: boolean; readonly onCancel: () => void },
) {
  return (
    <div className="form-actions">
      <Button
        className={`button-primary ${LEGACY_BUTTON}`}
        disabled={props.disabled}
        type="submit"
      >
        Save
      </Button>
      <Button
        className={`button-secondary ${LEGACY_BUTTON}`}
        data-gift-cancel=""
        onClick={props.onCancel}
        type="button"
      >
        Cancel
      </Button>
    </div>
  );
}

export function GiftEditor(
  props: {
    readonly attachments: readonly Choice[];
    readonly currencies: readonly string[];
    /** True until the recipient and attachment choices have loaded. */
    readonly gated: boolean;
    readonly onCancel: () => void;
    readonly onSave: (input: object) => Promise<SaveOutcome>;
    readonly recipients: readonly Choice[];
  },
) {
  const form = useContractForm(giftForm, {
    defaultValues: {
      amount: "",
      attachmentFileId: "",
      comment: "",
      currencyCode: "",
      eventAt: "",
      name: "",
      recipientPersonId: "",
      status: "idea",
      url: "",
    } satisfies GiftFormValues,
  });
  const { errors } = form.formState;
  const name = fieldError("gift-name-error", errors.name);
  const amount = fieldError("gift-amount-error", errors.amount);
  const currency = fieldError("gift-currency-error", errors.currencyCode);
  const url = fieldError("gift-url-error", errors.url);
  const submit = form.handleSubmit(async (input) => {
    const problem = await props.onSave(input);
    if (problem) form.applyProblem(problem);
  });
  return (
    <form
      aria-busy={props.gated ? "true" : undefined}
      className="profile-fact-form"
      data-gift-form=""
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label>
        Gift name{" "}
        <Input
          className={LEGACY_INPUT}
          {...form.register("name")}
          {...name.control}
          disabled={props.gated}
          maxLength={500}
          required
        />
        {name.message}
      </label>
      <div className="form-grid">
        <label>
          Status
          <select {...form.register("status")} disabled={props.gated}>
            <option value="idea">Idea</option>
            <option value="planned">Planned</option>
            <option value="given">Given</option>
            <option value="received">Received</option>
          </select>
        </label>
        <label>
          Event time (optional){" "}
          <Input
            className={LEGACY_INPUT}
            {...form.register("eventAt")}
            disabled={props.gated}
            type="datetime-local"
          />
        </label>
        <label>
          Amount (optional){" "}
          <Input
            className={LEGACY_INPUT}
            {...form.register("amount")}
            {...amount.control}
            disabled={props.gated}
            inputMode="decimal"
            pattern="\d{1,15}(\.\d{1,4})?"
          />
          {amount.message}
        </label>
        <label>
          Currency (with amount){" "}
          <select
            {...form.register("currencyCode")}
            {...currency.control}
            disabled={props.gated}
          >
            <option value="">Select currency</option>
            {props.currencies.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          {currency.message}
        </label>
      </div>
      <label>
        Recipient (optional){" "}
        <select {...form.register("recipientPersonId")} disabled={props.gated}>
          <option value="">No recipient</option>
          {props.recipients.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Existing attachment (optional){" "}
        <select {...form.register("attachmentFileId")} disabled={props.gated}>
          <option value="">No attachment</option>
          {props.attachments.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Link (optional){" "}
        <Input
          className={LEGACY_INPUT}
          {...form.register("url")}
          {...url.control}
          disabled={props.gated}
          maxLength={2000}
          type="url"
        />
        {url.message}
      </label>
      <label>
        Notes (optional){" "}
        <Textarea
          className={LEGACY_TEXTAREA}
          {...form.register("comment")}
          disabled={props.gated}
          maxLength={10000}
          rows={3}
        />
      </label>
      <EditorActions disabled={props.gated} onCancel={props.onCancel} />
    </form>
  );
}

export function DebtEditor(
  props: {
    readonly currencies: readonly string[];
    readonly gated: boolean;
    readonly onCancel: () => void;
    readonly onSave: (input: object) => Promise<SaveOutcome>;
  },
) {
  const form = useContractForm(debtForm, {
    defaultValues: {
      amount: "",
      currencyCode: props.currencies[0] ?? "",
      direction: "they_owe",
      reason: "",
      status: "open",
    } satisfies DebtFormValues,
  });
  const { errors } = form.formState;
  const amount = fieldError("debt-amount-error", errors.amount);
  const currency = fieldError("debt-currency-error", errors.currencyCode);
  const reason = fieldError("debt-reason-error", errors.reason);
  const submit = form.handleSubmit(async (input) => {
    const problem = await props.onSave(input);
    if (problem) form.applyProblem(problem);
  });
  return (
    <form
      aria-busy={props.gated ? "true" : undefined}
      className="profile-fact-form"
      data-gift-form=""
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <div className="form-grid">
        <label>
          Direction
          <select {...form.register("direction")} disabled={props.gated}>
            <option value="they_owe">They owe me</option>
            <option value="i_owe">I owe them</option>
          </select>
        </label>
        <label>
          Status
          <select {...form.register("status")} disabled={props.gated}>
            <option value="open">Open</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>
          Amount{" "}
          <Input
            className={LEGACY_INPUT}
            {...form.register("amount")}
            {...amount.control}
            disabled={props.gated}
            inputMode="decimal"
            pattern="\d{1,15}(\.\d{1,4})?"
            required
          />
          {amount.message}
        </label>
        <label>
          Currency{" "}
          <select
            {...form.register("currencyCode")}
            {...currency.control}
            disabled={props.gated}
            required
          >
            {props.currencies.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          {currency.message}
        </label>
      </div>
      <label>
        Reason (optional){" "}
        <Textarea
          className={LEGACY_TEXTAREA}
          {...form.register("reason")}
          {...reason.control}
          disabled={props.gated}
          maxLength={10000}
          rows={3}
        />
        {reason.message}
      </label>
      <EditorActions disabled={props.gated} onCancel={props.onCancel} />
    </form>
  );
}
