"use client";

// Print-only legend overlay. Renders down the right side of the page
// when the body has class `is-printing`. Hidden on screen.
//
// Shape:
//   - LGU title block at top with province, effective date.
//   - Class swatches with codes + 2027 prices.
//   - PAO attribution footer.
//
// All values come from the same schedule the live map uses, so the
// printed legend stays in sync automatically when the schedule is
// updated.

import { useMemo } from "react";

export default function PrintLegend({
  municipalityName = "",
  provinceName = "Mountain Province",
  classifications = [],
  effectiveLabel = "SMV 2027 (effective Jan 1, 2027)",
  showCount = null,
}) {
  // Deduplicate by subClass — the schedule may list the same class
  // under multiple location groups; in the legend each class shows
  // once with its 2027 price and a short coverage hint.
  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of classifications) {
      if (!c?.subClass || seen.has(c.subClass)) continue;
      seen.add(c.subClass);
      out.push(c);
    }
    return out;
  }, [classifications]);

  return (
    <aside
      className="print-legend"
      aria-hidden="true"
      style={{
        // The CSS controls visibility per @media; inline styles
        // describe the layout itself so the component is portable.
        display: "none",
      }}
    >
      <header className="print-legend__header">
        <div className="print-legend__title">
          {municipalityName.toUpperCase()}
        </div>
        <div className="print-legend__subtitle">{provinceName}</div>
        <div className="print-legend__effective">{effectiveLabel}</div>
      </header>

      <div className="print-legend__section-label">Schedule of market values</div>
      <table className="print-legend__table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.subClass}>
              <td>
                <span
                  className="print-legend__swatch"
                  style={{ background: row.color || "#999" }}
                />
              </td>
              <td className="print-legend__code">{row.subClass}</td>
              <td className="print-legend__price">
                {row.marketValue2027 == null
                  ? "Pending"
                  : `₱${row.marketValue2027.toLocaleString()}/sqm`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="print-legend__footer">
        <div>Provincial Assessor's Office, {provinceName}</div>
        <div className="print-legend__caveat">
          Reference map. Not a substitute for an on-site assessment.
        </div>
        {showCount != null && (
          <div className="print-legend__count">
            {showCount} classified zone{showCount === 1 ? "" : "s"}
          </div>
        )}
      </footer>
    </aside>
  );
}
