/**
 * One recorded activity or note as the read-only projections list it
 * (GAP-033): Today's favorite notes and recent activity, and a person's
 * activity report. The person's own notes and activities render through the
 * timeline instead.
 */

import { Fragment } from "react";
import type { ActivityOrNoteInteraction } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../lib/time-presentation.ts";

/** The line under an entry's heading: who, what kind, how it felt, details. */
export function interactionDetail(entry: ActivityOrNoteInteraction) {
  if (entry.kind === "activity") {
    const details = [
      entry.activityType ? `Category: ${entry.activityType}` : "",
      entry.emotions?.length > 0
        ? `Emotions: ${
          entry.emotions.map((emotion) => emotion.name).join(", ")
        }`
        : "",
      entry.description,
    ].filter(Boolean).join(" · ");
    return (
      <>
        {entry.participants.map((participant, index) => (
          <Fragment key={participant.id}>
            {index > 0 && ", "}
            <a href={`/app/people/${participant.id}`}>{participant.name}</a>
          </Fragment>
        ))}
        {entry.participants.length > 0 && details && " · "}
        {details}
      </>
    );
  }
  const person = entry.participants?.[0] ?? entry.person;
  return (
    <>
      {person
        ? <a href={`/app/people/${person.id}`}>{person.name}</a>
        : "Person"} · {entry.body}
    </>
  );
}

export function InteractionEntry(
  props: {
    readonly entry: ActivityOrNoteInteraction;
    readonly preferences: TimePreferences | undefined;
  },
) {
  const { entry } = props;
  const value = entry.kind === "activity" ? entry.happenedAt : entry.createdAt;
  return (
    <li className="interaction-item">
      <strong>{entry.kind === "activity" ? entry.summary : "Note"}</strong>
      <p>{interactionDetail(entry)}</p>
      <time dateTime={value}>
        {value ? formatInstant(value, props.preferences) : "Recently"}
      </time>
    </li>
  );
}
