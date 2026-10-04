import type { Dispatch } from "react";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  debtAmountPreview,
  type NewImportAction,
  type NewImportState,
} from "./imports.ts";

export function MonicaChoices(
  { state, dispatch }: {
    readonly state: NewImportState;
    readonly dispatch: Dispatch<NewImportAction>;
  },
) {
  const report = state.report?.monicaChoices;
  if (!report) return null;
  const currencies = report.currencies.map((code) => (
    <option key={code} value={code}>{code}</option>
  ));
  return (
    <fieldset
      className="import-review"
      disabled={state.committing || Boolean(state.committed)}
    >
      <legend>Complete your Monica import choices</legend>
      <p className="import-hint">
        Every choice is required before importing. On reimport, previously
        reviewed values and records changed by a member are preserved.
      </p>
      <div className="import-field">
        <label htmlFor="import-timezone">Your timezone</label>
        <p className="import-hint" id="import-timezone-help">
          This saves your personal member setting and schedules imported
          reminders in this timezone, including future reminders. Other members
          keep their settings.
        </p>
        <input
          id="import-timezone"
          aria-describedby="import-timezone-help"
          placeholder="Europe/Paris or UTC"
          value={state.timezone}
          onChange={(e) =>
            dispatch({ type: "timezone", value: e.currentTarget.value })}
        />
      </div>
      {report.debts.length > 0
        ? (
          <fieldset className="import-review-group">
            <legend>Debt currencies</legend>
            <p className="import-hint">
              Choose a currency for each existing debt amount. The amount
              preview uses the selected currency’s decimal precision.
            </p>
            <div className="import-field">
              <label htmlFor="import-bulk-currency">
                Currency for all debts
              </label>
              <div className="import-inline-control">
                <select
                  id="import-bulk-currency"
                  value={state.bulkCurrency}
                  onChange={(e) =>
                    dispatch({
                      type: "bulk-currency",
                      value: e.currentTarget.value,
                    })}
                >
                  <option value="">Choose a currency</option>
                  {currencies}
                </select>
                <button
                  className={buttonVariants({ variant: "outline" })}
                  type="button"
                  disabled={!state.bulkCurrency}
                  onClick={() => dispatch({ type: "apply-currency" })}
                >
                  Apply currency to all debts
                </button>
              </div>
              <p className="import-hint">
                You can change individual currencies after applying to all.
              </p>
            </div>
            {report.debts.map((debt, index) => (
              <div className="import-choice" key={debt.sourceKey}>
                <div>
                  <label htmlFor={`debt-currency-${debt.sourceKey}`}>
                    {debt.contactName} — debt {index + 1}
                  </label>
                  <p className="import-hint">
                    {debt.direction === "i_owe" ? "You owe" : "They owe"}:{" "}
                    <output>
                      {debtAmountPreview(
                        debt.rawAmount,
                        debt.minorUnits,
                        state.currencyChoices[debt.sourceKey] ?? "",
                        report
                          .currencyMinorUnits[
                            state.currencyChoices[debt.sourceKey] ?? ""
                          ] ?? 2,
                      )} {state.currencyChoices[debt.sourceKey] ?? ""}
                    </output>
                    {debt.reason ? ` · ${debt.reason}` : ""}
                  </p>
                </div>
                <select
                  id={`debt-currency-${debt.sourceKey}`}
                  value={state.currencyChoices[debt.sourceKey] ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "currency-choice",
                      key: debt.sourceKey,
                      value: e.currentTarget.value,
                    })}
                >
                  <option value="">Choose a currency</option>
                  {currencies}
                </select>
              </div>
            ))}
          </fieldset>
        )
        : null}
      {report.contacts.length > 0
        ? (
          <fieldset className="import-review-group">
            <legend>Contact genders</legend>
            <p className="import-hint">
              The source gender reference is missing. Choose for each contact;
              Unspecified is an explicit choice.
            </p>
            {report.contacts.map((contact) => (
              <div className="import-choice" key={contact.sourceKey}>
                <label htmlFor={`contact-gender-${contact.sourceKey}`}>
                  {contact.contactName} — gender
                </label>
                <select
                  id={`contact-gender-${contact.sourceKey}`}
                  value={state.genderChoices[contact.sourceKey] ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "gender-choice",
                      key: contact.sourceKey,
                      value: e.currentTarget.value,
                    })}
                >
                  <option value="">Choose a gender</option>
                  {report.genders.map((g) => (
                    <option
                      key={`${g.source}:${g.id}`}
                      value={`${g.source ? "source" : "map"}:${g.id}`}
                    >
                      {g.name}
                      {g.source ? " (from this import)" : ""}
                    </option>
                  ))}
                  <option value="unspecified">Unspecified</option>
                  <option value="create">Create a gender option</option>
                </select>
                {state.genderChoices[contact.sourceKey] === "create"
                  ? (
                    <div className="import-field import-choice-detail">
                      <label htmlFor={`gender-name-${contact.sourceKey}`}>
                        New gender option for {contact.contactName}
                      </label>
                      <input
                        id={`gender-name-${contact.sourceKey}`}
                        maxLength={100}
                        value={state.genderNames[contact.sourceKey] ?? ""}
                        onChange={(e) =>
                          dispatch({
                            type: "gender-name",
                            key: contact.sourceKey,
                            value: e.currentTarget.value,
                          })}
                      />
                    </div>
                  )
                  : null}
              </div>
            ))}
          </fieldset>
        )
        : null}
    </fieldset>
  );
}
