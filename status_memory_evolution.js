#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FITNESS = path.join(ROOT, 'memory_fitness.json');
const EVENTS = path.join(ROOT, 'events.jsonl');
const CHECKPOINT_DIR = path.join(ROOT, 'memory_checkpoints');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readEvents(limit = 200) {
  if (!fs.existsSync(EVENTS)) return [];
  const lines = fs.readFileSync(EVENTS, 'utf8').split(/\r?\n/).filter(Boolean);
  const sliced = lines.slice(Math.max(0, lines.length - limit));
  return sliced.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function listCheckpointDates() {
  if (!fs.existsSync(CHECKPOINT_DIR)) return [];
  return fs.readdirSync(CHECKPOINT_DIR)
    .filter((f) => /^fitness_checkpoint_\d{8}\.json$/.test(f))
    .map((f) => f.match(/(\d{8})/)[1])
    .sort();
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function humanRemaining(ms) {
  if (ms <= 0) return '0m';
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function main() {
  if (!fs.existsSync(FITNESS)) {
    console.error('memory_fitness.json not found');
    process.exit(1);
  }

  const fitness = readJson(FITNESS);
  const events = readEvents(500);
  const checkpoints = listCheckpointDates();

  const now = Date.now();

  const freezeUntilIso = toIsoOrNull(fitness.mutation_freeze_until);
  const freezeUntilMs = freezeUntilIso ? new Date(freezeUntilIso).getTime() : 0;
  const freezeActive = !!freezeUntilIso && now < freezeUntilMs;

  const lastMutationAt = toIsoOrNull(fitness.last_mutation_at);
  const mutationIntervalMs = 6 * 60 * 60 * 1000;
  let nextMutationAllowedAt = null;
  if (lastMutationAt) {
    nextMutationAllowedAt = new Date(new Date(lastMutationAt).getTime() + mutationIntervalMs).toISOString();
  }

  const latestCheckpoint = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;

  const lastEvent = events.length ? events[events.length - 1] : null;
  const recentGlobalRollbacks7d = events.filter((e) => {
    if (e.type !== 'global_rollback' || !e.at) return false;
    const t = new Date(e.at).getTime();
    return !Number.isNaN(t) && (now - t) <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  const lastMutationEvent = [...events].reverse().find((e) => e && (e.type === 'mutation_kept' || e.type === 'mutation_reverted' || e.type === 'memory_mutation')) || null;

  const dayMs = 24 * 60 * 60 * 1000;
  const pruneEvents24h = events.filter((e) => {
    if (!e || !e.at || e.type !== 'memory_prune') return false;
    const t = new Date(e.at).getTime();
    return !Number.isNaN(t) && (now - t) <= dayMs;
  });
  const recentPruneCount = pruneEvents24h.length;
  const recentDeletedLines = pruneEvents24h.reduce((sum, e) => sum + (Number(e.deleted_count) || 0), 0);
  const zeroGainIntercepts = pruneEvents24h.reduce((sum, e) => {
    const reasons = Array.isArray(e.reasons) ? e.reasons : [];
    return sum + reasons.filter((r) => r && (r.reason === 'zero_information_gain_high_similarity' || r.reason === 'no_increment_same_category_source')).length;
  }, 0);

  const status = {
    now: new Date(now).toISOString(),
    last_evaluated_at: toIsoOrNull(fitness.last_evaluated_at),
    scores: {
      utility_score: Number(fitness.utility_score) || 0,
      final_score: Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || 0,
      stability_bonus: Number(fitness.stability_bonus != null ? fitness.stability_bonus : 0)
    },
    drift: {
      drift_score: Number(fitness.drift_score) || 0,
      drift_threshold: Number(fitness.drift_threshold) || 0.25,
      drift_warning_counter: Number(fitness.drift_warning_counter) || 0,
      within_threshold: (Number(fitness.drift_score) || 0) < (Number(fitness.drift_threshold) || 0.25)
    },
    mutation: {
      exploration_ready: !!fitness.exploration_ready,
      stagnation_counter: Number(fitness.stagnation_counter) || 0,
      stagnation_threshold: Number(fitness.stagnation_threshold) || 3,
      freeze_active: freezeActive,
      freeze_until: freezeUntilIso,
      freeze_remaining: freezeActive ? humanRemaining(freezeUntilMs - now) : '0m',
      last_mutation_at: lastMutationAt,
      last_mutation_event_at: lastMutationEvent && lastMutationEvent.at ? toIsoOrNull(lastMutationEvent.at) : null,
      next_mutation_allowed_at: nextMutationAllowedAt,
      recent_prune_count: recentPruneCount,
      recent_deleted_lines: recentDeletedLines,
      zero_gain_intercepts: zeroGainIntercepts
    },
    checkpoints: {
      total: checkpoints.length,
      latest_date: latestCheckpoint,
      retention_limit: 8
    },
    safety: {
      recent_global_rollbacks_7d: recentGlobalRollbacks7d
    },
    last_event: lastEvent
  };

  process.stdout.write(JSON.stringify(status, null, 2) + '\n');
}

main();
