"use strict";

const { SessionStore } = require("./session-store");

class MemorySessionStore extends SessionStore {
  constructor() {
    super();
    this.sessions = new Map();
  }

  async has(code) { return this.sessions.has(code); }
  async get(code) { return this.sessions.get(code) || null; }
  async set(code, session) { this.sessions.set(code, session); }
  async delete(code) { return this.sessions.delete(code); }
  async entries() { return [...this.sessions.entries()]; }
}

module.exports = { MemorySessionStore };
