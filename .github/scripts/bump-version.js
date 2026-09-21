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
