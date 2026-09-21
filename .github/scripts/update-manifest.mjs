// Reads a freshly-built .pmtiles file's header (bounds, zoom range) and
// inserts/updates its entry in data/regions/regions-manifest.json.
// Usage: node update-manifest.mjs <path-to-pmtiles> <region-name> <region-label> <attribution>
import fs from "node:fs";
import path from "node:path";
import { PMTiles } from "pmtiles";

class FileSource {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, "r");
  }
  getKey() {
    return "local";
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
}

const [, , pmtilesPath, regionName, regionLabel, attribution] = process.argv;
if (!pmtilesPath || !regionName || !regionLabel) {
  console.error("Usage: node update-manifest.mjs <pmtiles-path> <name> <label> [attribution]");
  process.exit(1);
}

const p = new PMTiles(new FileSource(pmtilesPath));
const header = await p.getHeader();

const manifestPath = path.join("data", "regions", "regions-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const entry = {
  name: regionName,
  label: regionLabel,
  file: `${regionName}.pmtiles`,
  attribution: attribution || "Data © OpenStreetMap contributors, ODbL.",
  center: [header.centerLon, header.centerLat],
  bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
  minZoom: header.minZoom,
  maxZoom: header.maxZoom,
};

const existingIndex = manifest.regions.findIndex((r) => r.name === regionName);
if (existingIndex >= 0) {
  manifest.regions[existingIndex] = entry;
} else {
  manifest.regions.push(entry);
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("Updated manifest with:", JSON.stringify(entry, null, 2));
