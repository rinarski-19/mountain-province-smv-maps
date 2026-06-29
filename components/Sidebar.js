"use client";

import { textColorForBackground } from "@/lib/classifications";

// Road-tier legend entries. Colors match the print SVG palette in
// lib/print-svg-builder.js (yellow national → orange provincial →
// white barangay → gray "other"), so the sidebar reads the same way
// the printed plate does. Reference-only — clicking these doesn't
// filter the map (yet); they exist to tell the user which corridor
// color means which DPWH tier.
const ROAD_TIERS = [
  {
    id: "road-national",
    label: "National",
    sub: "Trunk + Primary",
    color: "#fcd34d",
    casing: "#a16207",
  },
  {
    id: "road-provincial",
    label: "Provincial",
    sub: "Secondary",
    color: "#fb923c",
    casing: "#9a3412",
  },
  {
    id: "road-barangay",
    label: "Barangay / Municipal",
    sub: "Unclassified + Residential",
    color: "#ffffff",
    casing: "#bababa",
  },
  {
    id: "road-other",
    label: "Other",
    sub: "Tertiary, Track",
    color: "#a8a39b",
    casing: "#737373",
  },
];

// Legend-card variant (2026-06-23): the sidebar is now a stripped-down
// reference card showing only the class chip and its 2027 unit value.
// The earlier accordion-with-barangay-sub-list version was useful for
// presentation/walkthrough mode, but for the editor a quick visual
// reference is more useful — when you're drawing, all you need is
// "what color is which class and how much per square meter".
//
// Each row is still a button so clicking it filters the map to that
// class (handled by onSelectClass higher up). The expand/collapse UI
// for barangays + stretches is gone — fall through to the map's
// search bar or the chip palette if you need to focus a specific
// barangay.
export default function Sidebar({
  activeClassId,
  onSelectClass,
  commercialRows = [],
  residentialRows = [],
  // Props kept in the signature so callers don't break — they're
  // no longer used in this slimmed-down view but might come back if
  // we add an "expand for detail" affordance later.
  activeBarangaySlug: _activeBarangaySlug,
  activeStretchIdx: _activeStretchIdx,
  onSelectBarangay: _onSelectBarangay,
  onSelectStretch: _onSelectStretch,
  getBarangayBySlug: _getBarangayBySlug,
  getUniqueBarangaysForClass: _getUniqueBarangaysForClass,
  savedStretchViews: _savedStretchViews,
}) {
  // When any class is active, clicking it again would clear the
  // filter — but that's not obvious. Surface an explicit "Show all"
  // button while a filter is active so the affordance is visible.
  const showAllVisible = activeClassId != null;
  return (
    <aside className="smv-sidebar smv-sidebar--legend" aria-label="SMV legend">
      <div className="smv-legend__toolbar" data-active={showAllVisible}>
        <button
          type="button"
          className="smv-legend__show-all"
          onClick={() => onSelectClass(null)}
          disabled={!showAllVisible}
          title={
            showAllVisible
              ? "Clear the class filter — show every SMV class on the map"
              : "All classes are already visible"
          }
        >
          {showAllVisible ? "Show all classes" : "All classes shown"}
        </button>
      </div>
      <LegendSection
        title="Commercial"
        rows={commercialRows}
        activeClassId={activeClassId}
        onSelectClass={onSelectClass}
      />
      <LegendSection
        title="Residential"
        rows={residentialRows}
        activeClassId={activeClassId}
        onSelectClass={onSelectClass}
        scroll
      />
      <RoadsLegend />
    </aside>
  );
}

// Static road-tier legend. Reference-only (no click handler) since
// the map shows roads via OSM raster tiles whose colors are baked in
// — clicking a road row wouldn't filter anything yet. Keeps the SMV
// legend and the road tier reference in one place so the user
// doesn't have to remember which corridor color means which DPWH
// classification.
function RoadsLegend() {
  return (
    <div className="smv-section smv-section--legend smv-section--roads">
      <header className="smv-section__head">
        <h3 className="smv-section__title">Roads</h3>
        <span className="smv-section__count">{ROAD_TIERS.length} tiers</span>
      </header>
      <ul className="smv-section__list smv-section__list--legend">
        {ROAD_TIERS.map((tier) => (
          <li key={tier.id} className="smv-row smv-row--legend smv-row--road">
            <div
              className="smv-row__head smv-row__head--legend smv-row__head--road"
              title={`${tier.label} road tier (${tier.sub})`}
            >
              <span
                className="smv-road__swatch"
                style={{
                  backgroundColor: tier.color,
                  borderColor: tier.casing,
                }}
                aria-hidden="true"
              />
              <span className="smv-road__labels">
                <span className="smv-road__name">{tier.label}</span>
                <span className="smv-road__sub">{tier.sub}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LegendSection({
  title,
  rows,
  activeClassId,
  onSelectClass,
  scroll = false,
}) {
  if (!rows.length) return null;
  return (
    <div
      className={`smv-section smv-section--legend ${
        scroll ? "smv-section--scroll" : ""
      }`}
    >
      <header className="smv-section__head">
        <h3 className="smv-section__title">{title}</h3>
        <span className="smv-section__count">{rows.length} classes</span>
      </header>
      <ul
        className={`smv-section__list smv-section__list--legend ${
          scroll ? "smv-section__list--scroll" : ""
        }`}
      >
        {rows.map((row) => {
          const isActive = activeClassId === row.id;
          const valueText =
            row.marketValue2027 == null
              ? row.provisional
                ? "Pending"
                : "—"
              : `₱${row.marketValue2027.toLocaleString()}`;
          return (
            <li key={row.id} className="smv-row smv-row--legend">
              <button
                type="button"
                className={`smv-row__head smv-row__head--legend ${
                  isActive ? "is-active" : ""
                }`}
                onClick={() => onSelectClass(row.id)}
                aria-pressed={isActive}
                title={
                  row.locationGroups?.[0]?.label
                    ? `${row.subClass} — ${valueText}\n${row.locationGroups[0].label}`
                    : `${row.subClass} — ${valueText}`
                }
              >
                <span
                  className="smv-row__chip"
                  style={{
                    backgroundColor: row.color,
                    color: textColorForBackground(row.color),
                  }}
                >
                  {row.subClass}
                </span>
                <span className="smv-row__value tnum">{valueText}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
