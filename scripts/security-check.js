const fs = require("node:fs");

const checks = [
  ["main.js", /contextIsolation:\s*true/, "isolation du renderer"],
  ["main.js", /nodeIntegration:\s*false/, "Node désactivé dans l’interface"],
  ["main.js", /sandbox:\s*true/, "sandbox Electron"],
  ["public/index.html", /Content-Security-Policy/, "politique de contenu"],
  ["server/index.js", /X-Content-Type-Options/, "en-têtes HTTP"],
  ["server/index.js", /sessionFor\(socket,\s*code\)/, "appartenance aux sessions"],
  ["server/index.js", /permissions\.control/, "permission de contrôle"],
  ["server/index.js", /MAX_FILE_BYTES/, "limite des fichiers"]
];

let failed = false;
for (const [file, pattern, label] of checks) {
  const ok = pattern.test(fs.readFileSync(file, "utf8"));
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  failed ||= !ok;
}
if (failed) process.exitCode = 1;
