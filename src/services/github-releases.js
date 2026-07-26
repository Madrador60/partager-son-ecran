const REPOSITORY = process.env.GITHUB_REPOSITORY || "Madrador60/partager-son-ecran";
const CACHE_MS = 10 * 60_000;
const INSTALLER = /^Madrador-Remote-Setup-.*\.exe$/i;
const ALLOWED_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

const cache = new Map();

async function github(path, etag) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Madrador-Remote-Website",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (etag) headers["If-None-Match"] = etag;
  return fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { headers, signal: AbortSignal.timeout(8000) });
}

function normalize(release) {
  if (!release || release.draft) throw new Error("RELEASE_INVALID");
  const asset = release.assets?.find((item) => INSTALLER.test(item.name));
  if (!asset?.browser_download_url) throw new Error("INSTALLER_NOT_FOUND");
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) throw new Error("DOWNLOAD_DOMAIN_DENIED");
  const checksum = release.assets?.find((item) => item.name === `${asset.name}.sha256`);
  return {
    version: String(release.tag_name || "").replace(/^v/i, ""),
    publishedAt: release.published_at,
    fileName: asset.name,
    size: asset.size,
    releaseName: release.name || release.tag_name,
    releaseNotes: String(release.body || "").slice(0, 20_000),
    releaseUrl: release.html_url,
    directUrl: asset.browser_download_url,
    checksumUrl: checksum?.browser_download_url || null,
    sha256: null
  };
}

async function latest(channel = "stable") {
  const previous = cache.get(channel);
  if (previous && Date.now() - previous.checkedAt < CACHE_MS) return previous.value;
  const path = channel === "stable" ? "/releases/latest" : "/releases?per_page=20";
  try {
    const response = await github(path, previous?.etag);
    if (response.status === 304 && previous) {
      previous.checkedAt = Date.now();
      return previous.value;
    }
    if (!response.ok) throw new Error(`GITHUB_${response.status}`);
    const json = await response.json();
    const release = channel === "stable" ? json : json.find((item) => !item.draft && item.prerelease);
    const value = normalize(release);
    cache.set(channel, { value, etag: response.headers.get("etag"), checkedAt: Date.now() });
    return value;
  } catch (error) {
    if (previous?.value) return previous.value;
    throw error;
  }
}

module.exports = { latest, normalize, INSTALLER, ALLOWED_HOSTS };
