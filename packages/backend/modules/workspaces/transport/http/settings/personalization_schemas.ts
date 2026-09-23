/**
 * The body each personalization section accepts.
 *
 * Nine sections with four shapes between them — a named option, a name on its
 * own, a relationship's two labels, and a reminder's lead time — chosen by
 * section rather than by route, so a new section is an entry here rather than
 * four more routes. Two sections accept nothing at all: their options are
 * seeded and may only be enabled or disabled.
 *
 * GAP-022 moved the shapes themselves to
 * `packages/contracts/schemas/settings.ts`, where the published document
 * names each of them and records, section by section, which one it is; what
 * is left here is the choice the route makes on the way in. The rule that
 * every update must change something travels with the shapes.
 */

import { z } from "zod";
import type { PersonalizationSection } from "../../../public.ts";
import {
  personalizationGenderUpdate,
  personalizationNamedCreate,
  personalizationNamedUpdate,
  personalizationNameOnlyCreate,
  personalizationNameOnlyUpdate,
  personalizationRelationshipCreate,
  personalizationRelationshipUpdate,
  personalizationReminderCreate,
  personalizationReminderUpdate,
} from "../../../../../../contracts/schemas/settings.ts";

export const personalizationCreateSchema = (
  section: PersonalizationSection,
) => {
  if (section === "relationship-types") {
    return personalizationRelationshipCreate;
  }
  if (section === "reminder-rules") return personalizationReminderCreate;
  if (section === "contact-labels" || section === "tags") {
    return personalizationNameOnlyCreate;
  }
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return personalizationNamedCreate;
};
export const personalizationUpdateSchema = (
  section: PersonalizationSection,
) => {
  if (section === "gender-options") return personalizationGenderUpdate;
  if (section === "contact-labels" || section === "tags") {
    return personalizationNameOnlyUpdate;
  }
  if (section === "relationship-types") {
    return personalizationRelationshipUpdate;
  }
  if (section === "reminder-rules") return personalizationReminderUpdate;
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return personalizationNamedUpdate;
};
