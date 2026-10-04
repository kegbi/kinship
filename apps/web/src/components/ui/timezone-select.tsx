import { Autocomplete } from "@base-ui/react/autocomplete";
import { useRef, useState } from "react";

const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

/** Searchable IANA suggestions, with a real named input for settings validation. */
export function TimezoneSelect(props: {
  readonly id?: string;
  readonly name?: string;
  readonly defaultValue?: string;
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
  readonly disabled?: boolean;
  readonly "aria-describedby"?: string;
}) {
  const [local, setLocal] = useState(props.defaultValue ?? "");
  const input = useRef<HTMLInputElement>(null);
  const value = props.value ?? local;
  return (
    <Autocomplete.Root
      items={timezones}
      value={value}
      openOnInputClick
      disabled={props.disabled}
      onValueChange={(next, details) => {
        setLocal(next);
        props.onValueChange?.(next);
        if (details.reason === "item-press") {
          // Picking a suggestion also reaches the owning form's dirty/validity
          // handlers after Base UI has placed the text in the named input.
          queueMicrotask(() =>
            input.current?.dispatchEvent(new Event("input", { bubbles: true }))
          );
        }
      }}
    >
      <Autocomplete.Input
        id={props.id}
        name={props.name}
        ref={input}
        aria-describedby={props["aria-describedby"]}
        maxLength={100}
        placeholder="Search time zones…"
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} className="z-50">
          <Autocomplete.Popup className="w-(--anchor-width) overflow-hidden rounded-(--radius-sm) border border-solid border-(--line-1) bg-popover text-popover-foreground shadow-(--shadow-2)">
            <Autocomplete.Empty className="p-3 text-sm">
              No matching time zones.
            </Autocomplete.Empty>
            <Autocomplete.List className="max-h-64 overflow-y-auto p-1">
              {(timezone: string) => (
                <Autocomplete.Item
                  key={timezone}
                  value={timezone}
                  className="flex min-h-11 cursor-pointer items-center rounded-(--radius-sm) px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {timezone}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
