"use strict";

const { MemorySessionStore } = require("./memory-session-store");

async function createSessionStore({ redisUrl = process.env.REDIS_URL } = {}) {
  if (!redisUrl) return new MemorySessionStore();
  const { createClient } = require("redis");
  const client = createClient({ url: redisUrl });
  client.on("error", (error) => console.error(JSON.stringify({ level: "error", code: "REDIS_ERROR", message: error.message })));
  await client.connect();
  const { RedisSessionStore } = require("./redis-session-store");
  return new RedisSessionStore(client);
}

module.exports = { createSessionStore };
