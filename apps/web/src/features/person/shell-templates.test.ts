import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAIL_DIALOG_TEMPLATE_ID as sheet } from "./rail-editor-presentation.ts";
import {
  RAIL_DIALOG_TEMPLATE_ID,
  SECTION_NOTICE_LINK_TEMPLATE_ID,
} from "./shell-templates.ts";
import { SECTION_NOTICE_LINK_TEMPLATE_ID as notice } from "./workspace.ts";

const shell = readFileSync(
  "apps/web/src/pages/internal/person-profile-shell.astro",
  "utf8",
);

describe("GAP-033 person shell templates", () => {
  it("names each template once, for the shell and the code that clones it", () => {
    expect(sheet).toBe(RAIL_DIALOG_TEMPLATE_ID);
    expect(notice).toBe(SECTION_NOTICE_LINK_TEMPLATE_ID);
    expect(shell).toContain("<template id={RAIL_DIALOG_TEMPLATE_ID}>");
    expect(shell).toContain("<template id={SECTION_NOTICE_LINK_TEMPLATE_ID}>");
  });

  it("keeps the shell's frontmatter off the modules that run the page", () => {
    const frontmatter = shell.split("---")[1]!;
    expect(frontmatter).toContain(
      'from "../../features/person/shell-templates.ts"',
    );
    expect(frontmatter).not.toMatch(/from "[^"]*\/workspace\.ts"/);
    expect(frontmatter).not.toMatch(
      /from "[^"]*\/rail-editor-presentation\.ts"/,
    );
  });
});
