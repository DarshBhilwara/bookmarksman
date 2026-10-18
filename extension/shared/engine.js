(function (root, factory) {
  const core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.BMCore;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BMEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const ALARM = "bookmarksman-poll";
  const RETRY_ALARM = "bookmarksman-upload-retry";
  const DEBOUNCE_MS = 7000;
  const POLL_MINUTES = 5;

  class Engine {
    constructor(api, options) {
      this.api = api;
      this.browser = options.browser;
      // Firefox Window.fetch rejects calls with an Engine as its receiver.
      this.fetch = (options.fetch || globalThis.fetch).bind(globalThis);
      this.now = options.now || (() => Date.now());
      // Firefox's Window timer methods require their native global receiver.
      // Storing the methods directly would call them with this Engine instead.
      this.timer = options.setTimeout || ((...args) => globalThis.setTimeout(...args));
      this.clearTimer = options.clearTimeout || ((...args) => globalThis.clearTimeout(...args));
      this.timerId = null;
      this.serial = Promise.resolve();
      this.listening = false;
    }

    async state() { return (await this.api.storage.local.get("bm" )).bm || {}; }
    async save(patch) {
      const state = await this.state();
      const next = Object.assign({}, state, patch);
      if (Object.prototype.hasOwnProperty.call(patch, "profile")) next.name = patch.profile;
      else if (Object.prototype.hasOwnProperty.call(patch, "name")) next.profile = patch.name;
      await this.api.storage.local.set({ bm: next });
      return next;
    }
    rememberedBinding(server, profile) {
      return server && profile ? { server, profile } : null;
    }
    enqueue(fn) {
      const next = this.serial.then(fn, fn);
      this.serial = next.catch(() => {});
      return next;
    }
    async request(server, path, options) {
      const parsed = new URL(server);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Server URL must be a plain HTTP(S) address");
      const url = parsed.href.replace(/\/+$/, "") + path;
      if (this.api.permissions && this.api.permissions.contains) {
        const pattern = parsed.protocol + "//" + parsed.hostname + "/*";
        if (!await this.api.permissions.contains({ origins: [pattern] })) {
          throw new Error("Server access permission is missing for " + parsed.hostname + ". Open the popup, click Connect, and allow server access.");
        }
      }
      const controller = new AbortController();
      const timeout = this.timer(() => controller.abort(), 12000);
      try {
        const response = await this.fetch(url, Object.assign({ headers: { "Content-Type": "application/json" }, signal: controller.signal }, options || {}));
        if (!response.ok) {
          let message = "Server returned HTTP " + response.status;
          try { const data = await response.json(); message = data.detail || message; } catch (_) {}
          const error = new Error(message); error.status = response.status; throw error;
        }
        return response.status === 204 ? null : await response.json();
      }
      catch (error) {
        if (error.name === "AbortError") throw new Error("Server request timed out: " + url);
        if (!error.status && (error.name === "NetworkError" || error.name === "TypeError")) {
          throw new Error("Request failed: " + url + ". " + error.message + " Open " + parsed.href.replace(/\/+$/, "") + "/api/health in this browser to check connectivity; if it loads, check the extension's server permission and browser console.");
        }
        throw error;
      }
      finally { this.clearTimer(timeout); }
    }
    async localTree() {
      const tree = await this.api.bookmarks.getTree();
      return Core.normalizeBrowserTree(tree);
    }
    async profile(server, name) { return Core.validateProfile(await this.request(server, "/api/profiles/" + encodeURIComponent(name)), name); }
    async serverStatus(server) {
      await this.request(server, "/api/health");
      return this.request(server, "/api/profiles");
    }
    async connect(server) {
      return this.enqueue(async () => {
        if (server) await this.save({ serverSetting: server });
        let result;
        try { result = await this.serverStatus(server); }
        catch (error) { await this.save({ connected: false, error: error.message }); throw error; }
        const state = await this.state();
        if (state.restore) throw new Error("Recover the interrupted bookmark restore before changing servers");
        if (state.server !== server) {
          const lastSyncedBinding = state.lastSyncedBinding || this.rememberedBinding(state.server, state.profile || state.name);
          if (state.profile) {
            const local = await this.localTree();
            if (state.dirty || !state.baseline || !Core.equal(local, state.baseline)) await this.snapshot("Unbound while connecting to another server", local);
          }
          const patch = { server, serverSetting: server, connected: true, profile: null, name: null, auto: false, dirty: false, baseline: null, last_seen_server_updated_at: null, status: "Connected; choose a profile", error: "" };
          if (lastSyncedBinding) patch.lastSyncedBinding = lastSyncedBinding;
          await this.save(patch);
          await this.configureAlarm(false);
        } else await this.save({ serverSetting: server, connected: true, status: state.profile ? state.status : "Connected; choose a profile", error: "" });
        return result;
      });
    }
    async snapshot(label, tree) {
      const state = await this.state();
      const backups = Array.isArray(state.backups) ? state.backups.slice() : [];
      const createdAt = this.now();
      const id = createdAt + "-" + Math.random().toString(36).slice(2);
      backups.unshift({ id, label, created_at: createdAt, tree: tree || await this.localTree() });
      const retained = backups.slice(0, 10);
      // A failed recovery must never rotate away its original rollback tree.
      const pinned = state.restore && backups.find(b => b.id === state.restore.backup);
      if (pinned && !retained.some(b => b.id === pinned.id)) retained[retained.length - 1] = pinned;
      await this.save({ backups: retained });
      return backups[0];
    }
    async preview(server, name) {
      const [local, remote] = await Promise.all([this.localTree(), this.profile(server, name)]);
      return { localCount: Core.count(local), serverCount: Core.count(remote.tree), updated_at: remote.updated_at, tree: remote.tree };
    }
    async selectProfile(server, name) {
      return this.enqueue(async () => {
        const state = await this.state();
        if (!state.connected || state.server !== server) throw new Error("Connect to this server before selecting a profile");
        if (state.restore) throw new Error("Recover the interrupted bookmark restore before selecting a profile");
        let profile;
        try { profile = await this.profile(server, name); }
        catch (error) {
          if (error.status !== 404) throw error;
          const tree = await this.localTree();
          try {
            profile = Core.validateProfile(await this.request(server, "/api/profiles/" + encodeURIComponent(name), { method: "POST", body: JSON.stringify({ tree }) }), name);
          } catch (createError) {
            if (createError.status !== 409) throw createError;
            // A concurrent client created the name after our 404. Treat it as
            // existing and require the normal replacement confirmation.
            profile = await this.profile(server, name);
            return { created: false, localCount: Core.count(tree), serverCount: Core.count(profile.tree), profile };
          }
          await this.save({ server, connected: true, profile: name, auto: true, dirty: false, baseline: tree, last_seen_server_updated_at: profile.updated_at, lastSync: this.now(), status: "Synced", error: "", restore: null, lastSyncedBinding: this.rememberedBinding(server, name) });
          await this.configureAlarm(true);
          return { created: true, localCount: Core.count(tree), serverCount: Core.count(tree), profile };
        }
        const local = await this.localTree();
        return { created: false, localCount: Core.count(local), serverCount: Core.count(profile.tree), profile };
      });
    }
    async bind(server, name, profile) {
      return this.enqueue(async () => {
        await this.apply(profile.tree, profile.updated_at, { server, profile: name, auto: true });
        await this.configureAlarm(true);
        return this.state();
      });
    }
    async apply(tree, timestamp, config) {
      const desired = Core.cleanTree(tree);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Invalid server revision");
      const previousState = await this.state();
      if (previousState.restore && !(config && config.recoveryBackupId)) throw new Error("Recover the interrupted bookmark restore before applying another tree");
      const destinationRoots = await this.nativeRoots();
      for (const name of Core.ROOTS) {
        if (desired.roots[name].length && !destinationRoots[name] && !destinationRoots.other) throw new Error("Browser has no safe fallback root for " + name + "; local bookmarks were not changed");
      }
      const before = await this.localTree();
      const backup = await this.snapshot("Before remote restore", before);
      const restore = { started_at: this.now(), target: desired, timestamp, backup: config && config.recoveryBackupId || backup.id, config: config || {}, phase: "clearing" };
      await this.save({ restore, status: "Applying server bookmarks", error: "" });
      try {
        await this.clearUserRoots();
        await this.save({ restore: Object.assign({}, restore, { phase: "creating" }) });
        await this.createTree(desired);
        const actual = await this.localTree();
        if (!Core.equal(actual, desired)) throw new Error("Browser bookmark tree verification failed");
        const current = await this.state();
        const conflict = !!(config && config.conflict);
        const server = config && config.server || current.server;
        const profile = config && config.profile || current.profile;
        const patch = { server, profile, auto: config && config.auto !== undefined ? config.auto : current.auto, dirty: false, baseline: desired, last_seen_server_updated_at: timestamp, lastSync: this.now(), status: conflict ? "Conflict resolved: server version applied; local snapshot preserved" : "Synced", error: "", restore: null, conflict: conflict ? "Pending local copy preserved" : "" };
        if (!(config && config.recovery)) patch.lastSyncedBinding = this.rememberedBinding(server, profile);
        await this.save(patch);
      } catch (error) {
        await this.save({ status: "Restore failed; local snapshot preserved", error: error.message, restore: Object.assign({}, restore, { phase: "failed", error: error.message }), auto: false, dirty: true });
        throw error;
      }
    }
    async clearUserRoots() {
      const roots = await this.nativeRoots();
      const ids = [...new Set(Object.values(roots).map(String))];
      if (!ids.length) throw new Error("Could not identify a permanent bookmark root; refusing to clear bookmarks");
      for (const id of ids) {
        for (const child of await this.api.bookmarks.getChildren(id)) {
          if (child.type === "separator" || child.url !== undefined) await this.api.bookmarks.remove(child.id);
          else await this.api.bookmarks.removeTree(child.id);
        }
      }
    }
    async nativeRoots() {
      const { found, unknown } = Core.nativeRoots(await this.api.bookmarks.getTree());
      if (unknown.length) throw new Error("Unknown or managed bookmark root found; refusing to replace bookmarks");
      const mapped = {};
      for (const key of Object.keys(found)) mapped[key] = found[key].id;
      if (!Object.keys(mapped).length) throw new Error("Could not identify permanent bookmark roots; refusing to replace bookmarks");
      return mapped;
    }
    async createTree(tree) {
      const native = await this.nativeRoots();
      for (const name of Core.ROOTS) {
        const dest = native[name];
        if (dest) await this.createChildren(tree.roots[name], dest);
        else if (tree.roots[name].length) {
          const fallbackParent = native.other;
          if (!fallbackParent) throw new Error("Browser has no safe bookmark root for " + name);
          const folder = await this.api.bookmarks.create({ parentId: fallbackParent, title: Core.fallbackName(name) });
          await this.createChildren(tree.roots[name], folder.id);
        }
      }
    }
    async createChildren(nodes, parentId) {
      let index = 0;
      for (const item of nodes || []) {
        if (item.type === "separator") {
          const position = index++;
          if (this.browser) {
            try { await this.api.bookmarks.create({ parentId, index: position, type: "separator" }); continue; }
            catch (_) { /* Keep separator order through a reserved marker folder when unsupported. */ }
          }
          await this.api.bookmarks.create({ parentId, index: position, title: Core.SEPARATOR });
        }
        else if (item.type === "bookmark") await this.api.bookmarks.create({ parentId, index: index++, title: item.title, url: item.url });
        else {
          const folder = await this.api.bookmarks.create({ parentId, index: index++, title: item.title });
          await this.createChildren(item.children, folder.id);
        }
      }
    }
    async sync(automatic) {
      return this.enqueue(() => this.syncUnsafe(automatic));
    }
    async syncUnsafe(automatic) {
      try {
        const s = await this.state();
        if (automatic && !s.auto) return s;
        if (s.importing) {
          if (automatic) return s;
          throw new Error("Wait for the browser's bookmark import to finish before syncing");
        }
        if (!s.server || !s.profile) throw new Error("Configure a server and profile first");
        if (s.restore) throw new Error("A bookmark restore needs recovery before syncing");
        const server = await this.profile(s.server, s.profile);
        const local = await this.localTree();
        const dirty = !!s.dirty || !s.baseline || !Core.equal(local, s.baseline);
        if (server.updated_at !== s.last_seen_server_updated_at && dirty) {
          await this.snapshot("Pending local changes lost to server conflict", local);
          await this.apply(server.tree, server.updated_at, { server: s.server, profile: s.profile, auto: s.auto, conflict: true });
          return this.state();
        }
        if (server.updated_at !== s.last_seen_server_updated_at && !dirty) {
          await this.apply(server.tree, server.updated_at, { server: s.server, profile: s.profile, auto: s.auto });
          return this.state();
        }
        if (dirty) {
          const updated = Core.validateProfile(await this.request(s.server, "/api/profiles/" + encodeURIComponent(s.profile), { method: "PUT", body: JSON.stringify({ tree: local, base_updated_at: s.last_seen_server_updated_at }) }), s.profile);
          const afterUpload = await this.localTree();
          const changedDuringUpload = !Core.equal(local, afterUpload);
          await this.save({ dirty: changedDuringUpload, baseline: changedDuringUpload ? local : afterUpload, last_seen_server_updated_at: updated.updated_at, lastSync: this.now(), status: changedDuringUpload ? "More local changes pending" : "Synced", error: "", lastSyncedBinding: this.rememberedBinding(s.server, s.profile) });
          if (changedDuringUpload) this.scheduleUpload();
        } else await this.save({ lastSync: this.now(), status: "Synced", error: "", lastSyncedBinding: this.rememberedBinding(s.server, s.profile) });
        return this.state();
      } catch (error) {
        await this.save({ status: error.status === 409 ? "Conflict" : "Sync failed", error: error.message });
        if (error.status === 409) {
          const s = await this.state();
          await (async () => {
            const local = await this.localTree();
            await this.snapshot("Pending local changes lost to server conflict", local);
            const latest = await this.profile(s.server, s.profile);
            await this.apply(latest.tree, latest.updated_at, { server: s.server, profile: s.profile, auto: s.auto, conflict: true });
          })();
          return this.state();
        }
        throw error;
      }
    }
    async onBookmarkEvent() {
      return this.enqueue(() => this.onBookmarkEventUnsafe());
    }
    async onBookmarkEventUnsafe() {
      const s = await this.state();
      if (!s.profile || s.restore) return;
      const current = await this.localTree();
      const dirty = !s.baseline || !Core.equal(current, s.baseline);
      await this.save({ dirty, status: dirty ? (s.auto ? "Local changes pending" : "Local changes saved locally; auto-sync off") : s.status });
      if (dirty && s.auto && !s.importing) {
        this.scheduleUpload();
        await this.api.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
      }
    }
    scheduleUpload() {
      if (this.timerId) this.clearTimer(this.timerId);
      this.timerId = this.timer(() => {
        this.timerId = null;
        this.state().then(s => { if (s.auto && s.profile) this.sync(true).catch(() => {}); }).catch(() => {});
      }, DEBOUNCE_MS);
    }
    startEvents() {
      if (this.listening) return;
      this.listening = true;
      const events = this.api.bookmarks;
      for (const key of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
        if (events[key] && events[key].addListener) events[key].addListener(() => this.onBookmarkEvent().catch(() => {}));
      }
      if (events.onImportBegan) events.onImportBegan.addListener(() => this.enqueue(async () => {
        if (this.timerId) { this.clearTimer(this.timerId); this.timerId = null; }
        await this.save({ importing: true, status: "Browser bookmark import in progress" });
      }).catch(() => {}));
      if (events.onImportEnded) events.onImportEnded.addListener(() => this.enqueue(async () => {
        await this.save({ importing: false });
        await this.onBookmarkEventUnsafe();
      }).catch(() => {}));
    }
    async configureAlarm(enabled) {
      const alarms = this.api.alarms;
      if (!alarms) return;
      if (!enabled) { await alarms.clear(ALARM); await alarms.clear(RETRY_ALARM); return; }
      await alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
    }
    async recover() {
      return this.enqueue(() => this.recoverUnsafe());
    }
    async recoverUnsafe() {
      const s = await this.state();
      const backup = s.restore ? (s.backups || []).find(b => b.id === s.restore.backup) : (s.backups || [])[0];
      if (!backup) throw new Error("No local recovery snapshot is available");
      await this.apply(backup.tree, s.last_seen_server_updated_at || 0, { server: s.server, profile: s.profile, auto: false, recovery: true, recoveryBackupId: s.restore && s.restore.backup });
      await this.save({ auto: false, profile: null, name: null, dirty: false, status: "Local snapshot restored; sync paused" });
      await this.configureAlarm(false);
      return this.state();
    }
    async importBackup(tree) {
      return this.enqueue(() => this.importBackupUnsafe(tree));
    }
    async importBackupUnsafe(tree) {
      const cleaned = Core.cleanTree(tree);
      await this.snapshot("Before importing recovery file");
      const state = await this.state();
      await this.apply(cleaned, 0, { auto: false, recovery: true, recoveryBackupId: state.restore && state.restore.backup });
      await this.save({ auto: false, profile: null, name: null, dirty: false, status: "Recovery file restored; sync paused" });
      await this.configureAlarm(false);
      return this.state();
    }
    async rename(name) {
      return this.enqueue(async () => {
        const s = await this.state();
        if (s.restore) throw new Error("Recover the interrupted bookmark restore before renaming a profile");
        if (!s.server || !s.profile) throw new Error("Bind a profile before renaming it");
        const result = await this.request(s.server, "/api/profiles/" + encodeURIComponent(s.profile) + "/rename", { method: "POST", body: JSON.stringify({ name, base_updated_at: s.last_seen_server_updated_at }) });
        Core.validateProfile(result, name);
        await this.save({ profile: name, last_seen_server_updated_at: result.updated_at ?? s.last_seen_server_updated_at, status: "Profile renamed", error: "", lastSyncedBinding: this.rememberedBinding(s.server, name) });
        return this.state();
      });
    }
    async setAuto(enabled) {
      return this.enqueue(async () => {
        const prior = await this.state();
        if (enabled && !prior.profile) throw new Error("Bind a profile before enabling automatic sync");
        if (enabled && prior.restore) throw new Error("Recover the interrupted bookmark restore before enabling sync");
        const s = await this.save({ auto: !!enabled });
        if (!s.auto && this.timerId) { this.clearTimer(this.timerId); this.timerId = null; }
        await this.configureAlarm(s.auto && !!s.profile);
        return this.state();
      });
    }
    async start() {
      this.startEvents();
      return this.enqueue(async () => {
        const s = await this.state();
        if (s.restore) { await this.save({ status: "Restore needs recovery", auto: false }); await this.configureAlarm(false); return; }
        if (s.importing) {
          await this.save({ importing: false, auto: false, status: "Browser import was interrupted; enable automatic sync after import finishes" });
          await this.configureAlarm(false);
          return;
        }
        if (s.server && s.profile) {
          const local = await this.localTree();
          const dirty = !s.baseline || !Core.equal(local, s.baseline);
          if (dirty !== !!s.dirty) await this.save({ dirty, status: dirty ? "Local changes pending" : s.status });
          if (s.auto) {
            await this.configureAlarm(true);
            this.sync(true).catch(() => {});
          }
        }
      });
    }
    async onAlarm(alarm) {
      if (alarm.name !== ALARM && alarm.name !== RETRY_ALARM) return;
      this.sync(true).catch(() => {});
    }
  }

  return { Engine, ALARM, DEBOUNCE_MS, POLL_MINUTES };
});
