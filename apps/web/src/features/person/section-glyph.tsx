/**
 * A person-section glyph drawn by an island, identical to the one
 * `components/SectionIcon.astro` draws in the static shell, so a section
 * looks the same before and after it hydrates. The heading beside it names
 * the section; the glyph is decorative.
 */

import {
  SECTION_ICON_PATHS,
  type SectionIconName,
} from "../../lib/section-icons.ts";

export function SectionGlyph(
  props: { readonly className: string; readonly name: SectionIconName },
) {
  return (
    <span
      aria-hidden="true"
      className={`section-icon ${props.className}`}
      data-section-icon={props.name}
    >
      <svg
        dangerouslySetInnerHTML={{ __html: SECTION_ICON_PATHS[props.name] }}
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
        viewBox="0 0 24 24"
      />
    </span>
  );
}
