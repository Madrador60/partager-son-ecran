"use strict";

class SessionStore {
  async has(_code) { throw new Error("NOT_IMPLEMENTED"); }
  async get(_code) { throw new Error("NOT_IMPLEMENTED"); }
  async set(_code, _session) { throw new Error("NOT_IMPLEMENTED"); }
  async delete(_code) { throw new Error("NOT_IMPLEMENTED"); }
  async entries() { throw new Error("NOT_IMPLEMENTED"); }
  async close() {}
}

module.exports = { SessionStore };
