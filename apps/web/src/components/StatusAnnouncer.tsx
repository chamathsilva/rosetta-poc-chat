/**
 * Live regions — apps/web/src/components/StatusAnnouncer.tsx. SPECS §9.6
 * (FR-001, AC-018, AC-022). Two always-mounted regions, visually hidden with
 * the clip/offset `.sr-only` class (never display:none or `hidden`, which
 * would remove them from the accessibility tree). Progress goes to the polite
 * status region, failures and errors to the alert region. Streamed delta text
 * never reaches either: the reducer only announces the fixed §9.6 strings.
 */
import { useChat } from "../state/ChatProvider";

export function StatusAnnouncer() {
  const { announcement } = useChat().state;
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement.politeness === "polite" ? announcement.text : ""}
      </div>
      <div className="sr-only" role="alert">
        {announcement.politeness === "assertive" ? announcement.text : ""}
      </div>
    </>
  );
}
