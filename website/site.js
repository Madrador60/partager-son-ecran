document.getElementById("year").textContent = new Date().getFullYear();

const info = document.getElementById("releaseInfo");
const fallback = document.getElementById("releaseFallback");
const notes = document.getElementById("releaseNotes");
const notesContent = document.getElementById("releaseNotesContent");
const runtimeConfig = window.MADRADOR_CONFIG || {};
const onStaticPages = location.hostname === "madrador60.github.io";
const apiUrl = String(runtimeConfig.apiUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const releaseEndpoint = apiUrl
  ? `${apiUrl}/api/releases/latest`
  : "https://api.github.com/repos/Madrador60/partager-son-ecran/releases/latest";
fetch(releaseEndpoint)
  .then((response) => {
    if (!response.ok) throw new Error("release unavailable");
    return response.json();
  })
  .then((release) => {
    const asset = release.assets?.find((item) => /^Madrador-Remote-Setup-.*\.exe$/i.test(item.name));
    const normalized = asset ? {
      version: String(release.tag_name || "").replace(/^v/, ""),
      size: asset.size,
      publishedAt: release.published_at,
      releaseNotes: release.body || "",
      downloadUrl: asset.browser_download_url
    } : { ...release, downloadUrl: `${apiUrl}/api/download/latest/windows` };
    if (!normalized.downloadUrl) throw new Error("installer unavailable");
    document.getElementById("downloadButton").href = normalized.downloadUrl;
    document.getElementById("navDownload").href = normalized.downloadUrl;
    const size = (normalized.size / 1024 / 1024).toFixed(1);
    const date = new Date(normalized.publishedAt).toLocaleDateString("fr-FR");
    info.textContent = `Version ${normalized.version} · Windows 10/11 64 bits · ${size} Mo · publiée le ${date}`;
    if (normalized.releaseNotes) {
      notesContent.textContent = normalized.releaseNotes;
      notes.hidden = false;
    }
  })
  .catch(() => {
    info.textContent = "Le téléchargement automatique est momentanément indisponible.";
    fallback.hidden = false;
  });
