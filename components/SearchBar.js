"use client";

// Cross-feature search for the current LGU. Walks the schedule's
// barangays, the OSM roads file, and the OSM + custom landmarks
// files; matches by substring (case-insensitive) and renders grouped
// autocomplete results. On select:
//
//   - Barangay  -> sets the schedule indices so the sidebar opens at
//                  the right class/group/barangay AND the existing
//                  BarangayFocus mechanism flies the map there.
//   - Road      -> flies the map to the road segment's bounding box.
//   - Landmark  -> flies the map to the landmark point.
//
// V1 deliberately scopes to the current LGU; cross-LGU search is a
// follow-up (would need to load every LGU's data on landing, which
// is expensive). The input is mounted in TopNav.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_RESULTS_PER_GROUP = 6;

export default function SearchBar({
  classifications = [],
  barangaysCatalog = [],
  osmRoadsFC = null,
  landmarksFC = null,
  customLandmarksFC = null,
  onSelectBarangay,
  onFlyToBounds,
  onFlyToPoint,
  placeholder = "Search barangay, road, or landmark",
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Build the index once per data change. Each entry carries the
  // metadata the onSelect handlers need.
  const barangayIndex = useMemo(() => {
    const out = [];
    for (let ci = 0; ci < classifications.length; ci++) {
      const cls = classifications[ci];
      for (let gi = 0; gi < (cls.locationGroups || []).length; gi++) {
        const group = cls.locationGroups[gi];
        for (let bi = 0; bi < (group.barangays || []).length; bi++) {
          const slug = group.barangays[bi];
          const meta = barangaysCatalog.find((b) => b.slug === slug);
          if (!meta) continue;
          out.push({
            type: "barangay",
            slug,
            name: meta.name,
            subtitle: `${cls.subClass} - ${cls.category}`,
            classIdx: ci,
            groupIdx: gi,
            barangayIdx: bi,
          });
        }
      }
    }
    // De-duplicate by slug so a barangay that appears under multiple
    // classes only shows once in results. Keep the first occurrence
    // (highest-tier class).
    const seen = new Set();
    return out.filter((row) => {
      if (seen.has(row.slug)) return false;
      seen.add(row.slug);
      return true;
    });
  }, [classifications, barangaysCatalog]);

  const roadIndex = useMemo(() => {
    if (!osmRoadsFC?.features) return [];
    // Group road segments by their `name` so we don't show 30 entries
    // for "Halsema Highway." For each named road, pre-compute a bbox
    // of all its segments so the fly-to lands cleanly.
    const byName = new Map();
    for (const f of osmRoadsFC.features) {
      const n = f.properties?.name;
      if (!n) continue;
      const key = n.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          type: "road",
          name: n,
          barangays: new Set(),
          bbox: [Infinity, Infinity, -Infinity, -Infinity],
        });
      }
      const entry = byName.get(key);
      const b = f.properties?.barangay_name;
      if (b) entry.barangays.add(b);
      // Accumulate bbox from feature coordinates.
      const visit = (c) => {
        if (typeof c[0] === "number") {
          entry.bbox[0] = Math.min(entry.bbox[0], c[0]);
          entry.bbox[1] = Math.min(entry.bbox[1], c[1]);
          entry.bbox[2] = Math.max(entry.bbox[2], c[0]);
          entry.bbox[3] = Math.max(entry.bbox[3], c[1]);
          return;
        }
        for (const sub of c) visit(sub);
      };
      visit(f.geometry?.coordinates ?? []);
    }
    return Array.from(byName.values()).map((entry) => ({
      ...entry,
      subtitle:
        entry.barangays.size === 0
          ? "Road"
          : `Through ${[...entry.barangays].slice(0, 3).join(", ")}${
              entry.barangays.size > 3 ? "..." : ""
            }`,
    }));
  }, [osmRoadsFC]);

  const landmarkIndex = useMemo(() => {
    const out = [];
    const eat = (fc, sourceLabel) => {
      if (!fc?.features) return;
      for (const f of fc.features) {
        const n = f.properties?.name;
        if (!n) continue;
        const coords = f.geometry?.coordinates;
        // landmarks are Points; ignore non-point geometries
        if (!Array.isArray(coords) || typeof coords[0] !== "number") continue;
        out.push({
          type: "landmark",
          name: n,
          subtitle: `${sourceLabel}${
            f.properties?.barangay_name
              ? " - " + f.properties.barangay_name
              : ""
          }`,
          lng: coords[0],
          lat: coords[1],
        });
      }
    };
    eat(landmarksFC, "OSM POI");
    eat(customLandmarksFC, "LGU landmark");
    return out;
  }, [landmarksFC, customLandmarksFC]);

  // Build a single ordered results list with per-group limits.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const match = (s) => s.toLowerCase().includes(q);
    const brgy = barangayIndex
      .filter((r) => match(r.name) || match(r.slug))
      .slice(0, MAX_RESULTS_PER_GROUP);
    const roads = roadIndex
      .filter((r) => match(r.name))
      .slice(0, MAX_RESULTS_PER_GROUP);
    const landmarks = landmarkIndex
      .filter((r) => match(r.name))
      .slice(0, MAX_RESULTS_PER_GROUP);
    return [...brgy, ...roads, ...landmarks];
  }, [query, barangayIndex, roadIndex, landmarkIndex]);

  // Clamp highlightIdx whenever results change so arrow keys behave.
  useEffect(() => {
    if (highlightIdx >= results.length) setHighlightIdx(0);
  }, [results.length, highlightIdx]);

  const apply = useCallback(
    (row) => {
      if (!row) return;
      if (row.type === "barangay") {
        onSelectBarangay?.({
          slug: row.slug,
          classIdx: row.classIdx,
          groupIdx: row.groupIdx,
          barangayIdx: row.barangayIdx,
        });
      } else if (row.type === "road") {
        onFlyToBounds?.(row.bbox);
      } else if (row.type === "landmark") {
        onFlyToPoint?.({ lat: row.lat, lng: row.lng });
      }
      setQuery("");
      setFocused(false);
      inputRef.current?.blur();
    },
    [onSelectBarangay, onFlyToBounds, onFlyToPoint]
  );

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      apply(results[highlightIdx]);
    } else if (e.key === "Escape") {
      setQuery("");
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  // Group results visually with a small section header inside the
  // dropdown. We track index numbers so arrow navigation lines up
  // with the keyboard highlight.
  const groupedView = useMemo(() => {
    if (results.length === 0) return null;
    const groups = { barangay: [], road: [], landmark: [] };
    results.forEach((row, idx) => {
      groups[row.type].push({ row, idx });
    });
    return groups;
  }, [results]);

  const showDropdown = focused && query.trim().length >= 2;

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        flex: "1 1 320px",
        maxWidth: 480,
        minWidth: 200,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            fontSize: 14,
            pointerEvents: "none",
          }}
        >
          {/* magnifier glyph; using a unicode char keeps the bundle small */}
          {"\u{1F50D}"}
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={{
            width: "100%",
            height: 32,
            padding: "6px 12px 6px 32px",
            fontSize: 13,
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "white",
            outline: "none",
          }}
          aria-label="Search barangay, road, or landmark"
        />
      </div>
      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            boxShadow: "0 6px 24px rgba(0,0,0,0.1)",
            maxHeight: 360,
            overflowY: "auto",
            zIndex: 1100,
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: "10px 14px",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              No matches in this LGU.
            </div>
          ) : (
            <>
              {(["barangay", "road", "landmark"]).map((type) => {
                const items = groupedView?.[type] ?? [];
                if (items.length === 0) return null;
                const label =
                  type === "barangay"
                    ? "Barangays"
                    : type === "road"
                      ? "Roads"
                      : "Landmarks";
                return (
                  <div key={type}>
                    <div
                      style={{
                        padding: "4px 14px",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "#94a3b8",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                      }}
                    >
                      {label}
                    </div>
                    {items.map(({ row, idx }) => {
                      const isHi = idx === highlightIdx;
                      return (
                        <button
                          key={`${row.type}-${row.name}-${idx}`}
                          type="button"
                          role="option"
                          aria-selected={isHi}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          onMouseDown={(e) => {
                            // Use mousedown so the click registers before
                            // the input loses focus and closes us.
                            e.preventDefault();
                            apply(row);
                          }}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "7px 14px",
                            background: isHi ? "#e0f2fe" : "white",
                            border: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 13,
                            color: "#0f172a",
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{row.name}</span>
                          <span style={{ color: "#64748b", fontSize: 11 }}>
                            {row.subtitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
