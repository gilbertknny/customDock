// Loads, merges, saves and watches the user config (userData/config.json).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const defaults = require('../config.default.json');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

let current = null;
let selfWrite = 0;

function load() {
  const f = file();
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(defaults, null, 2));
    } else {
      console.error('[config] invalid config.json, using defaults:', err.message);
    }
  }
  current = merge(defaults, user);
  if (migrate(current)) save(current);
  return current;
}

// One-time upgrades for configs created by older versions. Each runs once,
// so removing e.g. the Start button later sticks.
function migrate(cfg) {
  cfg.migrations = cfg.migrations || {};
  let changed = false;
  if (!cfg.migrations.startButton) {
    cfg.migrations.startButton = true;
    const items = cfg.dock.items || [];
    if (!items.some((i) => i && i.path === 'frost:start')) {
      const start = defaults.dock.items.find((i) => i.path === 'frost:start');
      if (start) items.unshift({ ...start });
    }
    changed = true;
  }
  return changed;
}

function get() {
  return current || load();
}

function save(next) {
  current = next;
  selfWrite = Date.now();
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
}

function update(mutator) {
  const next = JSON.parse(JSON.stringify(get()));
  mutator(next);
  save(next);
  return next;
}

function watch(onChange) {
  let timer = null;
  try {
    fs.watch(file(), () => {
      if (Date.now() - selfWrite < 800) return; // ignore our own writes
      clearTimeout(timer);
      timer = setTimeout(() => onChange(load()), 250);
    });
  } catch (err) {
    console.error('[config] watch failed:', err.message);
  }
}

module.exports = { load, get, save, update, watch, file, defaults };
