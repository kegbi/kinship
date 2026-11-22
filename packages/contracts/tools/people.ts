/**
 * People tools: the directory, a person's identity and lifecycle, stars,
 * bulk changes, duplicates, merging, and deletion.
 *
 * A person's id comes from `list_people`. Identity edits, archiving, and
 * restoring are decided against the person's revision, which the identity
 * read does not carry: it is the `personUpdatedAt` every profile-fact read
 * and write answers, or the `updatedAt` of the last lifecycle answer.
 */

import { peopleBulkInput } from "../schemas/people.ts";
import {
  archivePerson,
  bulkPeople,
  createPerson,
  deletePerson,
  dismissPeopleDuplicate,
  editPerson,
  getPersonDeletionImpact,
  getPersonIdentity,
  listPeople,
  listPeopleDuplicates,
  listPeopleTagFacet,
  listPeopleTagOptions,
  mergePeople,
  previewPeopleMerge,
  restorePerson,
  starPerson,
  unstarPerson,
} from "../routes/people.ts";
import { type AgentTool, defineTool } from "./define.ts";

/** Where a person's revision comes from, for every tool that checks it. */
export const PERSON_REVISION =
  "expectedUpdatedAt is the person's current revision: personUpdatedAt from list_profile_facts (any section) or the last profile-fact write, or person.updatedAt from the last update_person, archive_person, or restore_person answer. A stale revision is refused as a conflict; read it again.";

const BULK =
  "Names 1 to 100 distinct people (personIds from list_people). Each person is changed on their own and answered in request order as done, unchanged, skipped, or failed with a code, so one refusal does not undo the others; only a malformed request or lost access refuses them all. No revision is needed.";

export const PEOPLE_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_people",
    title: "List people",
    description:
      "Searches and pages through the people in the token's workspace and returns each one's id, names, star, lifecycle, and up to five tags. Call it first to find a person's id: search matches names; tag filters by a tag id from list_tags; starred and starredFirst use the workspace star; archived people need lifecycle \"archived\". Returns at most limit people (default 20, at most 50) and a nextCursor to pass back with the same filters for the next page. It reads the directory only, not profiles.",
    route: listPeople,
  }),
  defineTool({
    name: "list_tags",
    title: "List tags",
    description:
      "Lists the workspace's tags with their ids, twenty at a time: search filters by name, nextCursor pages, and selected resolves one tag id you already hold. Use a tag id to filter list_people, with add_tag_to_people, or in update_person_tags. New tags are made with create_tag.",
    route: listPeopleTagOptions,
  }),
  defineTool({
    name: "list_tag_counts",
    title: "Count people per tag",
    description:
      'Counts how many active people carry each tag (archived people with lifecycle "archived"), most carried first, at most thirty tags with their ids and names; truncated says more tags are in use.',
    route: listPeopleTagFacet,
  }),
  defineTool({
    name: "get_person",
    title: "Get a person's name",
    description:
      "Reads one person's id and names (given, middle, family, nickname, and whether the record is partial) and whether they are archived. It returns no profile, notes, or timeline: use list_profile_facts, list_important_dates, list_relationships, and the other area tools for those. Use it to confirm which person an id names before writing about them.",
    route: getPersonIdentity,
  }),
  defineTool({
    name: "create_person",
    title: "Create a person",
    description:
      "Creates a person from their names and returns the new person's id. isPartial marks an incomplete record; send false for an ordinary person. A person whose name matches someone already in the workspace is refused as a possible duplicate (409): check list_people first, and resend with duplicateOverride true only when it really is someone else. There is no retry key, so repeating a successful call creates a second person.",
    route: createPerson,
  }),
  defineTool({
    name: "update_person",
    title: "Update a person",
    description:
      `Replaces a person's names, and optionally their description, gender, and deceased flag. The names are replaced whole, so send every name to keep; description, genderOptionId (from list_vocabulary_entries, section gender-options), and isDeceased are kept when left out, and an empty string clears the description or the gender. ${PERSON_REVISION} An archived person cannot be edited until restore_person.`,
    route: editPerson,
  }),
  defineTool({
    name: "archive_person",
    title: "Archive a person",
    description:
      `Archives a person: they leave the active directory and their profile becomes read-only until restore_person. Nothing is deleted. ${PERSON_REVISION}`,
    route: archivePerson,
  }),
  defineTool({
    name: "restore_person",
    title: "Restore an archived person",
    description:
      `Returns an archived person to the active directory and makes their profile writable again. ${PERSON_REVISION}`,
    route: restorePerson,
  }),
  defineTool({
    name: "add_person_star",
    title: "Star a person",
    description:
      "Stars a person for the whole workspace, not only for this member, so list_people can filter on starred or put starred people first. Safe to repeat: starring a starred person changes nothing. An archived person's star cannot change.",
    route: starPerson,
  }),
  defineTool({
    name: "remove_person_star",
    title: "Unstar a person",
    description:
      "Removes a person's workspace star. Safe to repeat: an unstarred person is unchanged. An archived person's star cannot change.",
    route: unstarPerson,
    annotations: { destructiveHint: false },
  }),
  defineTool({
    name: "archive_people",
    title: "Archive several people",
    description:
      `Archives several people at once, as archive_person does for one; restore them with restore_people. ${BULK}`,
    route: bulkPeople,
    body: peopleBulkInput,
    fixed: { action: "archive" },
    omit: ["tagId"],
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "restore_people",
    title: "Restore several people",
    description:
      `Restores several archived people at once, as restore_person does for one. ${BULK}`,
    route: bulkPeople,
    body: peopleBulkInput,
    fixed: { action: "restore" },
    omit: ["tagId"],
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "add_tag_to_people",
    title: "Tag several people",
    description:
      `Adds one tag (tagId, required, from list_tags) to several people, keeping their other tags. ${BULK} A tag outside the workspace refuses the whole request.`,
    route: bulkPeople,
    body: peopleBulkInput,
    fixed: { action: "tag" },
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "remove_tag_from_people",
    title: "Untag several people",
    description:
      `Removes one tag (tagId, required, from list_tags) from several people, keeping their other tags; the tag itself stays in the workspace. ${BULK}`,
    route: bulkPeople,
    body: peopleBulkInput,
    fixed: { action: "untag" },
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "get_person_deletion_impact",
    title: "Preview deleting a person",
    description:
      "Reads what deleting a person means and the exact confirmation phrase delete_person must repeat, with the person's identity and current updatedAt. Call it immediately before delete_person, and when acting for a user, show them the phrase and get their agreement first.",
    route: getPersonDeletionImpact,
  }),
  defineTool({
    name: "delete_person",
    title: "Delete a person",
    description:
      "Deletes a person from the workspace. Send confirmation exactly as get_person_deletion_impact returned it and expectedUpdatedAt as that read's person.updatedAt; a changed phrase or revision is refused. It is a soft delete that no tool can undo: the person leaves every list and restore_person cannot bring them back, while the records that mention them are retained. Prefer archive_person to keep someone out of the way.",
    route: deletePerson,
  }),
  defineTool({
    name: "list_duplicate_people",
    title: "List possible duplicates",
    description:
      "Lists up to twenty pairs of active people who look like the same person — the same full name, email address, or phone number — with both people's ids, names, and updatedAt and the reasons; truncated says there are more. Follow with get_merge_preview for a pair to merge, or set_not_duplicates for a pair that is two people.",
    route: listPeopleDuplicates,
  }),
  defineTool({
    name: "set_not_duplicates",
    title: "Dismiss a possible duplicate",
    description:
      "Marks two people (personIds, in any order) as not the same person for the whole workspace, so list_duplicate_people stops offering the pair to every member. Safe to repeat.",
    route: dismissPeopleDuplicate,
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "get_merge_preview",
    title: "Preview a merge",
    description:
      "Previews merging duplicateId into primaryId, the person who is kept: the single-valued facts that conflict and which value is kept or discarded, how many records move, both people's current identities and updatedAt, and the conflictsDigest. merge_people must quote that digest and both revisions.",
    route: previewPeopleMerge,
  }),
  defineTool({
    name: "merge_people",
    title: "Merge two people",
    description:
      "Merges duplicateId into primaryId: every record of the duplicate moves to the primary, the values the preview listed as discarded are lost, and the duplicate is deleted. A merge has no undo. Send confirmed true, conflictsDigest from get_merge_preview, primaryRevision and duplicateRevision as that preview's primary.updatedAt and duplicate.updatedAt; if either person changed since, it is refused, so preview again. When acting for a user, confirm with them first.",
    route: mergePeople,
    annotations: { destructiveHint: true },
  }),
];
