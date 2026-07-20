const fs = require("fs");
const path = require("path");
const required = [
  "main.js","preload.js","signaling-server.js","public/index.html",
  "public/app.js","public/performance.js","public/v5-features.js",
  "v5-modules.json","assets/icon.ico"
];
let failed = false;
for (const file of required) {
  const full = path.join(__dirname, "..", file);
  const ok = fs.existsSync(full);
  console.log(`${ok ? "[OK]" : "[MANQUANT]"} ${file}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
