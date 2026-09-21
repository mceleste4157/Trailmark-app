// Manages offline map regions backed by PMTiles files.
//
// A "region" is a .pmtiles archive dropped into data/regions/ (see README)
// and declared in data/regions/regions-manifest.json. "Downloading" a
// region means fetching the file once so the service worker caches it for
// offline use (see sw.js) and recording that in IndexedDB so the UI knows
// it's available without a network round-trip.
const OfflineRegions = (() => {
  let manifest = null;

  async function loadManifest() {
    if (manifest) return manifest;
    const res = await fetch("data/regions/regions-manifest.json");
    const json = await res.json();
    manifest = json.regions || [];
    return manifest;
  }

  async function listWithStatus() {
    const regions = await loadManifest();
    const downloaded = await RegionStore.listRegions();
    const downloadedNames = new Set(downloaded.map((r) => r.name));
    return regions.map((r) => ({ ...r, downloaded: downloadedNames.has(r.name) }));
  }

  async function download(region, onProgress) {
    const url = `data/regions/${region.file}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Could not fetch ${url} — make sure you've dropped the .pmtiles file into data/regions/ per the README.`
      );
    }
    // Reading the body pulls it fully into the browser's HTTP/service-worker
    // cache so it's available with no connectivity afterward.
    const reader = res.body.getReader();
    let received = 0;
    const total = Number(res.headers.get("Content-Length")) || 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (onProgress && total) onProgress(received / total);
    }
    await RegionStore.registerRegion(region.name);
  }

  async function remove(region) {
    await RegionStore.removeRegion(region.name);
    if ("caches" in window) {
      const cache = await caches.open("trailmark-tiles");
      await cache.delete(`data/regions/${region.file}`);
    }
  }

  function pmtilesUrl(region) {
    return `pmtiles://${window.location.origin}${window.location.pathname.replace(
      /index\.html$/,
      ""
    )}data/regions/${region.file}`;
  }

  return { listWithStatus, download, remove, pmtilesUrl };
})();
