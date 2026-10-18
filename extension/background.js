/* global browser, chrome, importScripts, BMEngine, BMCore */
(function () {
  "use strict";
  if (typeof importScripts === "function" && typeof BMCore === "undefined") importScripts("shared/core.js", "shared/engine.js");
  const api = typeof browser !== "undefined" ? browser : chrome;
  const engine = new BMEngine.Engine(api, { browser: typeof browser !== "undefined" ? browser : null });
  const ownId = api.runtime.id;

  async function dispatch(message) {
    switch (message.action) {
      case "status": return engine.state();
      case "list": {
        return engine.connect(message.server);
      }
      case "preview": return engine.preview(message.server, message.name);
      case "bind": {
        const profile = message.profile || await engine.profile(message.server, message.name);
        return engine.bind(message.server, message.name, profile);
      }
      case "selectProfile": return engine.selectProfile(message.server, message.name);
      case "sync": return engine.sync();
      case "auto": {
        const next = await engine.setAuto(!!message.enabled);
        if (next.auto) engine.sync(true).catch(() => {});
        return next;
      }
      case "rename": return engine.rename(message.name);
      case "recover": return engine.recover();
      case "backups": return (await engine.state()).backups || [];
      case "importBackup": return engine.importBackup(message.tree);
      default: throw new Error("Unknown bookmarksman action");
    }
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== ownId || !message || !message.action) return false;
    dispatch(message).then(value => sendResponse({ ok: true, value }), error => sendResponse({ ok: false, error: error.message, status: error.status || 0 }));
    return true;
  });

  if (api.alarms && api.alarms.onAlarm) api.alarms.onAlarm.addListener(alarm => engine.onAlarm(alarm).catch(() => {}));
  api.runtime.onStartup.addListener(() => engine.start().catch(() => {}));
  api.runtime.onInstalled.addListener(() => engine.start().catch(() => {}));
  engine.start().catch(() => {});
})();
