"use client";

// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Drag-to-frame preview for the print sheet.
//
// Pan is a pure translation of the drawn map, so a drag can be previewed
// by translating the already-rendered sheet — no re-render per frame.
// That is what makes this cheap enough to be live: one fetch per zoom
// change, then CSS transforms while the pointer is down.
//
// The translation is only exact for the map itself. The legend, compass
// and signature block are fixed furniture and do not move when panning,
// so once the pointer is released the sheet is re-fetched with the real
// pan applied and the preview becomes literal.

import { useCallback, useEffect, useRef, useState } from "react";

export default function PrintFramer({
  src,
  orientation,
  panX,
  panY,
  onPanChange,
  disabled = false,
}) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // A new src means the committed pan is now baked into the image, so the
  // local drag offset has to go back to zero or it would double-count.
  useEffect(() => {
    setDrag({ x: 0, y: 0 });
    setLoading(true);
    setFailed(false);
  }, [src]);

  const onPointerDown = useCallback(
    (event) => {
      if (disabled || failed) return;
      const box = boxRef.current;
      if (!box) return;
      // Record the drag BEFORE capturing. setPointerCapture throws on an
      // unrecognised pointerId, and optional chaining does not guard a
      // throw — doing it first aborted the whole handler and the drag
      // silently did nothing.
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        width: box.clientWidth,
        height: box.clientHeight,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation; the move handler works without it.
      }
    },
    [disabled, failed]
  );

  const onPointerMove = useCallback((event) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag({ x: event.clientX - d.startX, y: event.clientY - d.startY });
  }, []);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setDrag((offset) => {
      // Pixels dragged over the preview box, as a fraction of the page —
      // the same unit the print route takes.
      if (offset.x || offset.y) {
        onPanChange?.(panX + offset.x / d.width, panY + offset.y / d.height);
      }
      return offset;
    });
  }, [onPanChange, panX, panY]);

  return (
    <div className="print-framer">
      <div
        ref={boxRef}
        className={`print-framer__box print-framer__box--${orientation}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Drag to move the map on the sheet"
      >
        {failed ? (
          <p className="print-framer__note">
            Could not load the preview. The sliders below still work.
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="print-framer__sheet"
              src={src}
              alt="Print sheet preview"
              draggable={false}
              style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
            />
            {loading && <p className="print-framer__note">Rendering preview…</p>}
          </>
        )}
      </div>
      <small className="print-framer__hint">
        Drag the sheet to move the map. Release to apply — the preview then
        reloads so the legend and signature sit where they really will.
      </small>
    </div>
  );
}
