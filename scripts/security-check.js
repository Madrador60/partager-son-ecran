const fs = require("fs");
const checks = [
  ["preload.js", /contextIsolation:\s*true|contextBridge/],
  ["main.js", /nodeIntegration:\s*false/],
  ["signaling-server.js", /X-Content-Type-Options/],
  ["signaling-server.js", /permissions\.control/],
  ["public/app.js", /escapeHtml/],
  ["public/app.js", /SIGNALING_KEY/]
];
let failed = false;
for (const [file, pattern] of checks) {
  const content = fs.readFileSync(file, "utf8");
  const ok = pattern.test(content);
  console.log(`${ok ? "[OK]" : "[ERREUR]"} ${file} ${pattern}`);
  failed ||= !ok;
}
if (failed) process.exit(1);
