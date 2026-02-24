#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const FITNESS = path.join(ROOT, 'memory_fitness.json');
const EVENTS = path.join(ROOT, 'events.jsonl');
const MEMORY = path.join(ROOT, 'memory.md');

const MUTATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 6 * 60 * 60 * 1000;

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function appendEvent(obj) { fs.appendFileSync(EVENTS, JSON.stringify(obj) + '\n', 'utf8'); }
function nowIso() { return new Date().toISOString(); }

function evaluate() {
  const out = execSync('node evaluate_memory.js', { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out);
}

function backup(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return () => fs.writeFileSync(filePath, raw, 'utf8');
}

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseIsoMs(v) {
  const t = Date.parse(v || '');
  return Number.isNaN(t) ? null : t;
}

function parseFields(rawLine) {
  const fields = {};
  const text = String(rawLine || '');
  const parts = text.split(/[|;；]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z_][\w\-]*)\s*[:=]\s*(.+)$/);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  return fields;
}

function toTokens(s) {
  return new Set(normalizeText(s).split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean));
}

function normalizeCoreText(s) {
  return normalizeText(s)
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/已确认|最终确认|确认/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 1;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const uni = aSet.size + bSet.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function extractEntries(lines) {
  const entries = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!bullet) continue;

    const content = bullet[1].trim();
    const fields = parseFields(content);
    const category = normalizeText(fields.category || section || 'uncategorized');
    const source = normalizeText(fields.source || fields.src || 'unknown');
    const replaces = normalizeText(fields.replaces || '');
    const extendsFlag = normalizeText(fields.extends || '');
    const ts = parseIsoMs(fields.at || fields.time || fields.date || fields.ts || '') || null;
    const signature = normalizeText(content.replace(/\b(at|time|date|ts)\s*[:=]\s*[^|;]+/ig, ''));
    const coreText = normalizeCoreText(content);

    entries.push({
      lineIndex: i,
      section,
      line,
      content,
      fields,
      category,
      source,
      replaces,
      extendsFlag,
      ts,
      signature,
      coreText,
      tokens: toTokens(content),
      fieldKeys: Object.keys(fields).filter((k) => !['at', 'time', 'date', 'ts', 'replaces', 'extends'].includes(k)).sort()
    });
  }
  return entries;
}

function hasInfoIncrement(newer, older) {
  // explicit replace/extend is considered intentional increment
  if (newer.replaces || newer.extendsFlag) return true;

  const oldKeys = new Set(older.fieldKeys);
  let newKeyCount = 0;
  for (const k of newer.fieldKeys) if (!oldKeys.has(k)) newKeyCount++;
  if (newKeyCount > 0) return true;

  for (const k of older.fieldKeys) {
    const ov = normalizeText(older.fields[k] || '');
    const nv = normalizeText(newer.fields[k] || '');
    if (nv && !ov) return true;
    if (nv && ov && nv !== ov) {
      const ovCore = normalizeCoreText(ov);
      const nvCore = normalizeCoreText(nv);
      if (ovCore === nvCore) continue; // wording-only / confirmation-only change
      return true;
    }
  }

  return false;
}

function pickNewest(a, b) {
  if (a.ts && b.ts) return a.ts >= b.ts ? a : b;
  if (a.ts && !b.ts) return a;
  if (!a.ts && b.ts) return b;
  return a.lineIndex >= b.lineIndex ? a : b;
}

function pruneNoIncrementAndOverIteration() {
  const restore = backup(MEMORY);
  const lines = fs.readFileSync(MEMORY, 'utf8').split(/\r?\n/);
  const entries = extractEntries(lines);
  if (entries.length < 2) return { changed: false, restore, target: 'memory.md', mutation: 'none' };

  const toDelete = new Set();
  const reasons = [];

  // Rule 1 + 2: same category/source in short window OR consecutive writes without replaces/extends.
  for (let i = 1; i < entries.length; i++) {
    const older = entries[i - 1];
    const newer = entries[i];
    if (older.category !== newer.category || older.source !== newer.source) continue;

    const recentEnough = (older.ts && newer.ts)
      ? Math.abs(newer.ts - older.ts) <= RECENT_WINDOW_MS
      : false;

    const bothUndeclared = !newer.replaces && !newer.extendsFlag && !older.replaces && !older.extendsFlag;
    const similar = jaccard(older.tokens, newer.tokens) >= 0.86 || older.signature === newer.signature || (older.coreText && older.coreText === newer.coreText);

    if ((recentEnough && bothUndeclared) || similar) {
      const keep = pickNewest(older, newer);
      const drop = keep === older ? newer : older;
      if (!hasInfoIncrement(keep, drop)) {
        toDelete.add(drop.lineIndex);
        reasons.push({ drop_line: drop.lineIndex + 1, keep_line: keep.lineIndex + 1, reason: 'no_increment_same_category_source' });
      }
    }
  }

  // Rule 3: high structural similarity => zero information gain; keep newer, delete older.
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.category !== b.category || a.source !== b.source) continue;

      const fieldSim = (() => {
        const sa = new Set(a.fieldKeys);
        const sb = new Set(b.fieldKeys);
        if (!sa.size && !sb.size) return 1;
        let inter = 0;
        for (const x of sa) if (sb.has(x)) inter++;
        const uni = sa.size + sb.size - inter;
        return uni === 0 ? 0 : inter / uni;
      })();
      const textSim = jaccard(a.tokens, b.tokens);
      if ((fieldSim >= 0.9 && textSim >= 0.9) || (a.coreText && a.coreText === b.coreText)) {
        const keep = pickNewest(a, b);
        const drop = keep === a ? b : a;
        if (!hasInfoIncrement(keep, drop)) {
          toDelete.add(drop.lineIndex);
          reasons.push({ drop_line: drop.lineIndex + 1, keep_line: keep.lineIndex + 1, reason: 'zero_information_gain_high_similarity' });
        }
      }
    }
  }

  if (!toDelete.size) return { changed: false, restore, target: 'memory.md', mutation: 'none' };

  const next = lines.filter((_, idx) => !toDelete.has(idx));
  fs.writeFileSync(MEMORY, next.join('\n'), 'utf8');
  appendEvent({ at: nowIso(), type: 'memory_prune', deleted_count: toDelete.size, reasons });

  return {
    changed: true,
    restore,
    target: 'memory.md',
    mutation: 'prune_zero_increment_memory',
    deleted_count: toDelete.size,
    reasons
  };
}

function proposeSingleMutation() {
  const r = pruneNoIncrementAndOverIteration();
  if (r.changed) return r;
  return { changed: false, target: null, mutation: 'none', restore: () => {} };
}

function mutationAllowed(fitness) {
  const now = Date.now();
  const freezeUntil = fitness.mutation_freeze_until ? new Date(fitness.mutation_freeze_until).getTime() : 0;
  if (freezeUntil && now < freezeUntil) {
    return { ok: false, reason: 'freeze_active', freeze_until: fitness.mutation_freeze_until };
  }

  const drift = Number(fitness.drift_score) || 0;
  const driftThreshold = Number(fitness.drift_threshold) || 0.25;
  if (drift >= driftThreshold) {
    return { ok: false, reason: 'drift_over_threshold', drift_score: drift, drift_threshold: driftThreshold };
  }

  if (!fitness.exploration_ready) {
    return { ok: false, reason: 'exploration_not_ready' };
  }

  const lastAt = fitness.last_mutation_at ? new Date(fitness.last_mutation_at).getTime() : 0;
  if (lastAt && (now - lastAt) < MUTATION_INTERVAL_MS) {
    return { ok: false, reason: 'mutation_throttled', next_allowed_at: new Date(lastAt + MUTATION_INTERVAL_MS).toISOString() };
  }

  return { ok: true };
}

function main() {
  const force = process.argv.includes('--force');

  evaluate();
  let fitness = readJson(FITNESS);

  const check = force ? { ok: true } : mutationAllowed(fitness);
  if (!check.ok) {
    const skipped = { at: nowIso(), type: 'mutation_attempt', decision: 'skipped', ...check };
    appendEvent(skipped);
    process.stdout.write(JSON.stringify(skipped, null, 2) + '\n');
    return;
  }

  const previousScore = Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || 0;
  const mutation = proposeSingleMutation();
  if (!mutation.changed) {
    const skipped = { at: nowIso(), type: 'mutation_attempt', decision: 'skipped', reason: 'no_prunable_memory_found' };
    appendEvent(skipped);
    process.stdout.write(JSON.stringify(skipped, null, 2) + '\n');
    return;
  }

  appendEvent({
    at: nowIso(),
    type: 'mutation_attempt',
    decision: 'running',
    mutation: mutation.mutation,
    target: mutation.target,
    previous_score: previousScore,
    deleted_count: mutation.deleted_count || 0
  });

  const evalAfter = evaluate();
  fitness = readJson(FITNESS);
  const newScore1 = Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || Number(evalAfter.final_score || evalAfter.utility_score) || 0;

  // Two-stage confirmation: avoid one-shot reward spikes.
  const evalConfirm = evaluate();
  fitness = readJson(FITNESS);
  const newScore2 = Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || Number(evalConfirm.final_score || evalConfirm.utility_score) || 0;
  const confirmedScore = Math.min(newScore1, newScore2);

  if (confirmedScore > previousScore) {
    fitness.last_mutation_at = nowIso();
    writeJson(FITNESS, fitness);
    const kept = {
      at: nowIso(),
      type: 'mutation_kept',
      mutation: mutation.mutation,
      target: mutation.target,
      previous_score: previousScore,
      new_score_first_pass: newScore1,
      new_score_second_pass: newScore2,
      new_score: confirmedScore,
      deleted_count: mutation.deleted_count || 0,
      decision: 'kept'
    };
    appendEvent(kept);
    process.stdout.write(JSON.stringify(kept, null, 2) + '\n');
    return;
  }

  mutation.restore();
  const evalRevert = evaluate();
  fitness = readJson(FITNESS);
  const revertedScore = Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || Number(evalRevert.final_score || evalRevert.utility_score) || previousScore;

  const reverted = {
    at: nowIso(),
    type: 'mutation_reverted',
    mutation: mutation.mutation,
    target: mutation.target,
    previous_score: previousScore,
    new_score_first_pass: newScore1,
    new_score_second_pass: newScore2,
    new_score: confirmedScore,
    reverted_score: revertedScore,
    deleted_count: mutation.deleted_count || 0,
    decision: 'reverted'
  };
  appendEvent(reverted);
  process.stdout.write(JSON.stringify(reverted, null, 2) + '\n');
}

main();
