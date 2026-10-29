#!/usr/bin/env node
/**
 * Impact core - the single place the harness computes environmental impact.
 *
 * Shared by:
 *   - extensions/impact-cost  (session footer + ledger writer)
 *   - bin/fpi-cost            (monthly report impact section)
 *   - bin/fpi-impact          (browser report data + sync)
 *
 * Data flow: raw usage rows (tokens + cost) come from session JSONL files and
 * the pi-subagents sqlite. Impact values (kWh, kgCO2e, water L) are always
 * DERIVED from the raw rows at display time, so editing impact/config.json
 * changes every report retroactively. The gitignored impact/ledger.jsonl is
 * a durable record of raw rows - session files may be compacted by the
 * rewind hook, the ledger is not.
 *
 * Assumptions (see impact/README.md for sources; all editable in
 * impact/config.json or on the report page):
 *   - kWh per 1k tokens: Epoch AI inference energy estimate, via the three
 *     impact-equivalences profiles (efficient_small / balanced / frontier).
 *   - kgCO2e per kWh: EPA eGRID 2022. US average for API providers (the
 *     datacenter location is unknown); the user's state for local models.
 *   - Water: datacenter operational cooling, 1.5 L/kWh typical (0.7-3).
 *   - Excluded: training, embodied hardware, networking, storage, user
 *     devices, upstream generation water.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename, extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const IMPACT_DIR = dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = join(IMPACT_DIR, "ledger.jsonl");
export const CONFIG_PATH = join(IMPACT_DIR, "config.json");
const STATES_PATH = join(IMPACT_DIR, "states.json");
const PROFILES_PATH = join(IMPACT_DIR, "profiles.json");
const DEFAULTS_PATH = join(IMPACT_DIR, "defaults.json");

// Harness root: $PI_CODING_AGENT_DIR is <root>/.pi/agent; sessions live there.
function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
function sessionsDir() {
  return join(agentDir(), "sessions");
}
function subagentsDb() {
  return process.env.PI_SUBAGENTS_HISTORY_DB_PATH ||
    join(process.env.PI_SUBAGENTS_HISTORY_HOME || process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "pi", "subagents", "subagents-history.sqlite");
}

// ---------------------------------------------------------------------------
// Load config: defaults.json <- config.json (user overrides) <- states/profiles
// ---------------------------------------------------------------------------

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return fallback; }
}

export function loadDefaults() {
  return readJson(DEFAULTS_PATH, {
    location: { place: "", state: "" },
    providerRegions: { default: "us", openrouter: "us", "openai-codex": "us" },
    models: {},
    prefixProfiles: { "openai-codex": "frontier_model", ollama: "efficient_small_model", local: "efficient_small_model" },
    defaultProfile: "frontier_model",
    water: { typicalLPerKWh: 1.5, minLPerKWh: 0.7, maxLPerKWh: 3.0 },
    games: {
      "cyberpunk-2077": { label: "Cyberpunk 2077 (high-end rig, 4K ultra)", watts: 400 },
      control: { label: "Control (high-end rig)", watts: 300 },
    },
  });
}

export function loadConfig() {
  return { ...loadDefaults(), ...(readJson(CONFIG_PATH, {}) || {}) };
}

export function loadProfiles() {
  return readJson(PROFILES_PATH, {
    efficient_small_model: { min: 0.01, typical: 0.03, max: 0.08 },
    balanced_model: { min: 0.05, typical: 0.15, max: 0.5 },
    frontier_model: { min: 0.2, typical: 0.6, max: 1.5 },
  });
}

export function loadStates() {
  return readJson(STATES_PATH, {});
}

export function saveConfig(config) {
  mkdirSync(IMPACT_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Profile + region resolution for a model / provider
// ---------------------------------------------------------------------------

export function profileFor(model, provider, config) {
  const models = config.models || {};
  if (models[model]) return models[model];
  if (provider && models[`${provider}/${model}`]) return models[`${provider}/${model}`];
  const prefixes = Object.keys(config.prefixProfiles || {}).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (model === p || model.startsWith(p + "/")) return config.prefixProfiles[p];
  }
  return config.defaultProfile || "frontier_model";
}

/** Region for a model: provider mapping first, else US average default.
 *  Local models (ollama/local/*) use the configured location's state. */
export function regionFor(model, config) {
  const provider = model.split("/")[0];
  if (/^(ollama|local|lmstudio|llamacpp)/.test(provider) && config.location?.state) {
    return `us-${config.location.state}`;
  }
  const regions = config.providerRegions || {};
  return regions[provider] || regions.default || "us";
}

export function regionFactor(region, config, states) {
  if (region === "us") {
    return { kgCO2ePerKWh: 0.386, label: "US average grid" };
  }
  if (region.startsWith("us-")) {
    const st = region.slice(3);
    const f = states[st];
    if (f) return { kgCO2ePerKWh: f.kgCO2ePerKWh, label: `eGRID 2022 ${f.state}` };
  }
  const custom = (config.regions || {})[region];
  if (custom) return { kgCO2ePerKWh: custom.kgCO2ePerKWh, label: custom.label || region };
  return { kgCO2ePerKWh: 0.386, label: "US average grid (fallback)" };
}

// ---------------------------------------------------------------------------
// Impact math: raw row -> impact triplet (min/typical/max for each metric)
// ---------------------------------------------------------------------------

export function computeImpact(row, config = loadConfig()) {
  const profiles = loadProfiles();
  const states = loadStates();
  const prof = profiles[profileFor(row.model, row.provider, config)] || profiles[config.defaultProfile];
  const region = regionFactor(regionFor(row.model, config), config, states);
  const water = config.water || loadDefaults().water;

  const tokens = (row.input || 0) + (row.output || 0) + (row.cacheRead || 0) + (row.cacheWrite || 0);
  const wh = { min: tokens / 1000 * prof.min, typical: tokens / 1000 * prof.typical, max: tokens / 1000 * prof.max };
  const kwh = { min: wh.min / 1000, typical: wh.typical / 1000, max: wh.max / 1000 };
  const kgCO2e = {
    min: kwh.min * region.kgCO2ePerKWh,
    typical: kwh.typical * region.kgCO2ePerKWh,
    max: kwh.max * region.kgCO2ePerKWh,
  };
  const waterL = {
    min: kwh.min * water.minLPerKWh,
    typical: kwh.typical * water.typicalLPerKWh,
    max: kwh.max * water.maxLPerKWh,
  };
  return { tokens, profile: profileFor(row.model, row.provider, config), region: region.label, kwh, kgCO2e, waterL };
}

export function sumImpact(rows, config = loadConfig()) {
  const out = { tokens: 0, kwh: 0, kgCO2e: 0, waterL: 0, cost: 0, calls: rows.length };
  for (const r of rows) {
    const imp = computeImpact(r, config);
    out.tokens += imp.tokens;
    out.kwh += imp.kwh.typical;
    out.kgCO2e += imp.kgCO2e.typical;
    out.waterL += imp.waterL.typical;
    out.cost += r.cost || 0;
  }
  return out;
}

/** Gaming equivalence: hours of each game equal to the given kWh. */
export function gameHours(kwh, config = loadConfig()) {
  const out = {};
  for (const [id, g] of Object.entries(config.games || {})) {
    out[id] = { label: g.label, watts: g.watts, hours: g.watts > 0 ? kwh / (g.watts / 1000) : 0 };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw rows: session JSONL + subagents sqlite
// ---------------------------------------------------------------------------

function fingerprint(r) {
  return [r.sessionId || r.session_file || "", r.ts || r.created_at || "", r.input || 0, r.output || 0].join("|");
}

export function scanSessionFiles() {
  const rows = [];
  const dir = sessionsDir();
  if (!existsSync(dir)) return rows;
  for (const proj of readdirSync(dir)) {
    const projDir = join(dir, proj);
    if (!statSync(projDir).isDirectory()) continue;
    for (const file of readdirSync(projDir)) {
      if (!file.endsWith(".jsonl")) continue;
      let sessionId = "";
      const path = join(projDir, file);
      try {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line.trim()) continue;
          const o = JSON.parse(line);
          if (o.type === "session") { sessionId = o.id; continue; }
          if (o.type !== "message" || !o.message?.usage) continue;
          const m = o.message;
          rows.push({
            sessionId,
            cwd: o.cwd || proj,
            project: basename(proj.replace(/^--|--$/g, "")) || proj,
            ts: o.timestamp,
            model: m.model || "",
            provider: m.provider || (m.model || "").split("/")[0],
            input: m.usage.input || 0,
            output: m.usage.output || 0,
            cacheRead: m.usage.cacheRead || 0,
            cacheWrite: m.usage.cacheWrite || 0,
            cost: m.usage.cost?.total || 0,
            kind: "session",
          });
        }
      } catch { /* skip unreadable/partial file */ }
    }
  }
  return rows;
}

export function scanSubagents() {
  const rows = [];
  const dbPath = subagentsDb();
  if (!existsSync(dbPath)) return rows;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const stmt = db.prepare(
      `SELECT session_id, cwd, model, usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, last_activity_at
       FROM subagent_tasks WHERE model IS NOT NULL`
    );
    for (const r of stmt.all()) {
      rows.push({
        sessionId: r.session_id || "",
        cwd: r.cwd || "",
        project: basename((r.cwd || "").replace(/^--|--$/g, "")) || r.cwd,
        ts: r.last_activity_at || "",
        model: r.model,
        provider: (r.model || "").split("/")[0],
        input: r.usage_input || 0,
        output: r.usage_output || 0,
        cacheRead: r.usage_cache_read || 0,
        cacheWrite: r.usage_cache_write || 0,
        cost: r.usage_cost || 0,
        kind: "subagent",
      });
    }
  } catch (err) {
    console.error("[impact] subagent sqlite read failed:", err);
  } finally {
    db?.close();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ledger: durable raw-row record, gitignored. Appended, deduped by fingerprint
// ---------------------------------------------------------------------------

export function readLedger() {
  if (!existsSync(LEDGER_PATH)) return [];
  const rows = [];
  for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  return rows;
}

export function appendLedger(rows) {
  if (!rows.length) return;
  const seen = new Set(readLedger().map(fingerprint));
  const fresh = rows.filter((r) => !seen.has(fingerprint(r)));
  if (!fresh.length) return;
  mkdirSync(IMPACT_DIR, { recursive: true });
  appendFileSync(LEDGER_PATH, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** Full dataset: ledger rows for sessions (durable - session files may be
 *  compacted), sqlite rows for subagents (sqlite is already durable). */
export function allRows() {
  const sessionRows = readLedger().filter((r) => r.kind !== "subagent");
  const subagentRows = scanSubagents();
  return { sessionRows, subagentRows };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export function aggregate(rows, keyFn, config = loadConfig()) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r) || "unknown";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const out = {};
  for (const [k, rs] of map) out[k] = sumImpact(rs, config);
  return out;
}

export function byDay(rows, config = loadConfig()) {
  return aggregate(rows, (r) => String(r.ts || "").slice(0, 10), config);
}

export function byModel(rows, config = loadConfig()) {
  return aggregate(rows, (r) => r.model || "unknown", config);
}

export function byProject(rows, config = loadConfig()) {
  return aggregate(rows, (r) => r.project || "other", config);
}

/** Nested model -> project totals, for the flow graph. */
export function byModelProject(rows, config = loadConfig()) {
  const out = {};
  for (const r of rows) {
    const m = r.model || "unknown";
    const p = r.project || "other";
    const bucket = (out[m] ??= {});
    (bucket[p] ??= []).push(r);
  }
  for (const m of Object.keys(out)) {
    for (const p of Object.keys(out[m])) {
      out[m][p] = sumImpact(out[m][p], config);
    }
  }
  return out;
}

/** Real-world equivalences for the browser report. Factors match the EPA
 *  Greenhouse Gas Equivalencies Calculator figures used by
 *  impact-equivalences (which renders them in pi's /usage panel). */
export function equivalentsFor(kwh, kgCO2e, waterL, games = {}) {
  const fmt = (n) => {
    if (!Number.isFinite(n)) return "0";
    const digits = n < 10 && n % 1 !== 0 ? 2 : n < 100 ? 1 : 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  };
  // label: singular form; plural: used when the value is not 1
  const rows = [
    ...(kwh >= 0.05 ? [{ domain: "electricity", label: "hour of laptop use", plural: "hours of laptop use", value: kwh / 0.05 }] : []),
    ...(kwh >= 30 ? [{ domain: "electricity", label: "US home-day of electricity", plural: "US home-days of electricity", value: kwh / 30 }] : []),
    ...(kwh >= 60 ? [{ domain: "electricity", label: "EV full charge (60 kWh pack)", plural: "EV full charges (60 kWh pack)", value: kwh / 60 }] : []),
    ...(kgCO2e >= 8.89 ? [{ domain: "carbon", label: "gallon of gasoline burned", plural: "gallons of gasoline burned", value: kgCO2e / 8.89 }] : []),
    ...(kgCO2e >= 22 ? [{ domain: "carbon", label: "tree-year of sequestration", plural: "tree-years of sequestration", value: kgCO2e / 22 }] : []),
    ...(kgCO2e >= 150 ? [{ domain: "carbon", label: "short-haul flight", plural: "short-haul flights", value: kgCO2e / 150 }] : []),
    ...(kgCO2e >= 0.4 ? [{ domain: "carbon", label: "mile driven in an average gasoline car", plural: "miles driven in an average gasoline car", value: kgCO2e / 0.4 }] : []),
    ...(waterL >= 65 ? [{ domain: "water", label: "8-minute shower", plural: "8-minute showers", value: waterL / 65 }] : []),
    ...(waterL > 0 ? [{ domain: "water", label: "US household-day of indoor water use", plural: "US household-days of indoor water use", value: waterL / 300 }] : []),
    ...(waterL >= 2500000 ? [{ domain: "water", label: "Olympic swimming pool", plural: "Olympic swimming pools", value: waterL / 2500000 }] : []),
    ...Object.entries(games).map(([id, g]) => ({
      domain: "gaming",
      label: `hour of ${g.label}`,
      plural: `hours of ${g.label}`,
      value: g.hours,
    })),
  ].filter((e) => e.value > 0);
  return rows.map((e) => ({
    ...e,
    formatted: `${fmt(e.value)} ${Math.abs(e.value - 1) < 0.05 ? e.label : e.plural}`,
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "--sync") {
    // Rebuild the ledger from whatever session files still exist, so reports
    // cover sessions that ran before the extension was installed.
    appendLedger(scanSessionFiles());
    const { sessionRows } = allRows();
    console.log(`ledger: ${sessionRows.length} session rows, ${scanSubagents().length} subagent rows`);
    return;
  }

  if (cmd === "--data") {
    const config = loadConfig();
    const { sessionRows, subagentRows } = allRows();
    const all = [...sessionRows, ...subagentRows];
    const totals = sumImpact(all, config);
    const data = {
      generated: new Date().toISOString(),
      config,
      defaults: loadDefaults(),
      states: loadStates(),
      profiles: loadProfiles(),
      rows: all,
      totals: {
        ...totals,
        games: gameHours(totals.kwh, config),
        byDay: byDay(all, config),
        byModel: byModel(all, config),
        byProject: byProject(all, config),
        equivalents: equivalentsFor(
          totals.kwh,
          totals.kgCO2e,
          totals.waterL,
          gameHours(totals.kwh, config),
        ),
      },
      assumptions: assumptionsList(),
    };
    process.stdout.write(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === "--month") {
    const config = loadConfig();
    const { sessionRows, subagentRows } = allRows();
    const all = [...sessionRows, ...subagentRows];
    const month = process.argv[3] || new Date().toISOString().slice(0, 7);
    const monthRows = all.filter((r) => (r.ts || "").slice(0, 7) === month);
    const t = sumImpact(monthRows, config);
    console.log(JSON.stringify({
      month,
      calls: t.calls, cost: t.cost, tokens: t.tokens,
      kwh: t.kwh, kgCO2e: t.kgCO2e, waterL: t.waterL,
    }));
    return;
  }

  console.log(`usage: node impact-core.mjs [--sync|--data|--month YYYY-MM]`);
}

export function assumptionsList() {
  return [
    "Electricity: tokens -> kWh uses Epoch AI inference-energy estimates via three model classes (efficient_small 0.01-0.08, balanced 0.05-0.5, frontier 0.2-1.5 Wh per 1k tokens). impact-equivalences profile data.",
    "Carbon: kgCO2e per kWh from EPA eGRID 2022. API providers default to US average (0.386) because the datacenter location is unknown; local models use the configured location's state factor (e.g. NC 0.298).",
    "Water: datacenter operational cooling, 1.5 L/kWh typical (range 0.7-3), industry WUE reports (e.g. Google ~1.1 L/kWh).",
    "Excluded: model training, embodied hardware, networking, storage, user devices, and upstream electricity-generation water.",
    "Gaming comparisons assume a high-end gaming PC at the wall (Cyberpunk 2077 ~400 W, Control ~300 W); watts are editable in impact/config.json.",
    "All factors are editable: impact/config.json on disk, or the Assumptions tab of fpi-impact (saves back to the same file).",
  ];
}

if (import.meta.url === `file://${process.argv[1]}` || basename(process.argv[1] || "") === "impact-core.mjs") {
  cli();
}
