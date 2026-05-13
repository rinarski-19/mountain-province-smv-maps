// Helpers for the SMV-walkthrough "slideshow":
// flatten the grouped valuations document into a single ordered list of
// items, each with a stable id, that drives the sidebar + bottom bar.

import { CLASSIFICATION_INFO } from "./classifications";

export function buildSlides(valuations) {
  if (!valuations?.land_classifications) return [];
  const slides = [];
  let counter = 0;
  for (const group of valuations.land_classifications) {
    for (const item of group.items ?? []) {
      counter += 1;
      const klass = item.sub_classification;
      const info = klass ? CLASSIFICATION_INFO[klass] : null;
      slides.push({
        id: `slide-${counter}`,
        index: counter,
        category: group.category,
        classification: klass,
        info,
        valuePerSqm: item.unit_value_2027_per_sqm,
        description: item.location_description,
        barangays: item.barangays ?? [],
      });
    }
  }
  return slides;
}

// Match curated barangay names against the polygon layer regardless of
// "Bila (Bua)" / "Poblacion (Bauko)" sitio suffixes.
function normalise(name) {
  return String(name)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

export function featuresForSlide(slide, barangaysFC) {
  if (!slide || !barangaysFC?.features) return [];
  const wanted = new Set((slide.barangays ?? []).map(normalise));
  if (wanted.size === 0) return [];
  return barangaysFC.features.filter((f) =>
    wanted.has(normalise(f.properties?.name ?? ""))
  );
}
