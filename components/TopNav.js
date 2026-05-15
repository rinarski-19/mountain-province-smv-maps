"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function TopNav({
  drawMode,
  setDrawMode,
  tileMode,
  setTileMode,
  municipalitySlug,
  setMunicipalitySlug,
  municipalities = [],
  provinceName = "Mountain Province",
  canSaveView = false,
  hasSavedView = false,
  onSaveView,
  onResetView,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const menuRef = useRef(null);
  const editRef = useRef(null);
  const settingsRef = useRef(null);
  const selectedMunicipality = useMemo(
    () =>
      municipalities.find((municipality) => municipality.slug === municipalitySlug) ??
      municipalities.find((municipality) => municipality.slug === "bauko") ??
      municipalities[0] ??
      { slug: municipalitySlug, name: municipalitySlug, enabled: true },
    [municipalitySlug, municipalities]
  );

  useEffect(() => {
    const onDocClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
      if (!editRef.current?.contains(event.target)) setEditOpen(false);
      if (!settingsRef.current?.contains(event.target)) setSettingsOpen(false);
    };
    const onEsc = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setEditOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  return (
    <nav className="top-nav" aria-label="Map controls">
      <div className="top-nav__brand-wrap" ref={menuRef}>
        <button
          type="button"
          className={`top-nav__expander ${menuOpen ? "is-open" : ""}`}
          aria-label={menuOpen ? "Collapse municipality menu" : "Expand municipality menu"}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((value) => !value)}
          title={menuOpen ? "Collapse municipalities" : "Select municipality"}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="top-nav__brand">
          <div className="top-nav__title">{selectedMunicipality.name.toUpperCase()}</div>
          <div className="top-nav__subtitle">{provinceName}</div>
        </div>
        {menuOpen && (
          <div className="top-nav__menu" role="menu" aria-label="Select municipality">
            {municipalities.map((municipality) => {
              const isActive = municipality.slug === municipalitySlug;
              const isDisabled = municipality.enabled === false;
              return (
                <button
                  key={municipality.slug}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  disabled={isDisabled}
                  className={`top-nav__menu-item ${isActive ? "is-active" : ""}`}
                  onClick={() => {
                    if (isDisabled) return;
                    setMunicipalitySlug?.(municipality.slug);
                    setMenuOpen(false);
                  }}
                >
                  {municipality.name}
                  {isDisabled && <span className="top-nav__menu-item-note">Soon</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="top-nav__controls">
        <div className="top-nav__edit-wrap" ref={editRef}>
          <button
            type="button"
            className={`icon-button ${drawMode || editOpen ? "is-active" : ""}`}
            aria-label="Edit options"
            aria-expanded={editOpen}
            aria-haspopup="menu"
            title="Edit options"
            onClick={() => {
              setEditOpen((value) => !value);
              setMenuOpen(false);
              setSettingsOpen(false);
            }}
          >
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M4 20h4.6L19.2 9.4a2.2 2.2 0 0 0 0-3.1L17.7 4.8a2.2 2.2 0 0 0-3.1 0L4 15.4V20Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="m13.5 5.9 4.6 4.6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {editOpen && (
            <div className="top-nav__edit-menu" role="menu" aria-label="Edit options">
              <button
                type="button"
                className={`top-nav__edit-item ${drawMode ? "is-active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={drawMode}
                onClick={() => {
                  setDrawMode((value) => !value);
                  setEditOpen(false);
                }}
              >
                {drawMode ? "Hide drawing tools" : "Show drawing tools"}
              </button>
              <button
                type="button"
                className="top-nav__edit-item"
                role="menuitem"
                onClick={() => {
                  onSaveView?.();
                  setEditOpen(false);
                }}
                disabled={!canSaveView}
              >
                Save view
              </button>
              <button
                type="button"
                className="top-nav__edit-item"
                role="menuitem"
                onClick={() => {
                  onResetView?.();
                  setEditOpen(false);
                }}
                disabled={!canSaveView || !hasSavedView}
              >
                Reset view
              </button>
            </div>
          )}
        </div>
        <FullscreenButton
          isFullscreen={isFullscreen}
          onToggle={async () => {
            try {
              if (document.fullscreenElement) {
                await document.exitFullscreen();
              } else {
                await document.documentElement.requestFullscreen();
              }
            } catch {}
          }}
        />
        <div className="top-nav__settings-wrap" ref={settingsRef}>
          <button
            type="button"
            className={`icon-button icon-button--compact ${settingsOpen ? "is-active" : ""}`}
            aria-label={settingsOpen ? "Hide tile mode options" : "Show tile mode options"}
            aria-expanded={settingsOpen}
            aria-haspopup="menu"
            onClick={() => setSettingsOpen((value) => !value)}
            title="Tile mode"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M10.3 2.9h3.4l.5 2a7.8 7.8 0 0 1 1.7.7l1.8-1.1 2.4 2.4-1.1 1.8c.3.5.5 1.1.7 1.7l2 .5v3.4l-2 .5a7.8 7.8 0 0 1-.7 1.7l1.1 1.8-2.4 2.4-1.8-1.1a7.8 7.8 0 0 1-1.7.7l-.5 2h-3.4l-.5-2a7.8 7.8 0 0 1-1.7-.7l-1.8 1.1-2.4-2.4 1.1-1.8a7.8 7.8 0 0 1-.7-1.7l-2-.5v-3.4l2-.5a7.8 7.8 0 0 1 .7-1.7L4.5 6.9 6.9 4.5l1.8 1.1a7.8 7.8 0 0 1 1.7-.7l.5-2Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
          {settingsOpen && (
            <div className="top-nav__settings-menu" role="menu" aria-label="Tile mode">
              {[
                ["online", "Online (OSM)"],
                ["satellite", "Satellite (Esri)"],
                ["google_street", "Google Street"],
                ["google_satellite", "Google Satellite"],
                ["google_hybrid", "Google Hybrid"],
                ["offline", "Offline"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tileMode === mode}
                  className={`top-nav__settings-item ${tileMode === mode ? "is-active" : ""}`}
                  onClick={() => {
                    setTileMode(mode);
                    setSettingsOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

function FullscreenButton({ isFullscreen, onToggle }) {
  return (
    <button
      type="button"
      className="icon-button icon-button--compact"
      onClick={onToggle}
      aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
      title={isFullscreen ? "Exit full screen" : "Enter full screen"}
      aria-pressed={isFullscreen}
    >
      {isFullscreen ? (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m8 8-5-5M16 8l5-5M8 16l-5 5M16 16l5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m9 9-6-6M15 9l6-6M9 15l-6 6M15 15l6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
