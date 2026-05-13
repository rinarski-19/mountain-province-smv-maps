"use client";

export default function Sidebar({
  activeClassId,
  activeBarangaySlug,
  onSelectClass,
  onSelectBarangay,
  commercialRows = [],
  residentialRows = [],
  getBarangayBySlug = () => null,
  getUniqueBarangaysForClass = () => [],
}) {
  return (
    <aside className="smv-sidebar" aria-label="SMV schedule">
      <SidebarTable
        title="Commercial Lands"
        rows={commercialRows}
        activeClassId={activeClassId}
        activeBarangaySlug={activeBarangaySlug}
        onSelectClass={onSelectClass}
        onSelectBarangay={onSelectBarangay}
        getBarangayBySlug={getBarangayBySlug}
        getUniqueBarangaysForClass={getUniqueBarangaysForClass}
      />
      <SidebarTable
        title="Residential Lands"
        rows={residentialRows}
        activeClassId={activeClassId}
        activeBarangaySlug={activeBarangaySlug}
        onSelectClass={onSelectClass}
        onSelectBarangay={onSelectBarangay}
        getBarangayBySlug={getBarangayBySlug}
        getUniqueBarangaysForClass={getUniqueBarangaysForClass}
        scroll
      />
    </aside>
  );
}

function SidebarTable({
  title,
  rows,
  activeClassId,
  activeBarangaySlug,
  onSelectClass,
  onSelectBarangay,
  scroll = false,
  getBarangayBySlug,
  getUniqueBarangaysForClass,
}) {
  return (
    <div className={`smv-section ${scroll ? "smv-section--scroll" : ""}`}>
      <header className="smv-section__head">
        <h3 className="smv-section__title">{title}</h3>
        <span className="smv-section__count">{rows.length} classes</span>
      </header>
      <ul
        className={`smv-section__list ${
          scroll ? "smv-section__list--scroll" : ""
        }`}
      >
        {rows.map((row) => {
          const isClassActive = activeClassId === row.id;
          // Accordion behavior: only the active class is expanded.
          const isExpanded = isClassActive;
          const allBarangays = getUniqueBarangaysForClass(row);
          const shortLabel = shortenLocationLabel(row.locationGroups[0].label);
          return (
            <li key={row.id} className="smv-row">
              <button
                type="button"
                className={`smv-row__head ${
                  isClassActive ? "is-active" : ""
                } ${isExpanded ? "is-expanded" : ""}`}
                onClick={() => {
                  // Selecting a class opens only this class and closes others.
                  onSelectClass(row.id);
                }}
                aria-expanded={isExpanded}
                aria-pressed={isClassActive}
              >
                <span className="smv-row__caret" aria-hidden="true">
                  <svg viewBox="0 0 12 12" width="10" height="10">
                    <path
                      d="M3 4 L6 8 L9 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span
                  className={`smv-row__chip ${
                    row.subClass === "C-1" ? "is-hatch" : ""
                  }`}
                  style={{ backgroundColor: row.color }}
                >
                  {row.subClass}
                </span>
                <span
                  className="smv-row__label"
                  title={row.locationGroups[0].label}
                >
                  {shortLabel}
                </span>
                <span className="smv-row__value tnum">
                  ₱{row.marketValue2027.toLocaleString()}
                </span>
              </button>
              {isExpanded && (
                <ul className="smv-row__brgys">
                  {allBarangays.map((slug) => {
                    const b = getBarangayBySlug(slug);
                    if (!b) return null;
                    const isBarangayActive =
                      isClassActive && activeBarangaySlug === slug;
                    return (
                      <li
                        key={`${row.id}-${slug}`}
                        className="smv-brgy-cell"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectBarangay(row.id, slug);
                          }}
                          aria-pressed={isBarangayActive}
                          className={`smv-brgy ${
                            isBarangayActive ? "is-active" : ""
                          }`}
                          title={`Show ${b.name} on the map`}
                        >
                          <span
                            className="smv-brgy__dot"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span className="smv-brgy__name">{b.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Trim long descriptive labels (which list every barangay in the class)
// down to just "Along [type] of:" — the actual barangays appear in the
// expanded children below, so listing them in the label too is
// redundant noise that wraps onto multiple lines for big classes.
//
//   "Along Provincial and National Roads of Abatan"
//     → "Along provincial and national roads of:"
//   "all-weather roads of Mount Data, Monamon Sur, ..."
//     → "Along all-weather roads of:"
//   "Inner lots of Mabaay, Sinto, ..."
//     → "Along inner lots of:"
function shortenLocationLabel(label) {
  if (!label) return "";
  const idx = label.search(/\s+of\s+/i);
  if (idx < 0) return label;
  let prefix = label.slice(0, idx).trim();
  // Strip a leading "Along " (case-insensitive) — we re-add it below in
  // a consistent casing so every row reads "Along [thing] of:".
  prefix = prefix.replace(/^Along\s+/i, "");
  return `Along ${prefix.toLowerCase()} of:`;
}
