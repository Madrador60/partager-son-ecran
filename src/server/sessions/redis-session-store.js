"use strict";

const { SessionStore } = require("./session-store");

function encode(session) {
  return JSON.stringify({ ...session, pending: [...(session.pending || [])] });
}

function decode(value) {
  if (!value) return null;
  const session = JSON.parse(value);
  session.pending = new Set(session.pending || []);
  return session;
}

class RedisSessionStore extends SessionStore {
  constructor(client, prefix = "madrador:session:") {
    super();
    this.client = client;
    this.prefix = prefix;
  }

  key(code) { return `${this.prefix}${code}`; }
  async has(code) { return Boolean(await this.client.exists(this.key(code))); }
  async get(code) { return decode(await this.client.get(this.key(code))); }
  async set(code, session) {
    const ttl = session.expiresAt ? Math.max(1, session.expiresAt - Date.now()) : null;
    if (ttl) await this.client.set(this.key(code), encode(session), { PX: ttl });
    else await this.client.set(this.key(code), encode(session));
  }
  async delete(code) { return Boolean(await this.client.del(this.key(code))); }
  async entries() {
    const keys = await this.client.keys(`${this.prefix}*`);
    const values = keys.length ? await this.client.mGet(keys) : [];
    return keys.map((key, index) => [key.slice(this.prefix.length), decode(values[index])]).filter(([, value]) => value);
  }
  async close() { if (this.client.isOpen) await this.client.quit(); }
}

module.exports = { RedisSessionStore };
