/**
 * The gift, debt, and recurring debt editors.
 *
 * Each validates with the create route's own contract schema before it asks
 * the island to save, and puts the fields a refused save names back on those
 * fields. The labels, field names, and native `<select>`s are the ones the
 * vanilla editors had, so keyboard, mobile pickers, and the GIFTS-001 journey
 * behave as before. Every currency picker starts on the member's preferred
 * currency, else the workspace default, else US dollars.
 */

import type { ReactNode } from "react";
import type { FieldError } from "react-hook-form";
import type {
  ProblemDetails,
  RecurringDebt,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useContractForm } from "../core/index.ts";
import { formActionsVariants } from "@/components/ui/variants.ts";
import {
  debtForm,
  type DebtFormValues,
  giftForm,
  type GiftFormValues,
  localToday,
  recurringDebtForm,
  recurringDebtFormValues,
  startingCurrency,
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

/** The supported currencies, as a picker's options. */
function CurrencyOptions(props: { readonly currencies: readonly string[] }) {
  return props.currencies.map((code) => (
    <option key={code} value={code}>{code}</option>
  ));
}

function EditorActions(
  props: { readonly disabled: boolean; readonly onCancel: () => void },
) {
  return (
    <div className={formActionsVariants()}>
      <Button
        disabled={props.disabled}
        type="submit"
      >
        Save
      </Button>
      <Button
        data-gift-cancel=""
        onClick={props.onCancel}
        type="button"
        variant="outline"
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
    /** The currency an amount starts in. */
    readonly defaultCurrency: string;
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
      currencyCode: startingCurrency(props.defaultCurrency, props.currencies),
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
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label>
        Gift name{" "}
        <Input
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
            {...form.register("eventAt")}
            disabled={props.gated}
            type="datetime-local"
          />
        </label>
        <label>
          Amount (optional){" "}
          <Input
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
            <CurrencyOptions currencies={props.currencies} />
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
    /** The currency the debt starts in. */
    readonly defaultCurrency: string;
    readonly gated: boolean;
    readonly onCancel: () => void;
    readonly onSave: (input: object) => Promise<SaveOutcome>;
  },
) {
  const form = useContractForm(debtForm, {
    defaultValues: {
      amount: "",
      currencyCode: startingCurrency(props.defaultCurrency, props.currencies),
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
      method="post"
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
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>
          Amount{" "}
          <Input
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
            <CurrencyOptions currencies={props.currencies} />
          </select>
          {currency.message}
        </label>
      </div>
      <label>
        Reason (optional){" "}
        <Textarea
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

/**
 * A recurring debt: the same debt charged every N months on a day of the
 * month, from a start date until an optional end. It edits an existing rule
 * when one is given and creates one otherwise; a new rule starts today, on
 * today's day of the month, in the preferred currency.
 */
export function RecurringDebtEditor(
  props: {
    readonly currencies: readonly string[];
    readonly defaultCurrency: string;
    readonly onCancel: () => void;
    readonly onSave: (input: object) => Promise<SaveOutcome>;
    /** The rule being edited, if this is not a new one. */
    readonly rule?: RecurringDebt | undefined;
    /** Today, as a date field holds it; the browser's own by default. */
    readonly today?: string;
  },
) {
  const form = useContractForm(recurringDebtForm, {
    defaultValues: recurringDebtFormValues(
      props.rule,
      startingCurrency(props.defaultCurrency, props.currencies),
      props.today ?? localToday(),
    ),
  });
  const { errors } = form.formState;
  const amount = fieldError("recurring-amount-error", errors.amount);
  const currency = fieldError("recurring-currency-error", errors.currencyCode);
  const interval = fieldError(
    "recurring-interval-error",
    errors.intervalMonths,
  );
  const day = fieldError("recurring-day-error", errors.dayOfMonth);
  const starts = fieldError("recurring-starts-error", errors.startsOn);
  const ends = fieldError("recurring-ends-error", errors.endsOn);
  const reason = fieldError("recurring-reason-error", errors.reason);
  const submit = form.handleSubmit(async (input) => {
    const problem = await props.onSave(input);
    if (problem) form.applyProblem(problem);
  });
  return (
    <form
      aria-label={props.rule ? "Edit recurring debt" : "Add recurring debt"}
      className="profile-fact-form"
      data-recurring-debt-form=""
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <div className="form-grid">
        <label>
          Direction
          <select {...form.register("direction")}>
            <option value="they_owe">They owe me</option>
            <option value="i_owe">I owe them</option>
          </select>
        </label>
        <label>
          Amount{" "}
          <Input
            {...form.register("amount")}
            {...amount.control}
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
            required
          >
            <CurrencyOptions currencies={props.currencies} />
          </select>
          {currency.message}
        </label>
        <label>
          Every (months){" "}
          <Input
            {...form.register("intervalMonths")}
            {...interval.control}
            inputMode="numeric"
            max={120}
            min={1}
            required
            type="number"
          />
          {interval.message}
        </label>
        <label>
          Day of month{" "}
          <Input
            {...form.register("dayOfMonth")}
            {...day.control}
            aria-describedby={day.message
              ? "recurring-day-hint recurring-day-error"
              : "recurring-day-hint"}
            inputMode="numeric"
            max={31}
            min={1}
            required
            type="number"
          />
          {day.message}
        </label>
        <label>
          Starts on{" "}
          <Input
            {...form.register("startsOn")}
            {...starts.control}
            required
            type="date"
          />
          {starts.message}
        </label>
        <label>
          Ends on (optional){" "}
          <Input
            {...form.register("endsOn")}
            {...ends.control}
            type="date"
          />
          {ends.message}
        </label>
      </div>
      <p id="recurring-day-hint">
        A month without that day is charged on its last day.
      </p>
      <label>
        Reason (optional){" "}
        <Textarea
          {...form.register("reason")}
          {...reason.control}
          maxLength={10000}
          rows={2}
        />
        {reason.message}
      </label>
      <EditorActions disabled={false} onCancel={props.onCancel} />
    </form>
  );
}
