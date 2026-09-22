// Bumps version.json by 0.01 on every deploy and records a history entry
// summarizing the triggering commit. Run from the repo root by
// .github/workflows/deploy-pages.yml before the site is staged, so the
// deployed build always carries the new version.
const fs = require("fs");
const path = require("path");

const versionFile = path.join(__dirname, "..", "..", "version.json");
const data = JSON.parse(fs.readFileSync(versionFile, "utf8"));

const next = (Math.round((parseFloat(data.current) + 0.01) * 100) / 100).toFixed(2);

const summary = (process.env.COMMIT_MESSAGE || "").split("\n")[0].trim() || "Update";
const sha = (process.env.COMMIT_SHA || "").slice(0, 7);
const date = new Date().toISOString().slice(0, 10);

data.history = data.history || [];
data.history.unshift({ version: next, date, summary, commit: sha });
data.current = next;

fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + "\n");
console.log(`Bumped version.json to ${next}`);

// Also stamp sw.js's SHELL_CACHE with the new version so every deploy is
// guaranteed to change sw.js's bytes. That's what makes the browser notice
// there's a new service worker at all — if sw.js is byte-identical to what
// a returning visitor already has installed, the browser assumes there's
// nothing new and never re-fetches index.html/app.js/style.css, no matter
// how much those actually changed. (This bit us for ~17 releases: v1.08
// through v1.25 all shipped real fixes that nobody with the app already
// installed ever received, because SHELL_CACHE sat frozen at "v7" the
// whole time.) Tying the cache name to the version number instead of a
// hand-incremented counter means this can't be forgotten again.
const swFile = path.join(__dirname, "..", "..", "sw.js");
const swSource = fs.readFileSync(swFile, "utf8");
const swPatched = swSource.replace(
  /const SHELL_CACHE = "trailmark-shell-v[^"]*";/,
  `const SHELL_CACHE = "trailmark-shell-v${next}";`
);
if (swPatched === swSource) {
  console.error("Could not find SHELL_CACHE in sw.js to stamp — check the pattern still matches.");
  process.exit(1);
}
fs.writeFileSync(swFile, swPatched);
console.log(`Stamped sw.js SHELL_CACHE to trailmark-shell-v${next}`);
