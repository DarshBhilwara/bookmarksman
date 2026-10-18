(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BMCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROOTS = ["toolbar", "menu", "other", "mobile"];
  const FALLBACK_PREFIX = "[bookmarksman-root:";
  const FALLBACK_SUFFIX = "]";
  const SEPARATOR = "[bookmarksman:separator]";

  function node(type, title, extra) {
    return Object.assign({ type, title: String(title || "") }, extra || {});
  }

  function portableChildren(items) {
    const out = [];
    for (const item of items || []) {
      if (item.url !== undefined && item.url !== null) {
        out.push(node("bookmark", item.title, { url: item.url }));
      } else if (item.type === "separator" || (item.title === SEPARATOR && Array.isArray(item.children) && item.children.length === 0)) {
        out.push({ type: "separator" });
      } else if (item.children) {
        const fallback = parseFallback(item.title);
        if (fallback) {
          // A fallback folder from a browser without this root is unpacked at
          // the destination's native root whenever possible.
          out.push(node("folder", fallbackName(fallback), { children: portableChildren(item.children) }));
        } else {
          out.push(node("folder", item.title, { children: portableChildren(item.children) }));
        }
      }
    }
    return out;
  }

  function nativeRoots(tree) {
    const top = Array.isArray(tree) ? tree : [];
    let immediate = top;
    if (top.length === 1 && top[0].children && ["0", "root________"].includes(String(top[0].id))) immediate = top[0].children;
    const byId = { "1": "toolbar", "2": "other", "3": "mobile", "toolbar_____": "toolbar", "menu________": "menu", "unfiled_____": "other", "mobile______": "mobile" };
    const found = {}, unknown = [];
    for (const item of immediate) {
      const name = byId[String(item.id)];
      if (!name || !item.children) { unknown.push(item); continue; }
      if (found[name]) throw new Error("Duplicate permanent bookmark root: " + name);
      found[name] = item;
    }
    if (!found.toolbar || !found.other) throw new Error("Required permanent bookmark roots are missing");
    return { found, unknown };
  }

  function normalizeBrowserTree(tree) {
    const roots = {};
    const { found, unknown } = nativeRoots(tree);
    if (unknown.length) throw new Error("Unknown bookmark root layout; refusing to sync an incomplete tree");
    for (const name of ROOTS) roots[name] = portableChildren(found[name] && found[name].children || []);
    return cleanTree({ roots });
  }

  function fallbackName(name) { return FALLBACK_PREFIX + name + FALLBACK_SUFFIX; }
  function parseFallback(title) {
    const match = String(title || "").match(/^\[bookmarksman-root:(toolbar|menu|other|mobile)\]$/);
    return match ? match[1] : null;
  }

  function cleanTree(tree) {
    validateTree(tree);
    const roots = {};
    for (const name of ROOTS) roots[name] = cleanNodes(tree && tree.roots && tree.roots[name] || []);
    // Unpack known portability folders into their matching shared root. The
    // folder is retained as a normal folder if that root already has content,
    // avoiding collisions or accidental loss of user-created folders.
    for (const name of ROOTS) {
      const index = roots.other.findIndex(n => n.type === "folder" && parseFallback(n.title) === name);
      if (index >= 0) {
        const contents = roots.other[index].children;
        if (roots[name].length) throw new Error("Bookmark tree contains duplicate data for the " + name + " root");
        roots[name] = contents;
        roots.other.splice(index, 1);
      }
    }
    return { roots };
  }

  function cleanNodes(nodes) {
    return (nodes || []).map(n => {
      if (n.type === "bookmark") return node("bookmark", n.title, { url: n.url });
      if (n.type === "folder") return node("folder", n.title, { children: cleanNodes(n.children) });
      if (n.type === "separator") return { type: "separator" };
      throw new Error("Invalid bookmark node type");
    });
  }

  function validateTree(tree) {
    if (!tree || typeof tree !== "object" || Array.isArray(tree) || Object.keys(tree).length !== 1 || !tree.roots || typeof tree.roots !== "object" || Array.isArray(tree.roots)) throw new Error("Bookmark tree must contain a roots object");
    const names = Object.keys(tree.roots).sort();
    if (JSON.stringify(names) !== JSON.stringify(ROOTS.slice().sort())) throw new Error("Bookmark tree must contain toolbar, menu, other, and mobile roots");
    let count = 0;
    function visit(nodes, depth) {
      if (!Array.isArray(nodes)) throw new Error("Bookmark children must be arrays");
      for (const n of nodes) {
        count++;
        if (count > 50000 || depth > 64) throw new Error("Bookmark tree exceeds supported size or depth");
        if (!n || typeof n !== "object" || Array.isArray(n) || typeof n.type !== "string") throw new Error("Invalid bookmark node");
        const keys = Object.keys(n).sort();
        if (n.type === "bookmark") {
          if (JSON.stringify(keys) !== JSON.stringify(["title", "type", "url"]) || typeof n.title !== "string" || n.title.length > 4096 || typeof n.url !== "string" || n.url.length < 1 || n.url.length > 8192 || !/^[a-z][a-z0-9+.-]*:/i.test(n.url)) throw new Error("Invalid bookmark node");
        } else if (n.type === "folder") {
          if (JSON.stringify(keys) !== JSON.stringify(["children", "title", "type"]) || typeof n.title !== "string" || n.title.length > 4096) throw new Error("Invalid bookmark folder");
          visit(n.children, depth + 1);
        } else if (n.type === "separator") {
          if (JSON.stringify(keys) !== JSON.stringify(["type"])) throw new Error("Invalid bookmark separator");
        } else throw new Error("Invalid bookmark node type");
      }
    }
    for (const name of ROOTS) visit(tree.roots[name], 1);
    return tree;
  }

  function validateProfile(profile, expectedName) {
    if (!profile || profile.schema_version !== 1 || typeof profile.name !== "string" || (expectedName && profile.name !== expectedName) || !Number.isSafeInteger(profile.updated_at) || profile.updated_at < 0) throw new Error("Server returned an invalid bookmark profile");
    validateTree(profile.tree);
    return profile;
  }

  function count(tree) {
    let total = 0;
    function walk(nodes) { for (const n of nodes || []) { if (n.type === "bookmark") total++; else walk(n.children); } }
    for (const name of ROOTS) walk(tree && tree.roots && tree.roots[name]);
    return total;
  }

  function equal(a, b) { return JSON.stringify(cleanTree(a)) === JSON.stringify(cleanTree(b)); }

  return { ROOTS, normalizeBrowserTree, nativeRoots, cleanTree, validateTree, validateProfile, count, equal, fallbackName, parseFallback, SEPARATOR };
});
