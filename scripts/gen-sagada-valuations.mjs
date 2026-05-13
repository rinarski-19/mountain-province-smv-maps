import {
  SAGADA_CLASSIFICATIONS,
  SAGADA_BARANGAYS,
} from "../lib/sagada.js";
import fs from "node:fs";

const slugToName = new Map(SAGADA_BARANGAYS.map((b) => [b.slug, b.name]));

function toItems(category) {
  return SAGADA_CLASSIFICATIONS.filter((c) => c.category === category).flatMap(
    (cls) =>
      cls.locationGroups.map((group) => ({
        location_description: group.label,
        unit_value_2026_per_sqm: cls.marketValue2027,
        sub_classification: cls.subClass,
        barangays: group.barangays.map((s) => slugToName.get(s) ?? s),
      }))
  );
}

const out = {
  municipality: "SAGADA",
  document_title:
    "SCHEDULE OF BASE UNIT MARKET VALUES FOR RESIDENTIAL, COMMERCIAL, AND INDUSTRIAL LANDS",
  revision_year: 2026,
  land_classifications: [
    { category: "Commercial Lands", items: toItems("commercial") },
    { category: "Residential Lands", items: toItems("residential") },
  ],
};

fs.writeFileSync(
  "public/data/sagada_valuations.json",
  JSON.stringify(out, null, 2) + "\n"
);
console.log("Wrote public/data/sagada_valuations.json");
