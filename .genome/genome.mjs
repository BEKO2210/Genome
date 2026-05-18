#!/usr/bin/env node
// GENOME — Project Genome System CLI
// Zero dependencies. ESM. Node >= 18. Fully offline.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

// ───────────────────────────────────────────────────────── Paths

const ROOT = process.cwd();
const GENOME_DIR = join(ROOT, 'genome');
const DOT_GENOME_DIR = join(ROOT, '.genome');
const DOT_CONTEXT_DIR = join(ROOT, '.context');
const DOT_CLAUDE_DIR = join(ROOT, '.claude');

const P = {
  atoms: join(GENOME_DIR, 'atoms.jsonl'),
  synapses: join(GENOME_DIR, 'synapses.jsonl'),
  history: join(GENOME_DIR, 'history.jsonl'),
  firewall: join(GENOME_DIR, 'firewall.json'),
  schema: join(GENOME_DIR, 'SCHEMA.md'),
  inbox: join(DOT_GENOME_DIR, 'inbox.json'),
  proposals: join(DOT_GENOME_DIR, 'proposals.jsonl'),
  receipts: join(DOT_GENOME_DIR, 'receipts'),
  hook: join(DOT_GENOME_DIR, 'firewall-hook.mjs'),
  claudeSettings: join(DOT_CLAUDE_DIR, 'settings.json'),
  capsule: join(DOT_CONTEXT_DIR, 'current.capsule.md'),
};

// ───────────────────────────────────────────────────────── Enums

const ATOM_TYPES = new Set([
  'constraint',
  'decision',
  'fact',
  'known_failure',
  'command',
  'test_gate',
  'preference',
]);
const PRIORITIES = new Set(['critical', 'high', 'normal']);
const STATUSES = new Set(['verified', 'stable', 'stale', 'deprecated']);
const EDGE_TYPES = new Set([
  'constrains',
  'depends_on',
  'supersedes',
  'caused_by',
  'relates_to',
  'tested_by',
]);

// ───────────────────────────────────────────────────────── Stopwords (DE+EN)

const STOPWORDS = new Set([
  'a','an','the','is','are','to','of','in','on','for','and','or','but','with',
  'from','this','that','it','at','by','as','be','have','has','had','do','does',
  'did','will','can','could','should','would','may','might','must','shall',
  'not','no','yes','if','then','else','when','where','what','which','who',
  'how','why','about','into','out','up','down','off','over','under','again',
  'just','also','too','very','only','any','some','more','less','than',
  'das','der','die','und','oder','aber','mit','von','aus','an','auf','für',
  'ein','eine','einer','einen','dem','den','des','ist','sind','war','waren',
  'hat','haben','wir','ich','du','er','sie','es','wird','werden','soll',
  'sollte','muss','könnte','würde','dass','wenn','dann','sonst','wo','was',
  'wie','warum','nicht','kein','keine','nur','auch','noch','schon','bei','zu',
  'im','am','um','vom','zum','zur','beim',
]);

// ───────────────────────────────────────────────────────── IO helpers

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out = [];
  let lineNo = 0;
  for (const line of raw.split('\n')) {
    lineNo++;
    const t = line.trim();
    if (!t) continue;
    try {
      out.push({ data: JSON.parse(t), line: lineNo });
    } catch (e) {
      throw new Error(`${path}:${lineNo}: invalid JSON — ${e.message}`);
    }
  }
  return out;
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function writeIfMissing(path, content) {
  if (existsSync(path)) return false;
  ensureDir(dirname(path));
  writeFileSync(path, content);
  return true;
}

function readJsonSafe(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// ───────────────────────────────────────────────────────── Token / score

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9äöüß_-]+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// ───────────────────────────────────────────────────────── Intent

// Order matters: more specific operational intents are matched before the
// general "feature" bucket (which catches "add/new/create").
const INTENT_KEYWORDS = {
  deploy: ['deploy', 'release', 'publish', 'deployment', 'ship', 'ausliefern', 'veröffentlichen', 'veroeffentlichen'],
  bugfix: ['fix', 'bug', 'broken', 'error', 'crash', 'fail', 'fehler', 'kaputt', 'behebe', 'beheben', 'repariere', 'reparieren'],
  review: ['review', 'audit', 'check', 'prüfe', 'prüfen', 'pruefe', 'pruefen', 'sichten'],
  refactor: ['refactor', 'cleanup', 'rewrite', 'umbau', 'refaktor', 'refactoring', 'umbauen', 'aufräumen'],
  feature: ['add', 'implement', 'new', 'create', 'feature', 'build', 'erstelle', 'erstellen', 'neu', 'implementiere', 'implementieren', 'baue', 'bauen', 'füge'],
};

const AREA_KEYWORDS = {
  frontend: ['ui', 'frontend', 'dashboard', 'page', 'component', 'css', 'react', 'view', 'browser', 'html'],
  backend: ['api', 'server', 'gateway', 'db', 'database', 'backend', 'endpoint', 'service'],
  security: ['auth', 'login', 'token', 'secret', 'security', 'password', 'credential', 'sicherheit', 'authentifizierung'],
  deploy: ['deploy', 'release', 'build', 'ci', 'github-pages', 'gh-pages', 'publish', 'pipeline'],
  test: ['test', 'spec', 'e2e', 'unit'],
};

const SECURITY_TOKENS = AREA_KEYWORDS.security;

const NEEDED_TYPES = {
  bugfix: ['known_failure', 'constraint', 'test_gate'],
  feature: ['decision', 'constraint', 'fact', 'test_gate'],
  review: ['constraint', 'decision', 'known_failure', 'preference'],
  refactor: ['decision', 'constraint', 'fact'],
  deploy: ['command', 'constraint', 'known_failure'],
  unknown: ['constraint', 'decision', 'fact'],
};

function classifyIntent(task) {
  const tokens = tokenize(task);
  const set = new Set(tokens);

  let intent = 'unknown';
  for (const [name, kws] of Object.entries(INTENT_KEYWORDS)) {
    if (kws.some((k) => set.has(k))) {
      intent = name;
      break;
    }
  }

  let area = 'general';
  for (const [name, kws] of Object.entries(AREA_KEYWORDS)) {
    if (kws.some((k) => set.has(k))) {
      area = name;
      break;
    }
  }

  const hasSecurity = SECURITY_TOKENS.some((k) => set.has(k));
  let risk = 'low';
  if (intent === 'deploy') risk = 'high';
  else if (hasSecurity) risk = 'high';
  else if (intent === 'bugfix' || intent === 'feature' || intent === 'refactor') risk = 'medium';

  return {
    intent,
    area,
    risk,
    needed_types: NEEDED_TYPES[intent] || NEEDED_TYPES.unknown,
  };
}

// ───────────────────────────────────────────────────────── Lint

function lint() {
  let errors = 0;
  let warnings = 0;

  const atomEntries = readJsonl(P.atoms);
  const synapseEntries = readJsonl(P.synapses);

  const ids = new Map(); // id -> {line, atom}
  for (const { data, line } of atomEntries) {
    const missing = ['id', 'type', 'statement', 'tags', 'priority', 'status', 'source', 'confidence', 'supersedes']
      .filter((k) => data[k] === undefined || data[k] === null);
    if (missing.length) {
      console.error(`atoms.jsonl:${line}: missing fields: ${missing.join(', ')}`);
      errors++;
      continue;
    }
    if (!ATOM_TYPES.has(data.type)) { console.error(`atoms.jsonl:${line}: invalid type "${data.type}"`); errors++; }
    if (!PRIORITIES.has(data.priority)) { console.error(`atoms.jsonl:${line}: invalid priority "${data.priority}"`); errors++; }
    if (!STATUSES.has(data.status)) { console.error(`atoms.jsonl:${line}: invalid status "${data.status}"`); errors++; }
    if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
      console.error(`atoms.jsonl:${line}: confidence must be 0..1`); errors++;
    }
    if (!Array.isArray(data.tags)) { console.error(`atoms.jsonl:${line}: tags must be array`); errors++; }
    if (!Array.isArray(data.supersedes)) { console.error(`atoms.jsonl:${line}: supersedes must be array`); errors++; }
    if (data.type === 'known_failure' && (!data.fix || typeof data.fix !== 'string')) {
      console.error(`atoms.jsonl:${line}: known_failure requires "fix" string`); errors++;
    }
    if (ids.has(data.id)) {
      console.error(`atoms.jsonl:${line}: duplicate id "${data.id}" (first seen at line ${ids.get(data.id).line})`);
      errors++;
    } else {
      ids.set(data.id, { line, atom: data });
    }
  }

  // supersedes references exist
  for (const { data, line } of atomEntries) {
    if (!Array.isArray(data.supersedes)) continue;
    for (const sid of data.supersedes) {
      if (!ids.has(sid)) {
        console.error(`atoms.jsonl:${line}: supersedes references unknown id "${sid}"`);
        errors++;
      }
    }
  }

  // synapses
  for (const { data, line } of synapseEntries) {
    if (!data.from || !data.to || !data.type) {
      console.error(`synapses.jsonl:${line}: from/to/type required`); errors++; continue;
    }
    if (!EDGE_TYPES.has(data.type)) {
      console.error(`synapses.jsonl:${line}: invalid edge type "${data.type}"`); errors++;
    }
    if (!ids.has(data.from)) { console.error(`synapses.jsonl:${line}: dangling from "${data.from}"`); errors++; }
    if (!ids.has(data.to)) { console.error(`synapses.jsonl:${line}: dangling to "${data.to}"`); errors++; }
  }

  // contradiction: supersedes target still verified/stable
  for (const { data, line } of atomEntries) {
    if (!Array.isArray(data.supersedes)) continue;
    for (const sid of data.supersedes) {
      const ref = ids.get(sid);
      if (ref && (ref.atom.status === 'verified' || ref.atom.status === 'stable')) {
        console.warn(`atoms.jsonl:${line}: supersedes "${sid}" but target is still "${ref.atom.status}" (atoms.jsonl:${ref.line}) — should be "deprecated"`);
        warnings++;
      }
    }
  }

  if (errors === 0) {
    console.log(`lint ok — ${ids.size} atoms, ${synapseEntries.length} synapses, ${warnings} warning(s).`);
    process.exit(0);
  } else {
    console.error(`lint failed — ${errors} error(s), ${warnings} warning(s).`);
    process.exit(1);
  }
}

// ───────────────────────────────────────────────────────── Brief (compiler)

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function buildGraph(synapses) {
  const adj = new Map();
  for (const { data: s } of synapses) {
    if (!adj.has(s.from)) adj.set(s.from, []);
    if (!adj.has(s.to)) adj.set(s.to, []);
    adj.get(s.from).push({ neighbor: s.to, type: s.type });
    adj.get(s.to).push({ neighbor: s.from, type: s.type });
  }
  return adj;
}

function brief(args) {
  const opts = parseArgs(args);
  const task = opts._[0];
  if (!task) {
    console.error('brief: task is required. Usage: brief "<task>" [--budget N] [--intent I] [--depth D]');
    process.exit(1);
  }
  const budget = parseInt(opts.budget, 10) || 3500;
  const depth = parseInt(opts.depth, 10) || 2;

  const intentInfo = classifyIntent(task);
  if (opts.intent && typeof opts.intent === 'string') intentInfo.intent = opts.intent;
  const needed = new Set(NEEDED_TYPES[intentInfo.intent] || intentInfo.needed_types);

  const atomEntries = readJsonl(P.atoms);
  const synapseEntries = readJsonl(P.synapses);
  const atoms = atomEntries.map((e) => e.data);
  const byId = new Map(atoms.map((a) => [a.id, a]));

  const taskTokens = new Set(tokenize(task));

  // 1) keyword score (only over non-stale/non-deprecated atoms)
  const liveAtoms = atoms.filter((a) => a.status !== 'deprecated' && a.status !== 'stale');
  const keywordScore = new Map();
  for (const a of liveAtoms) {
    let score = 0;
    for (const tag of a.tags || []) {
      if (taskTokens.has(String(tag).toLowerCase())) score += 3;
    }
    const stmtWords = tokenize(a.statement).filter((w) => w.length > 3);
    let stmtHits = 0;
    for (const w of stmtWords) {
      if (taskTokens.has(w)) stmtHits++;
    }
    score += Math.min(5, stmtHits);
    if (needed.has(a.type)) score += 4;
    keywordScore.set(a.id, score);
  }

  // 2) seeds
  const seeds = liveAtoms.filter((a) => (keywordScore.get(a.id) || 0) > 0);

  // 3) graph expansion BFS
  const adj = buildGraph(synapseEntries);
  // hop[id] = { hop, viaEdge, viaSeed }
  const reached = new Map();
  for (const s of seeds) {
    reached.set(s.id, { hop: 0, viaEdge: null, viaSeed: null });
  }
  // BFS
  let frontier = seeds.map((s) => s.id);
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const id of frontier) {
      const seedAnchor = reached.get(id).hop === 0 ? id : reached.get(id).viaSeed;
      const edges = adj.get(id) || [];
      for (const { neighbor, type } of edges) {
        if (reached.has(neighbor)) continue;
        const atom = byId.get(neighbor);
        if (!atom) continue;
        if (atom.status === 'deprecated' || atom.status === 'stale') continue;
        reached.set(neighbor, { hop: d, viaEdge: type, viaSeed: seedAnchor });
        next.push(neighbor);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // 4) final scoring
  function hopBonus(h) { return h === 0 ? 6 : h === 1 ? 3 : h === 2 ? 1 : 0; }
  function priorityBonus(p) { return p === 'high' ? 5 : 0; }

  const scored = [];
  for (const [id, info] of reached.entries()) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.status === 'deprecated' || a.status === 'stale') continue;
    const ks = keywordScore.get(id) || 0;
    const total = ks + hopBonus(info.hop) + priorityBonus(a.priority);
    scored.push({ atom: a, info, ks, total });
  }

  // 5) selection: critical always; then by total desc; greedy by budget
  const criticals = scored.filter((s) => s.atom.priority === 'critical');
  const rest = scored.filter((s) => s.atom.priority !== 'critical')
    .sort((a, b) => b.total - a.total);

  const chosen = [];
  let used = 0;

  function atomBlock(s) {
    const a = s.atom;
    const viaSuffix = s.info.hop > 0 ? `  (via ${s.info.viaEdge} ← ${s.info.viaSeed})` : '';
    if (a.type === 'known_failure') {
      return `- [${a.type}] ${a.statement}${viaSuffix}\n  → Fix: ${a.fix || ''}`;
    }
    return `- [${a.type}] ${a.statement}${viaSuffix}`;
  }

  function chargeBudget(s) { used += estimateTokens(atomBlock(s)) + 2; }

  for (const s of criticals) {
    chosen.push(s);
    chargeBudget(s);
  }
  const overBudgetByCritical = used > budget;

  for (const s of rest) {
    const cost = estimateTokens(atomBlock(s)) + 2;
    if (used + cost > budget) continue;
    chosen.push(s);
    used += cost;
  }

  // 6) render capsule
  const fw = readJsonSafe(P.firewall, { mode: 'block', forbidden_globs: [] });

  const chosenIds = new Set(chosen.map((s) => s.atom.id));

  // partition for render sections
  const criticalRules = chosen.filter((s) => s.atom.type === 'constraint' && s.atom.priority === 'critical');
  const commands = chosen.filter((s) => s.atom.type === 'command');
  const doneWhen = chosen.filter((s) => s.atom.type === 'test_gate');
  const knowledge = chosen.filter((s) => !(
    (s.atom.type === 'constraint' && s.atom.priority === 'critical') ||
    s.atom.type === 'command' ||
    s.atom.type === 'test_gate'
  ));

  const lines = [];
  lines.push('# Context Capsule — GENOME');
  lines.push('> Auto-kompiliert. NICHT von Hand editieren.');
  lines.push('');
  lines.push('## Mission');
  lines.push(task);
  lines.push('');
  lines.push('## Intent');
  lines.push(`${intentInfo.intent} · Bereich: ${intentInfo.area} · Risiko: ${intentInfo.risk}`);
  lines.push('');

  if (criticalRules.length) {
    lines.push('## Critical Rules');
    for (const s of criticalRules) lines.push(`- ${s.atom.statement}`);
    lines.push('');
  }

  if (knowledge.length) {
    lines.push('## Relevant Knowledge');
    for (const s of knowledge) lines.push(atomBlock(s));
    lines.push('');
  }

  if (commands.length) {
    lines.push('## Commands');
    for (const s of commands) lines.push(`- ${s.atom.statement}`);
    lines.push('');
  }

  if (doneWhen.length) {
    lines.push('## Done When');
    for (const s of doneWhen) lines.push(`- ${s.atom.statement}`);
    lines.push('');
  }

  lines.push('## Do Not Read');
  for (const g of fw.forbidden_globs || []) lines.push(`- ${g}`);
  lines.push('');

  const numSeeds = chosen.filter((s) => s.info.hop === 0).length;
  const numGraph = chosen.filter((s) => s.info.hop > 0).length;
  const overWarn = overBudgetByCritical ? ' · ⚠ critical-Atome überschreiten Budget' : '';
  lines.push('## Context Budget');
  lines.push(`~${used} / ${budget} · ${chosen.length} Atome · Seeds: ${numSeeds} · per Graph: ${numGraph}${overWarn}`);
  lines.push('');

  lines.push('## After You Finish');
  lines.push('1. Lern-Vorschläge nach .genome/inbox.json schreiben (Format siehe SCHEMA.md).');
  lines.push('2. Ausführen: node .genome/genome.mjs receipt --task "' + task.replace(/"/g, '\\"') + '" --used <ids> --files <dateien>');
  lines.push('3. Ausführen: node .genome/genome.mjs reflex');
  lines.push('');

  ensureDir(DOT_CONTEXT_DIR);
  writeFileSync(P.capsule, lines.join('\n'));

  console.log(`brief ok — ${chosen.length} atoms (${numSeeds} seeds, ${numGraph} via graph), ~${used}/${budget} tokens.`);
  console.log(`wrote ${P.capsule}`);
  if (overBudgetByCritical) console.warn('⚠ critical atoms alone exceed budget — consider raising --budget.');
}

// ───────────────────────────────────────────────────────── Receipt

function isoStamp() { return new Date().toISOString(); }
function fileStamp() { return isoStamp().replace(/[:.]/g, '-'); }

function receipt(args) {
  const opts = parseArgs(args);
  if (!opts.task) { console.error('receipt: --task required'); process.exit(1); }
  const used = typeof opts.used === 'string' ? opts.used.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const files = typeof opts.files === 'string' ? opts.files.split(',').map((s) => s.trim()).filter(Boolean) : [];
  ensureDir(P.receipts);
  const path = join(P.receipts, `${fileStamp()}.json`);
  const payload = {
    timestamp: isoStamp(),
    task: opts.task,
    used_context_atoms: used,
    files_read: files,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(`receipt written: ${path}`);
}

// ───────────────────────────────────────────────────────── Reflex

function validateAtomShape(a) {
  const errors = [];
  for (const k of ['type', 'statement', 'tags', 'priority', 'status', 'source', 'confidence']) {
    if (a[k] === undefined || a[k] === null) errors.push(`missing field "${k}"`);
  }
  if (a.type && !ATOM_TYPES.has(a.type)) errors.push(`invalid type "${a.type}"`);
  if (a.priority && !PRIORITIES.has(a.priority)) errors.push(`invalid priority "${a.priority}"`);
  if (a.status && !STATUSES.has(a.status)) errors.push(`invalid status "${a.status}"`);
  if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1) errors.push('confidence must be 0..1');
  if (a.tags && !Array.isArray(a.tags)) errors.push('tags must be array');
  if (a.type === 'known_failure' && (!a.fix || typeof a.fix !== 'string')) errors.push('known_failure requires "fix" string');
  return errors;
}

function nextProposalIdBase() {
  // short ts (base36) of seconds for compactness
  return 'prop.' + Math.floor(Date.now() / 1000).toString(36);
}

function reflex() {
  const inbox = readJsonSafe(P.inbox, { new_atoms: [], stale_ids: [] });
  const newAtoms = Array.isArray(inbox.new_atoms) ? inbox.new_atoms : [];
  const staleIds = Array.isArray(inbox.stale_ids) ? inbox.stale_ids : [];
  if (newAtoms.length === 0 && staleIds.length === 0) {
    console.log('reflex: inbox is empty — nothing to queue.');
    return;
  }

  const base = nextProposalIdBase();
  let counter = 1;
  let appended = 0;

  ensureDir(DOT_GENOME_DIR);

  for (const a of newAtoms) {
    const errs = validateAtomShape(a);
    if (errs.length) {
      console.warn(`reflex: skipped invalid new_atom (${errs.join('; ')})`);
      continue;
    }
    const prop = {
      proposal_id: `${base}.${String(counter++).padStart(3, '0')}`,
      created: isoStamp(),
      kind: 'add',
      payload: a,
      status: 'pending',
    };
    appendFileSync(P.proposals, JSON.stringify(prop) + '\n');
    appended++;
  }

  for (const id of staleIds) {
    if (typeof id !== 'string' || !id) continue;
    const prop = {
      proposal_id: `${base}.${String(counter++).padStart(3, '0')}`,
      created: isoStamp(),
      kind: 'mark_stale',
      payload: { atom_id: id },
      status: 'pending',
    };
    appendFileSync(P.proposals, JSON.stringify(prop) + '\n');
    appended++;
  }

  // reset inbox
  writeFileSync(P.inbox, JSON.stringify({ new_atoms: [], stale_ids: [] }, null, 2));
  console.log(`reflex: ${appended} proposal(s) queued. atoms.jsonl unchanged.`);
}

// ───────────────────────────────────────────────────────── Review

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    .slice(0, 4)
    .join('-')
    .slice(0, 30) || 'atom';
}

function generateAtomId(type, statement, existingIds) {
  const slug = slugify(statement);
  const prefix = `${type}.${slug}.`;
  let n = 1;
  while (existingIds.has(`${prefix}${String(n).padStart(3, '0')}`)) n++;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

function rewriteJsonl(path, items) {
  writeFileSync(path, items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''));
}

function review(args) {
  const opts = parseArgs(args);
  const proposals = readJsonl(P.proposals).map((e) => e.data);

  if (!opts.accept && !opts.reject) {
    const pending = proposals.filter((p) => p.status === 'pending');
    if (pending.length === 0) { console.log('No pending proposals.'); return; }
    console.log(`Pending proposals (${pending.length}):`);
    for (const p of pending) {
      const stmt = p.kind === 'add' ? (p.payload.statement || '') : `mark_stale ${p.payload.atom_id}`;
      console.log(`  ${p.proposal_id} [${p.kind}]  ${stmt}`);
    }
    return;
  }

  const targetId = opts.accept || opts.reject;
  if (typeof targetId !== 'string') { console.error('review: provide a proposal id'); process.exit(1); }
  const idx = proposals.findIndex((p) => p.proposal_id === targetId);
  if (idx === -1) { console.error(`review: proposal "${targetId}" not found`); process.exit(1); }
  const prop = proposals[idx];
  if (prop.status !== 'pending') { console.error(`review: proposal "${targetId}" already ${prop.status}`); process.exit(1); }

  if (opts.reject) {
    prop.status = 'rejected';
    rewriteJsonl(P.proposals, proposals);
    appendFileSync(P.history, JSON.stringify({ timestamp: isoStamp(), action: 'reject', proposal_id: prop.proposal_id }) + '\n');
    console.log(`rejected ${prop.proposal_id}`);
    return;
  }

  // accept
  const atomEntries = readJsonl(P.atoms);
  const existingIds = new Set(atomEntries.map((e) => e.data.id));

  if (prop.kind === 'add') {
    const errs = validateAtomShape(prop.payload);
    if (errs.length) { console.error(`review: invalid payload: ${errs.join('; ')}`); process.exit(1); }
    const id = generateAtomId(prop.payload.type, prop.payload.statement, existingIds);
    const atom = {
      id,
      type: prop.payload.type,
      statement: prop.payload.statement,
      tags: prop.payload.tags || [],
      priority: prop.payload.priority,
      status: prop.payload.status,
      source: prop.payload.source,
      confidence: prop.payload.confidence,
      supersedes: prop.payload.supersedes || [],
    };
    if (atom.type === 'known_failure') atom.fix = prop.payload.fix;
    appendFileSync(P.atoms, JSON.stringify(atom) + '\n');
    appendFileSync(P.history, JSON.stringify({
      timestamp: isoStamp(),
      action: 'accept_add',
      atom_id: id,
      reason: `via proposal ${prop.proposal_id}`,
    }) + '\n');
    prop.status = 'accepted';
    rewriteJsonl(P.proposals, proposals);
    console.log(`accepted ${prop.proposal_id} → atom ${id}`);
    return;
  }

  if (prop.kind === 'mark_stale') {
    const targetAtomId = prop.payload.atom_id;
    let found = false;
    const updated = atomEntries.map((e) => {
      if (e.data.id === targetAtomId) {
        found = true;
        return { ...e.data, status: 'stale' };
      }
      return e.data;
    });
    if (!found) { console.error(`review: atom "${targetAtomId}" not found in atoms.jsonl`); process.exit(1); }
    rewriteJsonl(P.atoms, updated);
    appendFileSync(P.history, JSON.stringify({
      timestamp: isoStamp(),
      action: 'mark_stale',
      atom_id: targetAtomId,
    }) + '\n');
    prop.status = 'accepted';
    rewriteJsonl(P.proposals, proposals);
    console.log(`accepted ${prop.proposal_id} → atom ${targetAtomId} marked stale`);
    return;
  }

  console.error(`review: unknown proposal kind "${prop.kind}"`);
  process.exit(1);
}

// ───────────────────────────────────────────────────────── Init

const START_ATOMS = [
  {"id":"rule.no-backend.001","type":"constraint","statement":"Das Projekt verwendet kein Backend; das Deployment ist rein statisch.","tags":["architecture","deployment","backend","github-pages"],"priority":"critical","status":"verified","source":"CLAUDE.md","confidence":0.98,"supersedes":[]},
  {"id":"rule.no-secrets.001","type":"constraint","statement":"Keine Secrets oder API-Keys im Repository oder im ausgelieferten Frontend.","tags":["security","secrets","frontend","keys"],"priority":"critical","status":"verified","source":"CLAUDE.md","confidence":0.99,"supersedes":[]},
  {"id":"decision.local-auth.001","type":"decision","statement":"Authentifizierung laeuft lokal ohne externen Provider.","tags":["auth","login","architecture","session"],"priority":"high","status":"verified","source":"ARCHITECTURE.md","confidence":0.95,"supersedes":["plan.ext-auth.001"]},
  {"id":"plan.ext-auth.001","type":"decision","statement":"Auth sollte ueber einen externen Provider laufen.","tags":["auth","login"],"priority":"normal","status":"deprecated","source":"alte-notizen","confidence":0.3,"supersedes":[]},
  {"id":"fact.gateway-url.001","type":"fact","statement":"Der lokale Gateway laeuft auf ws://127.0.0.1:18789.","tags":["gateway","websocket","connection","dashboard"],"priority":"normal","status":"stable","source":"docs/protocol.md","confidence":0.9,"supersedes":[]},
  {"id":"bug.protocol-mismatch.001","type":"known_failure","statement":"Dashboard und Gateway koennen inkompatible Protokollversionen verwenden.","tags":["dashboard","gateway","protocol","websocket"],"priority":"high","status":"verified","source":"RUN_LOG.md","confidence":0.92,"supersedes":[],"fix":"Dashboard immer aus derselben Installation wie der Gateway oeffnen."},
  {"id":"cmd.build.001","type":"command","statement":"Build: npm run build — der Output liegt in dist/.","tags":["build","deployment"],"priority":"normal","status":"stable","source":"README.md","confidence":0.95,"supersedes":[]},
  {"id":"cmd.deploy.001","type":"command","statement":"Deployment erfolgt ueber GitHub Actions auf den Branch gh-pages.","tags":["deploy","deployment","github-pages","ci"],"priority":"normal","status":"stable","source":"README.md","confidence":0.9,"supersedes":[]},
  {"id":"test.auth-gate.001","type":"test_gate","statement":"Ein ungueltiger Token wird sauber abgelehnt; ein gueltiger Token verbindet ohne Protokollfehler.","tags":["auth","test","login","websocket"],"priority":"high","status":"verified","source":"tests/auth.test.ts","confidence":0.93,"supersedes":[]},
  {"id":"pref.minimal-deps.001","type":"preference","statement":"Minimale externe Dependencies bevorzugen; Standardbibliothek zuerst.","tags":["dependencies","architecture","quality"],"priority":"normal","status":"stable","source":"CLAUDE.md","confidence":0.85,"supersedes":[]},
];

const START_SYNAPSES = [
  {"from":"rule.no-backend.001","to":"decision.local-auth.001","type":"constrains"},
  {"from":"rule.no-secrets.001","to":"decision.local-auth.001","type":"constrains"},
  {"from":"decision.local-auth.001","to":"plan.ext-auth.001","type":"supersedes"},
  {"from":"decision.local-auth.001","to":"test.auth-gate.001","type":"tested_by"},
  {"from":"bug.protocol-mismatch.001","to":"fact.gateway-url.001","type":"relates_to"},
  {"from":"rule.no-backend.001","to":"cmd.deploy.001","type":"constrains"},
  {"from":"bug.protocol-mismatch.001","to":"test.auth-gate.001","type":"relates_to"},
];

const START_FIREWALL = {
  mode: 'block',
  forbidden_globs: ['RUN_LOG.md', 'archive/**', 'old/**', 'node_modules/**', '.git/**'],
};

const SCHEMA_MD = `# GENOME — Schema

## Atom (\`genome/atoms.jsonl\`)

One JSON object per line.

| Field        | Type      | Notes |
|--------------|-----------|-------|
| \`id\`         | string    | Format \`type.slug.NNN\` (e.g. \`rule.no-backend.001\`) |
| \`type\`       | enum      | \`constraint\` \\| \`decision\` \\| \`fact\` \\| \`known_failure\` \\| \`command\` \\| \`test_gate\` \\| \`preference\` |
| \`statement\`  | string    | The knowledge itself |
| \`tags\`       | string[]  | Search keys |
| \`priority\`   | enum      | \`critical\` \\| \`high\` \\| \`normal\` |
| \`status\`     | enum      | \`verified\` \\| \`stable\` \\| \`stale\` \\| \`deprecated\` |
| \`source\`     | string    | Where it came from |
| \`confidence\` | number    | 0..1 |
| \`supersedes\` | string[]  | IDs of atoms this replaces |
| \`fix\`        | string    | Only for \`known_failure\`: the fix pattern |

## Synapse (\`genome/synapses.jsonl\`)

One JSON object per line.

| Field  | Type   | Notes |
|--------|--------|-------|
| \`from\` | string | Source atom ID |
| \`to\`   | string | Target atom ID |
| \`type\` | enum   | \`constrains\` \\| \`depends_on\` \\| \`supersedes\` \\| \`caused_by\` \\| \`relates_to\` \\| \`tested_by\` |

Edges are treated **bidirectionally** during context expansion.

## Inbox (\`.genome/inbox.json\`)

Agent learning suggestions, awaiting review:

\`\`\`json
{
  "new_atoms": [
    {
      "type": "fact",
      "statement": "...",
      "tags": ["..."],
      "priority": "normal",
      "status": "verified",
      "source": "where it came from",
      "confidence": 0.8,
      "supersedes": []
    }
  ],
  "stale_ids": ["atom-id-to-mark-stale"]
}
\`\`\`

\`reflex\` converts each entry into a proposal — it never writes directly into the genome.

## Proposals (\`.genome/proposals.jsonl\`)

Review queue. One JSON per line:

\`\`\`json
{
  "proposal_id": "prop.xxxxx.001",
  "created": "ISO-8601",
  "kind": "add" | "mark_stale",
  "payload": { /* atom shape, or { "atom_id": "..." } */ },
  "status": "pending" | "accepted" | "rejected"
}
\`\`\`

## History (\`genome/history.jsonl\`)

Append-only provenance log. Never edit by hand.

## Firewall (\`genome/firewall.json\`)

\`\`\`json
{ "mode": "block", "forbidden_globs": ["RUN_LOG.md", "archive/**", "..."] }
\`\`\`

Paths matching any glob are blocked by the Claude Code PreToolUse hook
(\`.genome/firewall-hook.mjs\`).
`;

const INBOX_DEFAULT = { new_atoms: [], stale_ids: [] };

const HOOK_SOURCE = `#!/usr/bin/env node
// GENOME — Claude Code PreToolUse hook.
// Reads tool-call payload from stdin (JSON); if the targeted path matches a
// forbidden glob in genome/firewall.json, blocks the call with a clear reason.
// Fail-open: any unexpected condition lets the call through (never freezes the session).

import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, relative, sep, posix } from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function globToRegex(glob) {
  let r = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        r += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        r += '[^/]*';
        i++;
      }
    } else if ('.+?^\${}()|[]\\\\\\\\'.includes(c)) {
      r += '\\\\' + c;
      i++;
    } else {
      r += c;
      i++;
    }
  }
  return new RegExp('^' + r + '$');
}

function toRelPosix(p, cwd) {
  if (!p) return '';
  let rel = p;
  if (isAbsolute(p)) {
    try { rel = relative(cwd, p); } catch { rel = p; }
  }
  return rel.split(sep).join(posix.sep);
}

function extractPath(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolName === 'Read' || toolName === 'NotebookRead') return toolInput.file_path || toolInput.notebook_path || '';
  if (toolName === 'Grep') return toolInput.path || '';
  if (toolName === 'Glob') return toolInput.path || toolInput.pattern || '';
  return toolInput.file_path || toolInput.path || '';
}

(async () => {
  try {
    const raw = await readStdin();
    if (!raw) { process.exit(0); }
    let payload;
    try { payload = JSON.parse(raw); } catch { process.exit(0); }

    const cwd = payload.cwd || process.cwd();
    const fwPath = join(cwd, 'genome', 'firewall.json');
    if (!existsSync(fwPath)) { process.exit(0); }

    let fw;
    try { fw = JSON.parse(readFileSync(fwPath, 'utf8')); }
    catch { process.exit(0); }

    if (fw.mode !== 'block') { process.exit(0); }
    const globs = Array.isArray(fw.forbidden_globs) ? fw.forbidden_globs : [];
    if (!globs.length) { process.exit(0); }

    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input || {};
    const target = extractPath(toolName, toolInput);
    if (!target) { process.exit(0); }

    const rel = toRelPosix(target, cwd);
    const regexes = globs.map(globToRegex);
    const hit = regexes.some((re) => re.test(rel));
    if (!hit) { process.exit(0); }

    const reason = \`GENOME-Firewall: \${rel} ist gesperrt. Nutze die Context Capsule.\`;
    const out = {
      decision: 'block',
      reason,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  } catch {
    process.exit(0); // fail-open
  }
})();
`;

function mergeClaudeSettings() {
  ensureDir(DOT_CLAUDE_DIR);
  let settings = readJsonSafe(P.claudeSettings, {});
  if (!settings || typeof settings !== 'object') settings = {};
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

  const desired = {
    matcher: 'Read|Grep|Glob|NotebookRead',
    hooks: [
      { type: 'command', command: 'node .genome/firewall-hook.mjs' },
    ],
  };

  const already = settings.hooks.PreToolUse.some((entry) => {
    if (!entry || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some((h) => h && h.command === desired.hooks[0].command);
  });

  if (!already) settings.hooks.PreToolUse.push(desired);

  writeFileSync(P.claudeSettings, JSON.stringify(settings, null, 2) + '\n');
}

const BOOT_BLOCK = `## GENOME — Boot-Regel
Lies beim Start NICHT automatisch das ganze Repo, RUN_LOG.md, docs/ oder archive/.
Kompiliere zuerst die Context Capsule:
  node .genome/genome.mjs brief "<aktuelle aufgabe>" --budget 3500
Lies dann NUR .context/current.capsule.md plus die direkt betroffenen Code-Dateien.
Weitere Dateien nur, wenn die Capsule dafür keinen Kontext liefert.
Nach Abschluss:
  1. Lern-Vorschläge nach .genome/inbox.json schreiben.
  2. node .genome/genome.mjs receipt --task "..." --used <ids> --files <dateien>
  3. node .genome/genome.mjs reflex
Neues Wissen gelangt erst nach \`genome review\` ins Genome — niemals automatisch.`;

function init() {
  ensureDir(GENOME_DIR);
  ensureDir(DOT_GENOME_DIR);
  ensureDir(DOT_CONTEXT_DIR);
  ensureDir(DOT_CLAUDE_DIR);
  ensureDir(P.receipts);

  let created = 0;

  if (writeIfMissing(P.atoms, START_ATOMS.map((a) => JSON.stringify(a)).join('\n') + '\n')) created++;
  if (writeIfMissing(P.synapses, START_SYNAPSES.map((s) => JSON.stringify(s)).join('\n') + '\n')) created++;
  if (writeIfMissing(P.history, '')) created++;
  if (writeIfMissing(P.firewall, JSON.stringify(START_FIREWALL, null, 2) + '\n')) created++;
  if (writeIfMissing(P.schema, SCHEMA_MD)) created++;
  if (writeIfMissing(P.inbox, JSON.stringify(INBOX_DEFAULT, null, 2) + '\n')) created++;
  if (writeIfMissing(P.proposals, '')) created++;
  if (writeIfMissing(P.hook, HOOK_SOURCE)) created++;

  mergeClaudeSettings();

  console.log(`init ok — created ${created} file(s) (existing files left untouched).`);
  console.log('');
  console.log('─────── Paste this block into CLAUDE.md ───────');
  console.log(BOOT_BLOCK);
  console.log('───────────────────────────────────────────────');
}

// ───────────────────────────────────────────────────────── Dispatch

function help() {
  console.log(`GENOME — Project Genome System

Commands:
  init                       Bootstrap genome/, .genome/, .context/, .claude/.
  lint                       Validate atoms.jsonl & synapses.jsonl.
  intent "<task>"            Classify a task (intent/area/risk/needed_types).
  brief "<task>" [--budget N] [--intent I] [--depth D]
                             Compile .context/current.capsule.md from genome+task.
  receipt --task "<t>" --used id1,id2 --files f1,f2
                             Append an audit-trail receipt.
  reflex                     Convert .genome/inbox.json into pending proposals.
  review                     List pending proposals.
  review --accept <id>       Apply a proposal.
  review --reject <id>       Reject a proposal.
`);
}

const [, , cmd, ...rest] = process.argv;
try {
  switch (cmd) {
    case 'init': init(); break;
    case 'lint': lint(); break;
    case 'intent': {
      const task = rest[0];
      if (!task) { console.error('intent: task is required'); process.exit(1); }
      console.log(JSON.stringify(classifyIntent(task), null, 2));
      break;
    }
    case 'brief': brief(rest); break;
    case 'receipt': receipt(rest); break;
    case 'reflex': reflex(); break;
    case 'review': review(rest); break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      help(); break;
    default:
      console.error(`unknown command "${cmd}"`); help(); process.exit(1);
  }
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}
