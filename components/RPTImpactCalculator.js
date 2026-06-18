"use client";

import { useEffect, useMemo, useState } from "react";

const CURRENT_UNIT_VALUE_DEFAULTS = {
  bauko: {
    "C-1": 162.9,
    "R-1": 125.8,
    "R-2": 99.25,
  },
};

const DEFAULT_ASSESSMENT_LEVEL = {
  commercial: 35,
  residential: 20,
};

const DEFAULT_TAX_RATE = 2;
const DEFAULT_CAP_RATE = 6;

function currency(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUnitValue(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    maximumFractionDigits: 2,
  })}`;
}

function categoryLabel(value) {
  return value === "commercial" ? "Commercial" : "Residential";
}

function numberOrZero(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function computeRPT(area, unitValue, assessmentLevel, taxRate) {
  return (
    numberOrZero(area) *
    numberOrZero(unitValue) *
    (numberOrZero(assessmentLevel) / 100) *
    (numberOrZero(taxRate) / 100)
  );
}

function buildProjection(currentRPT, proposedRPT, capRate, years) {
  const projection = [];
  let capped = currentRPT > 0 ? currentRPT : proposedRPT;
  for (let year = 0; year <= years; year++) {
    if (year === 0) {
      projection.push({
        label: currentRPT > 0 ? "Current" : "Estimated",
        value: currentRPT > 0 ? currentRPT : proposedRPT,
      });
      continue;
    }
    capped =
      currentRPT > 0
        ? Math.min(capped * (1 + capRate / 100), proposedRPT)
        : proposedRPT;
    projection.push({ label: `Year ${year}`, value: capped });
  }
  return projection;
}

export default function RPTImpactCalculator({
  open,
  onClose,
  municipality,
  classifications = [],
  activeClass,
}) {
  const [selectedId, setSelectedId] = useState(
    activeClass?.id ?? classifications[0]?.id ?? ""
  );
  const [area, setArea] = useState(100);
  const [currentUnitValue, setCurrentUnitValue] = useState(0);
  const [assessmentLevel, setAssessmentLevel] = useState(20);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE);
  const [capRate, setCapRate] = useState(DEFAULT_CAP_RATE);
  const [projectionYears, setProjectionYears] = useState(10);

  const selectedClass = useMemo(
    () =>
      classifications.find((item) => item.id === selectedId) ??
      activeClass ??
      classifications[0] ??
      null,
    [activeClass, classifications, selectedId]
  );

  useEffect(() => {
    if (activeClass?.id) setSelectedId(activeClass.id);
  }, [activeClass?.id]);

  useEffect(() => {
    if (!selectedClass) return;
    const defaultCurrent =
      CURRENT_UNIT_VALUE_DEFAULTS[municipality?.slug]?.[selectedClass.subClass] ?? 0;
    setCurrentUnitValue(defaultCurrent);
    setAssessmentLevel(
      DEFAULT_ASSESSMENT_LEVEL[selectedClass.category] ??
        DEFAULT_ASSESSMENT_LEVEL.residential
    );
  }, [municipality?.slug, selectedClass?.id, selectedClass?.subClass, selectedClass?.category]);

  const proposedUnitValue = selectedClass?.marketValue2027 ?? 0;
  const currentRPT = useMemo(
    () => computeRPT(area, currentUnitValue, assessmentLevel, taxRate),
    [area, currentUnitValue, assessmentLevel, taxRate]
  );
  const proposedRPT = useMemo(
    () => computeRPT(area, proposedUnitValue, assessmentLevel, taxRate),
    [area, proposedUnitValue, assessmentLevel, taxRate]
  );
  const firstYearRPT =
    currentRPT > 0
      ? Math.min(currentRPT * (1 + capRate / 100), proposedRPT)
      : proposedRPT;

  const yearsToFull = useMemo(() => {
    if (currentRPT <= 0 || proposedRPT <= currentRPT) return 0;
    let amount = currentRPT;
    let years = 0;
    while (amount < proposedRPT && years < 200) {
      amount *= 1 + capRate / 100;
      years += 1;
    }
    return years;
  }, [capRate, currentRPT, proposedRPT]);

  const projection = useMemo(
    () => buildProjection(currentRPT, proposedRPT, capRate, projectionYears),
    [capRate, currentRPT, projectionYears, proposedRPT]
  );

  if (!open) return null;

  const maxBar = Math.max(proposedRPT, ...projection.map((row) => row.value), 1);

  return (
    <aside className="rpt-calculator" aria-label="RPT impact calculator">
      <header className="rpt-calculator__header">
        <div>
          <div className="rpt-calculator__eyebrow">{municipality?.name}</div>
          <h2>RPT Impact</h2>
        </div>
        <button
          type="button"
          className="rpt-calculator__close"
          onClick={onClose}
          aria-label="Close RPT calculator"
          title="Close"
        >
          ×
        </button>
      </header>

      <div className="rpt-calculator__body">
        <div className="rpt-calculator__grid">
          <label className="rpt-field rpt-field--wide">
            <span>SMV class</span>
            <select
              value={selectedClass?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {classifications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.subClass} · {categoryLabel(item.category)} ·{" "}
                  {formatUnitValue(item.marketValue2027)} / m²
                </option>
              ))}
            </select>
          </label>
          {selectedClass && (
            <div className="rpt-selected-class">
              <span
                className="rpt-selected-class__chip"
                style={{ backgroundColor: selectedClass.color }}
              >
                {selectedClass.subClass}
              </span>
              <div>
                <strong>{formatUnitValue(proposedUnitValue)} / m²</strong>
                <span>
                  {municipality?.name} {categoryLabel(selectedClass.category)} SMV
                </span>
              </div>
            </div>
          )}
          <label className="rpt-field">
            <span>Lot area</span>
            <input
              type="number"
              min="1"
              value={area}
              onChange={(event) => setArea(Math.max(1, numberOrZero(event.target.value)))}
            />
          </label>
          <label className="rpt-field">
            <span>Assessment</span>
            <input
              type="number"
              min="1"
              max="100"
              value={assessmentLevel}
              onChange={(event) =>
                setAssessmentLevel(Math.max(1, Math.min(100, numberOrZero(event.target.value))))
              }
            />
          </label>
          <label className="rpt-field">
            <span>Current unit value</span>
            <input
              type="number"
              min="0"
              value={currentUnitValue}
              onChange={(event) => setCurrentUnitValue(Math.max(0, numberOrZero(event.target.value)))}
            />
          </label>
          <label className="rpt-field">
            <span>Tax rate</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={taxRate}
              onChange={(event) => setTaxRate(Math.max(0, numberOrZero(event.target.value)))}
            />
          </label>
          <label className="rpt-field">
            <span>Annual cap</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={capRate}
              onChange={(event) => setCapRate(Math.max(0, numberOrZero(event.target.value)))}
            />
          </label>
          <label className="rpt-field">
            <span>Years</span>
            <select
              value={projectionYears}
              onChange={(event) => setProjectionYears(numberOrZero(event.target.value))}
            >
              {[5, 10, 15, 20, 30].map((years) => (
                <option key={years} value={years}>
                  {years}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="rpt-smv-pair" aria-label="Unit values">
          <div>
            <span>Current SMV</span>
            <strong>{currency(currentUnitValue)}</strong>
          </div>
          <div>
            <span>Proposed SMV</span>
            <strong>{currency(proposedUnitValue)}</strong>
          </div>
        </section>

        <section className="rpt-results" aria-label="Tax impact summary">
          <ResultCard label="Current RPT" value={currency(currentRPT)} />
          <ResultCard label={`Year 1 with ${capRate}% cap`} value={currency(firstYearRPT)} />
          <ResultCard
            label="Full proposed RPT"
            value={currency(proposedRPT)}
            note={yearsToFull > 0 ? `~${yearsToFull} years` : "Immediate"}
          />
        </section>

        <section className="rpt-projection" aria-label="Yearly RPT projection">
          {projection.map((row) => {
            const pct = Math.min((row.value / maxBar) * 100, 100);
            return (
              <div className="rpt-projection__row" key={row.label}>
                <span>{row.label}</span>
                <div className="rpt-projection__track">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <strong>{currency(row.value)}</strong>
              </div>
            );
          })}
        </section>
      </div>
    </aside>
  );
}

function ResultCard({ label, value, note }) {
  return (
    <div className="rpt-result-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
