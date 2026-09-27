/**
 * One audit event as the history pages and the person audit summary list
 * it: the action, its context, its non-sensitive details, when it happened
 * in the member's time presentation, and a Redacted badge when the server
 * withheld values.
 */

import type { AuditEvent } from "../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants } from "@/components/ui/variants.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../lib/time-presentation.ts";
import { eventContext, eventDetails, formatAction } from "./audit.ts";

export function AuditEventItem(
  props: {
    readonly event: AuditEvent;
    readonly preferences: TimePreferences | undefined;
  },
) {
  const { event } = props;
  return (
    <li className="audit-event">
      <strong>{formatAction(event.action)}</strong>
      <p>{eventContext(event)}</p>
      <p>{eventDetails(event)}</p>
      <time dateTime={event.occurredAt}>
        {formatInstant(event.occurredAt, props.preferences)}
      </time>
      {event.redacted
        ? (
          <span className={badgeVariants({ className: "justify-self-start" })}>
            Redacted
          </span>
        )
        : null}
    </li>
  );
}
