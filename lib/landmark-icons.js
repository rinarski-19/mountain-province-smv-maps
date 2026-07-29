// Shared landmark icon catalog. The same pictograms are used in the
// add-landmark picker and in the Leaflet divIcon markers so the choice the
// editor makes is the icon that appears on the map.

export const LANDMARK_KIND_OPTIONS = [
  { value: "business", label: "Business", color: "#7e57c2" },
  { value: "govt", label: "Government", color: "#607d8b" },
  { value: "hospital", label: "Hospital", color: "#e53935" },
  { value: "clinic", label: "Clinic", color: "#e53935" },
  { value: "school", label: "School", color: "#1a73e8" },
  { value: "worship", label: "Worship", color: "#607d8b" },
  { value: "market", label: "Market", color: "#1a73e8" },
  { value: "tourism", label: "Tourism", color: "#00acc1" },
  { value: "transport", label: "Transport", color: "#03a9f4" },
];

// Simple, legible 24px line pictograms. They intentionally stay compact so
// the pin remains recognizable over satellite imagery at close zooms.
const ICON_PATHS = {
  business: "M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M10 12v2h4v-2",
  govt: "M4 20h16 M6 20V10h12v10 M4 10l8-5 8 5 M9 13v4 M12 13v4 M15 13v4",
  hospital: "M12 4v16 M4 12h16",
  clinic: "M7 5a5 5 0 0 0 0 10h2 M17 5a5 5 0 0 1 0 10h-2 M9 15v3a3 3 0 0 0 6 0v-3 M12 5v3 M10 7h4",
  school: "M6 21V3 M6 5h3l11 5-11 5H6",
  worship: "M12 4v16 M7 9h10 M9 20h6",
  market: "M4 10h16l-1 10H5L4 10z M7 10V7a5 5 0 0 1 10 0v3 M8 14h8",
  tourism: "M3 20l6-8 4 4 3-5 5 9 M15 5h.01",
  transport: "M5 17h14l-1-9H6l-1 9z M7 8l1-3h8l1 3 M8 17v2 M16 17v2 M8 12h.01 M16 12h.01",
};

const ICON_ALIASES = {
  church: "worship",
  government: "govt",
  fuel: "market",
  finance: "business",
  food: "business",
  lodging: "tourism",
  shop: "business",
};

export function normalizeLandmarkKind(kind) {
  const normalized = String(kind || "business")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  return ICON_PATHS[normalized] ? normalized : ICON_ALIASES[normalized] || "business";
}

export function landmarkIconPath(kind) {
  return ICON_PATHS[normalizeLandmarkKind(kind)];
}

export function landmarkIconMarkup(kind) {
  return (
    `<svg class="landmark-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="${landmarkIconPath(kind)}"></path>` +
    `</svg>`
  );
}
