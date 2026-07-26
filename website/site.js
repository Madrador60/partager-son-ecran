document.getElementById("year").textContent = new Date().getFullYear();

const info = document.getElementById("releaseInfo");
const fallback = document.getElementById("releaseFallback");
fetch("/api/releases/latest")
  .then((response) => {
    if (!response.ok) throw new Error("release unavailable");
    return response.json();
  })
  .then((release) => {
    const size = (release.size / 1024 / 1024).toFixed(1);
    const date = new Date(release.publishedAt).toLocaleDateString("fr-FR");
    info.textContent = `Version ${release.version} · Windows 10/11 64 bits · ${size} Mo · publiée le ${date}`;
  })
  .catch(() => {
    info.textContent = "Le téléchargement automatique est momentanément indisponible.";
    fallback.hidden = false;
  });
