"use strict";

const crypto = require("node:crypto");

const DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

function splitUrls(value) {
  return String(value || "").split(",").map((url) => url.trim()).filter(Boolean);
}

function createIceServers(env = process.env, now = Date.now()) {
  const iceServers = [{ urls: DEFAULT_STUN }];
  const urls = splitUrls(env.MADRADOR_TURN_URL);
  if (!urls.length || !env.MADRADOR_TURN_USERNAME || !env.MADRADOR_TURN_CREDENTIAL) return iceServers;

  const lifetimeSeconds = Math.min(3600, Math.max(300, Number(env.MADRADOR_TURN_TTL_SECONDS || 1800)));
  const expiresAt = Math.floor(now / 1000) + lifetimeSeconds;
  const username = `${expiresAt}:${String(env.MADRADOR_TURN_USERNAME).replace(/[^a-zA-Z0-9_.-]/g, "")}`;
  const credential = crypto.createHmac("sha1", env.MADRADOR_TURN_CREDENTIAL).update(username).digest("base64");
  iceServers.push({ urls, username, credential, credentialType: "password" });
  return iceServers;
}

module.exports = { createIceServers, DEFAULT_STUN };
