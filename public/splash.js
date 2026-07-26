const params = new URLSearchParams(location.search);
document.getElementById("version").textContent = `Version ${params.get("version") || "6.0.0"}`;
