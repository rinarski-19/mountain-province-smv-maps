"use client";

import { textColorForBackground } from "@/lib/classifications";

const DISCLAIMER =
  "For public consultation only. This map is illustrative, not survey-accurate. Boundaries shown are indicative and must not be used for legal, survey, or assessment purposes.";

export default function BottomBar({
  active,
  activeGroup,
  activeBarangaySlug,
  total,
  onPrev,
  onNext,
  onClear,
  barangays = [],
  getBarangayBySlug = () => null,
}) {
  const barangay = activeBarangaySlug ? getBarangayBySlug(activeBarangaySlug) : null;
  const idle = !active || !activeGroup;
  const digitizedCount = barangays.filter((b) => b.digitized).length;

  return (
    <footer className="smv-bottom" aria-label="SMV walkthrough">
      <p className="smv-bottom__disclaimer" role="note">
        {DISCLAIMER}
      </p>
      <div className="smv-bottom__row">
        <NavButton onClick={onPrev} arrow="◀" label="Previous" />
        <div className="smv-bottom__body">
          {idle ? (
            <div className="smv-bottom__idle">
              <kbd>←</kbd>
              <kbd>→</kbd>
              <span>
                to step through {total} SMV classes · {digitizedCount} of{" "}
                {barangays.length} barangays digitized
              </span>
            </div>
          ) : (
            <ActiveSummary
              active={active}
              activeGroup={activeGroup}
              activeBarangay={barangay}
              onClear={onClear}
            />
          )}
        </div>
        <NavButton onClick={onNext} arrow="▶" label="Next" />
      </div>
    </footer>
  );
}

function NavButton({ onClick, arrow, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="smv-bottom__nav"
      aria-label={label}
      title={label}
    >
      <span className="smv-bottom__arrow">{arrow}</span>
    </button>
  );
}

function ActiveSummary({ active, activeGroup, onClear }) {
  return (
    <div className="smv-summary">
      <span
        className="smv-summary__chip"
        style={{
          backgroundColor: active.color,
          color: textColorForBackground(active.color),
        }}
      >
        {active.subClass}
      </span>
      <div className="smv-summary__copy">
        <div className="smv-summary__headline">
          <span>
            {active.category === "commercial"
              ? "Commercial Land"
              : "Residential Land"}
          </span>
          <span className="smv-summary__price tnum">
            ₱{active.marketValue2027.toLocaleString()}
            <span className="smv-summary__per">/ m²</span>
          </span>
        </div>
        <p className="smv-summary__group">{activeGroup.label}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="smv-summary__clear"
        title="Clear (Esc)"
      >
        Clear
      </button>
    </div>
  );
}
