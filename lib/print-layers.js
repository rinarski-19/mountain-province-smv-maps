// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Splits a rendered print sheet into its map layer and its fixed
// furniture, so the drag-to-frame preview can move one without the other.
//
// Panning moves the map only — the legend, compass, signature block and
// page border stay put on the paper. Translating the whole sheet during a
// drag therefore showed something that never happens. Serving the two
// layers separately lets the preview stack them and transform just the
// map.
//
// Both layers come from one render, so they cannot disagree about what is
// on the sheet.

// Groups drawn at fixed positions on the paper rather than in map space.
export const FURNITURE_GROUP_IDS = Object.freeze([
  "legend",
  "location-legend",
  "prepared-by",
  "compass-rose",
  "page-border",
]);

// Find a top-level <g id="..."> and its matching close, counting nested
// <g> so a compass rose or a legend column does not end the block early.
function findGroup(svg, id) {
  const start = svg.indexOf(`<g id="${id}"`);
  if (start < 0) return null;
  let depth = 0;
  let i = start;
  while (i < svg.length) {
    const open = svg.indexOf("<g", i);
    const close = svg.indexOf("</g>", i);
    if (close < 0) return null;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 2;
    } else {
      depth--;
      i = close + 4;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

function removeGroups(svg, ids) {
  let out = svg;
  for (const id of ids) {
    const found = findGroup(out, id);
    if (found) out = out.slice(0, found.start) + out.slice(found.end);
  }
  return out;
}

function keepOnlyGroups(svg, ids) {
  const header = svg.slice(0, svg.indexOf(">", svg.indexOf("<svg")) + 1);
  const defs = (() => {
    const s = svg.indexOf("<defs>");
    if (s < 0) return "";
    const e = svg.indexOf("</defs>", s);
    return e < 0 ? "" : svg.slice(s, e + 7);
  })();
  const blocks = [];
  for (const id of ids) {
    const found = findGroup(svg, id);
    if (found) blocks.push(svg.slice(found.start, found.end));
  }
  // No paper rect: the furniture layer sits over the map layer, so its
  // background has to be transparent.
  return `${header}${defs}${blocks.join("")}</svg>`;
}

// layer: "map" drops the furniture; "furniture" keeps only it, on a
// transparent background. Anything else returns the sheet unchanged.
export function extractPrintLayer(svg, layer) {
  if (layer === "map") return removeGroups(svg, FURNITURE_GROUP_IDS);
  if (layer === "furniture") return keepOnlyGroups(svg, FURNITURE_GROUP_IDS);
  return svg;
}

export function isPrintLayer(value) {
  return value === "map" || value === "furniture";
}
