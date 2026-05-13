import {
  BARLIG_CLASSIFICATIONS,
  BARLIG_BARANGAYS,
} from "../lib/barlig.js";
import fs from "node:fs";

const slugToName = new Map(BARLIG_BARANGAYS.map((b) => [b.slug, b.name]));

function toItems(category) {
  return BARLIG_CLASSIFICATIONS.filter((c) => c.category === category).flatMap(
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
  municipality: "BARLIG",
  document_title:
    "SCHEDULE OF BASE UNIT MARKET VALUES FOR RESIDENTIAL AND COMMERCIAL LANDS",
  revision_year: 2027,
  standard_depth: { residential_lands: "30 meters", commercial_lands: "30 meters" },
  land_classifications: [
    { category: "Commercial Lands", items: toItems("commercial") },
    { category: "Residential Lands", items: toItems("residential") },
  ],
};

fs.writeFileSync(
  "public/data/barlig_valuations.json",
  JSON.stringify(out, null, 2) + "\n"
);
console.log("Wrote public/data/barlig_valuations.json");
