document.getElementById("year").textContent = new Date().getFullYear();

const info = document.getElementById("releaseInfo");
const fallback = document.getElementById("releaseFallback");
const notes = document.getElementById("releaseNotes");
const notesContent = document.getElementById("releaseNotesContent");
const downloadLinks = [document.getElementById("downloadButton"), document.getElementById("navDownload"), ...document.querySelectorAll("[data-download]")];
const runtimeConfig = window.MADRADOR_CONFIG || {};
const onStaticPages = location.hostname === "madrador60.github.io";
const apiUrl = String(runtimeConfig.apiUrl || (onStaticPages ? "" : location.origin)).replace(/\/+$/, "");
const releaseEndpoint = apiUrl
  ? `${apiUrl}/api/releases/latest`
  : "https://api.github.com/repos/Madrador60/partager-son-ecran/releases/latest";

// Repli par défaut : la page « dernière version » de GitHub fonctionne toujours.
const LATEST_PAGE = "https://github.com/Madrador60/partager-son-ecran/releases/latest";

function plainText(markdown) {
  return String(markdown || "").replace(/\r/g, "").replace(/^#+\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

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
    } : { ...release, downloadUrl: release.downloadUrl ? `${apiUrl}${release.downloadUrl}` : "" };
    if (!normalized.downloadUrl) throw new Error("installer unavailable");
    downloadLinks.forEach((link) => { if (link) link.href = normalized.downloadUrl; });
    const size = (normalized.size / 1024 / 1024).toFixed(0);
    const date = new Date(normalized.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    info.textContent = `Version ${normalized.version} · Windows 10 et 11 · ${size} Mo · ${date}`;
    if (normalized.releaseNotes) {
      notesContent.textContent = plainText(normalized.releaseNotes);
      notes.hidden = false;
    }
  })
  .catch(() => {
    downloadLinks.forEach((link) => { if (link) link.href = LATEST_PAGE; });
    info.textContent = "Windows 10 et 11 · 64 bits";
    fallback.hidden = false;
  });
