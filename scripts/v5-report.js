const modules = require("../v5-modules.json");
for (const m of modules) console.log(`${m.id}. ${m.name}: ${m.status} — ${m.detail}`);
