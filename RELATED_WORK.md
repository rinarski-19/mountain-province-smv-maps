# Related work & competitive landscape

Last updated: 2026-05-17.

Quick survey of what else exists in this space, so we can talk about
it honestly. **TL;DR — we're not alone, but the specific combination
of features here (per-stretch SMV semantics + click-selectable
frontage bands + open-source + self-hostable, tailored to Mountain
Province) doesn't appear to have a direct counterpart.**

## Commercial PH competitors (closest first)

### MapX — the closest direct competitor
- Web GIS for LGU tax mapping, assessment, valuation, and revenue
  collection. Created by Dr. Rolyn Daguil at Caraga State University
  with DOST-PCIEERD funding. Now offered commercially.
- Web-based parcellary mapping, overlays, spatial analysis,
  dashboards. Same target buyer (LGU assessor's office), same broad
  problem space.
- Closed-source / licensed. Pricing isn't public.
- Pages: <https://projects.pcieerd.dost.gov.ph/project/8630>,
  <https://www.mapx.ph/en-ph/>.

### Infoman RISE/LGU — strong on RPTAS, weak on mapping
- Real Property Tax Assessment System (RPTAS) software, deployed at
  many LGUs. Strong on the database / billing / collection side.
  Mapping is secondary.
- Pages: <https://www.infomaninc.com/rise_lgu.html>.

### LGI Consultants (GIS-ULIS), Business Mapper, etc.
- Per-LGU tax-mapping consultancies that build custom mapping
  projects on a per-engagement basis. Service businesses rather than
  products.
- Pages: <https://www.lgi.com.ph/gis-ulis>,
  <http://www.businessmapper.biz/technical-blogs-3/increasing-lgu-revenues-through-tax-mapping-in-the-philippines>.

### Static SMV maps published as PDFs / web pages
- Some LGUs publish their SMV land-value maps online but they're
  read-only PDFs / image scans, not interactive.
- Examples: Burauen (Leyte), Santa Barbara (Iloilo).
- <https://burauenassessor.wordpress.com/land-value-map/>.

## Government-level effort happening right now

### RA 12001 (RPVARA, 2024) — national mandate
- **RA 12001 (Real Property Valuation and Assessment Reform Act,
  2024)** legally requires BLGF to build a centralized **Real
  Property Information System** and obliges every LGU to fully
  automate real-property tax administration within two years of the
  Act taking effect.
- This is a centralized database with required transaction reporting
  from the Register of Deeds, BIR, etc. — *not* a per-municipality
  drawing tool. Different layer of the stack.
- BLGF + DICT are jointly responsible for the rollout.
- <https://blgf.gov.ph/house-approves-the-real-property-valuation-and-assessment-reform-bill/>,
  <https://cruzmarcelo.com/modernizing-and-standardizing-the-valuation-of-real-property-in-the-philippines-the-real-property-valuation-and-assessment-reform-act/>.

### Philippine Valuation Standards (under modernization)
- BLGF welcomed IVSC's 2024 international valuation standards. Local
  standards being updated to match.
- <https://blgf.gov.ph/blgf-welcomes-latest-international-standards-on-property-valuation/>.

## Open-source projects in adjacent spaces

### National Zoning Atlas (US)
- Cornell-led project that extracts ~200 zoning attributes per
  district across the US. Residential zoning, not SMV. US-only,
  different regulatory regime.
- <https://www.zoningatlas.org/>.

### zoning.space
- Parses US zoning code text into a unified, machine-readable
  dataset. Code-text-oriented, not map-oriented.
- <https://github.com/zoningspace/zoning.space>.

### OpenMapEditor, MAPC Neighborhood Drawing Tool
- Generic Leaflet drawing tools. No SMV / valuation model on top.
- <https://github.com/openmapeditor/openmapeditor>,
  <https://github.com/MAPC/neighborhood-drawing-tool>.

## What we do that nothing above does (as far as I can find)

1. **Landmark-to-landmark "stretches" as a first-class concept** —
   the way the BLGF Mountain Province schedules are actually drafted
   ("Circle → Kalangeg building", "Wanchakan → Pines Kitchenette →
   Circle"). Every other tool I found models things as parcels or
   generic zones, not as named stretches between landmarks.
2. **Click-selectable frontage bands** — the depth-of-frontage rule
   (0–30 m / 30–60 m) exists in the law and is referenced in every
   SMV, but no tool I found bakes it as a visible overlay you can
   click on a stretch to commit. Ours auto-clips to one side, carves
   the road centerline out, and fills the slivers.
3. **DXF import pipeline → editable Geoman zones in the browser**,
   including HATCH boundary extraction. Other tools take CAD input
   but it's a black box; here it's a python script + an in-app
   "Import DXF…" button you can audit.
4. **Per-stretch saved viewports + in-app landmark editor + move/
   delete UI** — useful for field-day prep where the assessor wants
   to bookmark every stretch they'll walk.
5. **Open-source, self-hostable, Next.js + Leaflet stack** — most
   small municipalities can't afford MapX licensing or a custom GIS
   build-out. A free, run-it-yourself thing is a real gap.

## Risks / things worth watching

- **BLGF's national system under RA 12001** could make per-LGU
  tooling redundant if it ships strong client-side mapping. But
  centralized government systems typically don't build the kind of
  iterative draw-this-stretch UX we have.
- **MapX could open-source** or drop pricing. Unlikely (it's CSU's
  revenue stream), but worth tracking.
- **The "stretch" model only matches LGUs that actually draft
  schedules this way.** Mountain Province does. Many other provinces
  use parcel-by-parcel SMV without named stretches — they'd need
  different UX.

## Sources

Pulled 2026-05-17 via web search. If a link 404s, search the title.

- [MapX project page — DOST-PCIEERD](https://projects.pcieerd.dost.gov.ph/project/8630)
- [MapX official site](https://www.mapx.ph/en-ph/)
- [DOST upgrade for Mambajao tax mapping](https://region10.dost.gov.ph/483-dost-to-upgrade-tax-mapping-and-real-property-assessment-technology-for-mambajao)
- [Infoman RISE LGU software](https://www.infomaninc.com/rise_lgu.html)
- [LGI Consultants GIS-ULIS](https://www.lgi.com.ph/gis-ulis)
- [Business Mapper PH tax mapping](http://www.businessmapper.biz/technical-blogs-3/increasing-lgu-revenues-through-tax-mapping-in-the-philippines)
- [BLGF — Real Property Valuation and Assessment Reform Bill](https://blgf.gov.ph/house-approves-the-real-property-valuation-and-assessment-reform-bill/)
- [RA 12001 RPVARA overview — Cruz Marcelo](https://cruzmarcelo.com/modernizing-and-standardizing-the-valuation-of-real-property-in-the-philippines-the-real-property-valuation-and-assessment-reform-act/)
- [BLGF SMV index](https://blgf.gov.ph/smv/)
- [Burauen Municipal Assessor land value map](https://burauenassessor.wordpress.com/land-value-map/)
- [National Zoning Atlas](https://www.zoningatlas.org/)
- [zoning.space](https://github.com/zoningspace/zoning.space)
- [OpenMapEditor](https://github.com/openmapeditor/openmapeditor)
- [MAPC Neighborhood Drawing Tool](https://github.com/MAPC/neighborhood-drawing-tool)
