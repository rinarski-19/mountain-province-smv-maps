"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

export default function Map(props) {
  // Leaflet touches `window` on import, so we have to load it client-side only.
  // Memoizing keeps the dynamic import stable across re-renders.
  const LeafletMap = useMemo(
    () =>
      dynamic(() => import("./LeafletMap"), {
        ssr: false,
        loading: () => (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
            }}
          >
            Loading map…
          </div>
        ),
      }),
    []
  );

  return <LeafletMap {...props} />;
}
