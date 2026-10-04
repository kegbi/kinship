// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderIsland } from "../../testing/render.tsx";
import { TimezoneSelect } from "./timezone-select.tsx";

it("retains typed aliases and invalid values after closing suggestions with Tab", async () => {
  const user = userEvent.setup();
  renderIsland(
    <form>
      <label htmlFor="zone">Time zone</label>
      <TimezoneSelect id="zone" name="zone" defaultValue="UTC" />
      <button type="button">Save</button>
    </form>,
  );
  const input = screen.getByRole<HTMLInputElement>("combobox", {
    name: "Time zone",
  });
  for (const value of ["US/Eastern", "Not/AZone", ""]) {
    await user.click(input);
    await user.clear(input);
    if (value) await user.type(input, value);
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(input.value).toBe(value);
    expect(new FormData(input.form!).getAll("zone")).toEqual([value]);
  }
});

it("supports keyboard search, empty results, clearing, and existing IANA aliases", async () => {
  renderIsland(
    <>
      <label htmlFor="zone">Time zone</label>
      <TimezoneSelect id="zone" name="zone" defaultValue="US/Eastern" />
    </>,
  );
  const input = screen.getByRole<HTMLInputElement>("combobox", {
    name: "Time zone",
  });
  expect(input.value).toBe("US/Eastern");
  act(() => input.focus());
  fireEvent.input(input, {
    target: { value: "Unknown/Zone" },
    inputType: "insertText",
  });
  expect(await screen.findByText("No matching time zones.")).toBeDefined();
  fireEvent.input(input, {
    target: { value: "Moscow" },
    inputType: "insertText",
  });
  const option = await screen.findByRole("option", { name: "Europe/Moscow" });
  // The browser flow verifies geometry; this guards the 44px touch target recipe.
  expect(option.classList.contains("min-h-11")).toBe(true);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input.value).toBe("Europe/Moscow"));
  fireEvent.input(input, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(input.value).toBe("");
});

it("disables the searchable input while its owning form is busy", () => {
  renderIsland(
    <>
      <label htmlFor="zone">Time zone</label>
      <TimezoneSelect id="zone" disabled defaultValue="UTC" />
    </>,
  );
  const input = screen.getByRole<HTMLInputElement>("combobox", {
    name: "Time zone",
  });
  expect(input.disabled).toBe(true);
  expect(input.value).toBe("UTC");
});
