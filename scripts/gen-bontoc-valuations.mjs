import {
  BONTOC_CLASSIFICATIONS,
  BONTOC_BARANGAYS,
} from "../lib/bontoc.js";
import fs from "node:fs";
const slugToName = new Map(BONTOC_BARANGAYS.map((b) => [b.slug, b.name]));
function toItems(category) {
  return BONTOC_CLASSIFICATIONS.filter((c) => c.category === category).flatMap(
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
  municipality: "BONTOC",
  document_title: "SCHEDULE OF BASE UNIT MARKET VALUES (placeholder pending LGU input)",
  revision_year: 2027,
  land_classifications: [
    { category: "Commercial Lands", items: toItems("commercial") },
    { category: "Residential Lands", items: toItems("residential") },
  ],
};
fs.writeFileSync("public/data/bontoc_valuations.json", JSON.stringify(out, null, 2) + "\n");
console.log("Wrote public/data/bontoc_valuations.json");
