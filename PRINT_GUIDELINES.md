# Print Guidelines

These rules are the source of truth for the Bauko print workflow.

## Required Print Output

- Use the Online OSM visual appearance as the base map.
- Remove map labels for the print output.
- Do not show frontage bands in the print output.
- The map must fit on one A3 paper sheet.
- The output target must be 300dpi.
- Roads must remain clearly visible.

## Implementation Notes

- Do not print the live Leaflet browser layout if it causes viewport drift, grey gaps, or tiny overview maps.
- Prefer a dedicated print renderer/page for `bauko-print` so print-specific rules do not break the normal Bauko consultation map.
- The print renderer should preserve the Online OSM look, but suppress labels and keep road geometry readable.
- `bauko-print` may share Bauko's official zones, barangays, municipality outline, and valuation data, but print layout behavior can be customized separately.
