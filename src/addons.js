// ADDONS: optional extras that live in a `personal/<name>/` folder next to the app. Each one has an addon.json
// (what to show in the side menu and which page files to load) and, optionally, a main.js for the background side.
// The public copy of HYPERSPACE has no `personal/` folder, so nothing here runs there and nothing else depends on it.
// An addon can only add things (its own page, its own api calls named `<name>…`); it can't replace core ones.
const fs = require('fs');
const path = require('path');

function loadAddons(root, ctx) {
  const dir = path.join(root, 'personal');
  const out = { list: [], api: {} };
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const name of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name, 'addon.json'), 'utf8'));
      const base = `../personal/${name}/`;
      const item = { id: name, view: m.view || name, label: m.label || name.toUpperCase(), title: m.title || '', icon: m.icon || '', css: (m.css || []).map((f) => base + f), js: (m.js || []).map((f) => base + f) };
      if (m.main) {
        const calls = require(path.join(dir, name, m.main)).register(ctx) || {};
        for (const [k, fn] of Object.entries(calls)) if (typeof fn === 'function' && k.startsWith(name)) out.api[k] = fn;
      }
      out.list.push(item);
    } catch (e) { console.error(`addon ${name} skipped:`, e.message); }
  }
  return out;
}
module.exports = { loadAddons };
