import {
  TADIAN_CLASSIFICATIONS,
  TADIAN_BARANGAYS,
} from "../lib/tadian.js";
import fs from "node:fs";

const slugToName = new Map(TADIAN_BARANGAYS.map((b) => [b.slug, b.name]));

function toItems(category) {
  return TADIAN_CLASSIFICATIONS.filter((c) => c.category === category).flatMap(
    (cls) =>
      cls.locationGroups.map((group) => ({
        location_description: group.label,
        unit_value_2027_per_sqm: cls.marketValue2027,
        sub_classification: cls.subClass,
        barangays: group.barangays.map((s) => slugToName.get(s) ?? s),
      }))
  );
}

const out = {
  municipality: "TADIAN",
  document_title:
    "SCHEDULE OF BASE UNIT MARKET VALUES FOR RESIDENTIAL, COMMERCIAL AND INDUSTRIAL LANDS",
  revision_year: 2027,
  standard_depth: { residential_lands: "30 meters", commercial_lands: "30 meters" },
  land_classifications: [
    { category: "Commercial Lands", items: toItems("commercial") },
    { category: "Residential Lands", items: toItems("residential") },
  ],
};

fs.writeFileSync(
  "public/data/tadian_valuations.json",
  JSON.stringify(out, null, 2) + "\n"
);
console.log("Wrote public/data/tadian_valuations.json");
