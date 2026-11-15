// Marks the Profile puts on other screens (decision 58): a tag on advice written before the
// Profile last changed, and the pre-trade check's banner when a buy breaks a rule.
import { useEffect, useRef } from "react";
import type { RuleBreak } from "./types";

const WarnIcon = () => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3 2 21h20z" />
    <path d="M12 10v5M12 18h.01" />
  </svg>
);

export function OutOfDate() {
  return (
    <span className="tag wait out-of-date">
      <WarnIcon /> Out of date · your Profile changed
    </span>
  );
}

// Keep is the default and takes focus; placing past the rule is set apart, in red, and logged.
export function RuleBreakBanner({
  breaks,
  sending,
  onKeep,
  onOverride,
}: {
  breaks: RuleBreak[];
  sending: boolean;
  onKeep: () => void;
  onOverride: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  const labels = breaks.map((b) => b.label).join(", ");
  return (
    <div className="alert rule-break" role="alert">
      <div className="rule-break-text">
        <strong>
          <WarnIcon /> {breaks.length > 1 ? `Breaks ${breaks.length} rules` : "Breaks a rule"}:{" "}
          {labels}
        </strong>
        {breaks.map((b) => (
          <p key={`${b.rule}-${b.message}`}>{b.message}</p>
        ))}
      </div>
      <div className="rule-break-btns">
        <button ref={keep} className="btn btn-small" type="button" onClick={onKeep}>
          Keep to my rules
        </button>
        <button
          className="btn btn-small btn-danger"
          type="button"
          disabled={sending}
          onClick={onOverride}
        >
          {sending ? "Sending" : "Place anyway (logged)"}
        </button>
      </div>
    </div>
  );
}
