// Manages offline map regions backed by PMTiles files.
//
// A "region" is a .pmtiles archive dropped into data/regions/ (see README)
// and declared in data/regions/regions-manifest.json. "Downloading" a
// region fetches the file once, stores the bytes in the Cache Storage API
// (survives restarts, same cache sw.js uses for its own cache-first
// handling), and registers it in IndexedDB so the UI knows it's available
// without a network round-trip.
//
// PMTiles reads an archive via range requests (a few KB at a time, not the
// whole file per tile). A plain `fetch(url)` relies on the browser's
// ambient HTTP cache to serve those later range requests correctly, which
// is unreliable in practice — Chrome will sometimes answer a Range request
// against a fully-cached URL with a 200 and the whole body instead of a
// 206 partial response, and pmtiles.js treats that as a fatal error. To
// sidestep it, downloaded regions are served through a custom PMTiles
// `Source` (see CachedRegionSource below) that reads the archive's bytes
// out of memory/Cache Storage itself and slices the requested range,
// rather than leaning on the browser to answer ranged fetches correctly.
const OfflineRegions = (() => {
  const TILES_CACHE = "trailmark-tiles";
  let manifest = null;
  const sourceInstances = new Map(); // region.name -> CachedRegionSource

  function regionUrl(region) {
    return `data/regions/${region.file}`;
  }

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

  // Implements the pmtiles.js `Source` interface (getKey/getBytes) backed
  // by an in-memory copy of the archive, populated from Cache Storage (or
  // network as a last resort). This is what makes offline region reads
  // fast and immune to Range-request quirks.
  class CachedRegionSource {
    constructor(region) {
      this.region = region;
      // No "pmtiles://" prefix here — MapLibre's PMTiles protocol strips
      // that prefix off the source URL itself before looking an instance
      // up by key, so the key it looks up never has the prefix either.
      this.key = `region/${region.name}`;
      this.bufferPromise = null;
    }

    getKey() {
      return this.key;
    }

    async _loadBuffer() {
      const cache = await caches.open(TILES_CACHE);
      const cached = await cache.match(regionUrl(this.region));
      if (cached) return cached.arrayBuffer();
      const res = await fetch(regionUrl(this.region));
      if (!res.ok) throw new Error(`Could not load region archive: ${regionUrl(this.region)}`);
      return res.arrayBuffer();
    }

    async getBytes(offset, length) {
      if (!this.bufferPromise) this.bufferPromise = this._loadBuffer();
      const buffer = await this.bufferPromise;
      return { data: buffer.slice(offset, offset + length) };
    }
  }

  function getSource(region) {
    if (!sourceInstances.has(region.name)) {
      sourceInstances.set(region.name, new CachedRegionSource(region));
    }
    return sourceInstances.get(region.name);
  }

  async function download(region, onProgress) {
    const url = regionUrl(region);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Could not fetch ${url} — make sure you've dropped the .pmtiles file into data/regions/ per the README.`
      );
    }

    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress && total) onProgress(received / total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    const cache = await caches.open(TILES_CACHE);
    await cache.put(url, new Response(bytes, { headers: res.headers }));
    // Prime the in-memory source immediately so activating the region
    // right after download doesn't need to re-read from Cache Storage.
    getSource(region).bufferPromise = Promise.resolve(bytes.buffer);

    await RegionStore.registerRegion(region.name);
  }

  async function remove(region) {
    await RegionStore.removeRegion(region.name);
    sourceInstances.delete(region.name);
    const cache = await caches.open(TILES_CACHE);
    await cache.delete(regionUrl(region));
  }

  return { listWithStatus, download, remove, getSource };
})();
