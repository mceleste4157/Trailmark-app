// Cell tower locations as a rough coverage proxy, via OpenCellID
// (opencellid.org) — a free, crowdsourced database of cell tower
// locations. This is NOT true signal-strength coverage prediction (that
// data isn't freely available from carriers), but tower proximity is a
// reasonable rule of thumb for trip planning: fewer/no towers nearby
// usually means weak or no signal.
//
// Needs a free API key Trailmark can't generate itself: sign up at
// https://opencellid.org (free), Account -> API Keys, paste it below.
// Stays completely inert (the toggle button won't appear) until set.
const OPENCELLID_API_KEY = "";

const CellCoverage = {
  enabled: Boolean(OPENCELLID_API_KEY),

  // Fetches tower locations within the given MapLibre bounds. Returns
  // [{lat, lng, radio, range}], where `range` (meters) is OpenCellID's
  // own rough estimate of that tower's coverage radius.
  async fetchTowers(bounds) {
    if (!this.enabled) throw new Error("Cell coverage isn't configured (see js/cell-coverage.js).");
    const url = new URL("https://opencellid.org/cell/getInArea");
    url.searchParams.set("key", OPENCELLID_API_KEY);
    url.searchParams.set(
      "BBOX",
      `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "500");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenCellID request failed: ${res.status}`);
    const data = await res.json();
    return (data.cells || []).map((c) => ({
      lat: c.lat,
      lng: c.lon,
      radio: c.radio || "cell",
      range: c.range || 2000,
    }));
  },

  // A GeoJSON FeatureCollection of circles approximating each tower's
  // coverage radius, for use as a MapLibre fill source — good enough
  // for "roughly where am I likely to have signal" at a glance.
  towersToCircleGeoJSON(towers) {
    return {
      type: "FeatureCollection",
      features: towers.map((t) => ({
        type: "Feature",
        properties: { radio: t.radio },
        geometry: { type: "Point", coordinates: [t.lng, t.lat] },
      })),
    };
  },
};
