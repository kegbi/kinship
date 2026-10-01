/**
 * A currency preference as a choice among the supported ISO 4217 codes,
 * shared by the member's preferences and the workspace's defaults.
 *
 * The empty option clears the preference, which is how a member falls back
 * to the workspace default and a workspace falls back to US dollars. A saved
 * code the catalog no longer offers stays listed, so loading the form never
 * changes what was saved behind the member's back.
 */

/** The options of a currency `<select>`, the empty choice first. */
export function CurrencyOptions(
  props: {
    readonly choices: readonly string[];
    /** The label of the option that leaves the preference unset. */
    readonly empty: string;
    /** The saved code, which stays offered even once it is unsupported. */
    readonly value: string | undefined;
  },
) {
  const choices = props.value && !props.choices.includes(props.value)
    ? [...props.choices, props.value].sort()
    : props.choices;
  return (
    <>
      <option value="">{props.empty}</option>
      {choices.map((code) => <option key={code} value={code}>{code}</option>)}
    </>
  );
}
