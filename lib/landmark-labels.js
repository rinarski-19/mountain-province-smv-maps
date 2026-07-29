export const LANDMARK_LABEL_PLACEMENTS = [
  { value: "inside-smv", label: "Inside SMV - above icon" },
  { value: "callout-right", label: "Callout right" },
  { value: "callout-left", label: "Callout left" },
  { value: "callout-top", label: "Callout top" },
  { value: "callout-bottom", label: "Callout bottom" },
];

export const LANDMARK_LABEL_SIZES = ["small", "medium", "large"];

const PLACEMENT_VALUES = new Set(
  LANDMARK_LABEL_PLACEMENTS.map((option) => option.value)
);

export function normalizeLandmarkLabelPlacement(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "callout") return "callout-right";
  return PLACEMENT_VALUES.has(key) ? key : "inside-smv";
}

export function normalizeLandmarkLabelSize(value) {
  return LANDMARK_LABEL_SIZES.includes(value) ? value : "large";
}

export function isInsideLandmarkLabel(value) {
  return normalizeLandmarkLabelPlacement(value) === "inside-smv";
}
