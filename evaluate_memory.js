#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MEMORY_FILE = path.join(ROOT, 'memory.md');
const TEMPLATE_FILE = path.join(ROOT, 'memory_summarization_template.md');
const CATEGORY_FILE = path.join(ROOT, 'memory_categorization_logic.json');
const FITNESS_FILE = path.join(ROOT, 'memory_fitness.json');
const EVENTS_FILE = path.join(ROOT, 'events.jsonl');
const CHECKPOINT_DIR = path.join(ROOT, 'memory_checkpoints');
const GENESIS_FILE = path.join(ROOT, 'genesis_memory.md');

const REQUIRED_PLACEHOLDERS = ['{{date}}', '{{fact_1}}', '{{decision_1}}', '{{risk_1}}', '{{action_1}}'];

const DEFAULT_WEIGHTS = {
  memory_file_exists: 0.08,
  template_required_placeholder_ratio: 0.08,
  categorization_coverage_ratio: 0.12,
  line_count_zone_score: 0.08,
  heading_count_zone_score: 0.06,
  categorization_pattern_count_score: 0.05,
  categorization_category_count_score: 0.05,
  pruning_gain_score: 0.16,
  deletion_reward_score: 0.16,
  redundancy_reduction_score: 0.12,
  redundancy_penalty: -0.07,
  conflict_penalty: -0.05,
  length_inflation_penalty: -0.04
};

function readText(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function round6(v) { return Math.round(v * 1e6) / 1e6; }
function nowIso() { return new Date().toISOString(); }
function appendEvent(obj) { fs.appendFileSync(EVENTS_FILE, JSON.stringify(obj) + '\n', 'utf8'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function loadFitness() {
  if (!fs.existsSync(FITNESS_FILE)) throw new Error('memory_fitness.json missing');
  return JSON.parse(fs.readFileSync(FITNESS_FILE, 'utf8'));
}

function readRecentEvents(limit = 300) {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  return fs.readFileSync(EVENTS_FILE, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function inOptimalZoneScore(value, min, max) {
  if (value < min) return clamp01(value / min);
  if (value > max) return clamp01(max / value);
  return 1;
}

function computeMetrics(config, prevFitness) {
  const memoryText = readText(MEMORY_FILE);
  const templateText = readText(TEMPLATE_FILE);
  const categoryRaw = readText(CATEGORY_FILE);

  const allLines = memoryText.split(/\r?\n/);
  const nonemptyLineItems = allLines.map((l) => l.trim()).filter(Boolean);
  const nonemptyLines = nonemptyLineItems.length;
  const headingCount = allLines.filter((l) => /^#{1,6}\s+/.test(l)).length;

  const lineFreq = new Map();
  nonemptyLineItems.forEach((line) => lineFreq.set(line, (lineFreq.get(line) || 0) + 1));
  let duplicateCount = 0;
  for (const c of lineFreq.values()) if (c > 1) duplicateCount += (c - 1);
  const redundancyPenalty = nonemptyLines === 0 ? 0 : duplicateCount / nonemptyLines;

  const conflictRegex = /(CONFLICT:|<<<<<<<|=======|>>>>>>>)/g;
  const conflictCount = (memoryText.match(conflictRegex) || []).length;
  const conflictPenalty = clamp01(conflictCount / 5);

  const templatePlaceholderHits = REQUIRED_PLACEHOLDERS.filter((p) => templateText.includes(p)).length;
  const templateRequiredPlaceholderRatio = REQUIRED_PLACEHOLDERS.length ? templatePlaceholderHits / REQUIRED_PLACEHOLDERS.length : 0;

  let categoryCount = 0;
  let patternCount = 0;
  let coverageRatio = 0;
  if (categoryRaw.trim()) {
    const parsed = JSON.parse(categoryRaw);
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    categoryCount = categories.length;

    const allPatterns = [];
    categories.forEach((c) => {
      const patterns = Array.isArray(c.patterns) ? c.patterns : [];
      patterns.forEach((p) => {
        if (typeof p === 'string' && p.trim()) allPatterns.push(p.toLowerCase());
      });
    });
    patternCount = allPatterns.length;

    const lowerMemory = memoryText.toLowerCase();
    const matched = allPatterns.filter((p) => lowerMemory.includes(p)).length;
    coverageRatio = patternCount === 0 ? 0 : matched / patternCount;
  }

  const lineZone = config.optimal_zone.nonempty_line_count;
  const headingZone = config.optimal_zone.heading_count;
  const lineCountZoneScore = inOptimalZoneScore(nonemptyLines, lineZone.min, lineZone.max);
  const headingCountZoneScore = inOptimalZoneScore(headingCount, headingZone.min, headingZone.max);
  const lengthInflationPenalty = nonemptyLines <= lineZone.max ? 0 : clamp01((nonemptyLines - lineZone.max) / lineZone.max);

  const prevMetrics = prevFitness && prevFitness.metrics ? prevFitness.metrics : {};
  const prevLineCount = Number(prevMetrics.memory_nonempty_line_count) || nonemptyLines;
  const prevRedundancy = Number(prevMetrics.redundancy_penalty) || 0;

  // Positive when memory gets shorter (or stable), negative growth gets zero reward.
  const lineReduction = Math.max(0, prevLineCount - nonemptyLines);
  const deletionRewardScore = prevLineCount > 0 ? clamp01(lineReduction / prevLineCount) : 0;
  const pruningGainScore = clamp01((prevLineCount - nonemptyLines + 1) / (prevLineCount + 1));
  const redundancyReductionScore = clamp01(prevRedundancy - redundancyPenalty);

  return {
    memory_file_exists: fs.existsSync(MEMORY_FILE) ? 1 : 0,
    memory_nonempty_line_count: nonemptyLines,
    memory_heading_count: headingCount,
    duplicate_count: duplicateCount,
    conflict_count: conflictCount,
    template_required_placeholder_ratio: round6(clamp01(templateRequiredPlaceholderRatio)),
    categorization_category_count: categoryCount,
    categorization_pattern_count: patternCount,
    categorization_coverage_ratio: round6(clamp01(coverageRatio)),
    line_count_zone_score: round6(clamp01(lineCountZoneScore)),
    heading_count_zone_score: round6(clamp01(headingCountZoneScore)),
    redundancy_penalty: round6(clamp01(redundancyPenalty)),
    conflict_penalty: round6(clamp01(conflictPenalty)),
    length_inflation_penalty: round6(clamp01(lengthInflationPenalty)),
    deletion_reward_score: round6(deletionRewardScore),
    pruning_gain_score: round6(pruningGainScore),
    redundancy_reduction_score: round6(redundancyReductionScore)
  };
}

function normalizeMetricForScore(m) {
  return {
    memory_file_exists: m.memory_file_exists,
    template_required_placeholder_ratio: m.template_required_placeholder_ratio,
    categorization_coverage_ratio: m.categorization_coverage_ratio,
    line_count_zone_score: m.line_count_zone_score,
    heading_count_zone_score: m.heading_count_zone_score,
    categorization_pattern_count_score: clamp01(m.categorization_pattern_count / 32),
    categorization_category_count_score: clamp01(m.categorization_category_count / 8),
    pruning_gain_score: m.pruning_gain_score,
    deletion_reward_score: m.deletion_reward_score,
    redundancy_reduction_score: m.redundancy_reduction_score,
    redundancy_penalty: m.redundancy_penalty,
    conflict_penalty: m.conflict_penalty,
    length_inflation_penalty: m.length_inflation_penalty
  };
}

function computeUtilityScore(normalized, weights) {
  let score = 0;
  Object.keys(weights).forEach((k) => {
    score += (Number(weights[k]) || 0) * (Number(normalized[k]) || 0);
  });
  return round6(clamp01(score));
}

function listCheckpointDates() {
  ensureDir(CHECKPOINT_DIR);
  const files = fs.readdirSync(CHECKPOINT_DIR).filter((f) => /^fitness_checkpoint_\d{8}\.json$/.test(f));
  return files.map((f) => f.match(/(\d{8})/)[1]).sort();
}

function readCheckpointFitness(dateTag) {
  const p = path.join(CHECKPOINT_DIR, `fitness_checkpoint_${dateTag}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function createCheckpointIfDue(fitnessObj, metrics, utilityScore) {
  ensureDir(CHECKPOINT_DIR);
  const todayTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dates = listCheckpointDates();
  const lastTag = dates.length ? dates[dates.length - 1] : null;

  let due = false;
  if (!lastTag) due = true;
  else {
    const lastDate = new Date(`${lastTag.slice(0,4)}-${lastTag.slice(4,6)}-${lastTag.slice(6,8)}T00:00:00Z`);
    const dayMs = 24 * 60 * 60 * 1000;
    due = (Date.now() - lastDate.getTime()) >= 7 * dayMs;
  }
  if (!due) return null;

  const memoryCp = path.join(CHECKPOINT_DIR, `memory_checkpoint_${todayTag}.md`);
  const fitnessCp = path.join(CHECKPOINT_DIR, `fitness_checkpoint_${todayTag}.json`);
  fs.writeFileSync(memoryCp, readText(MEMORY_FILE), 'utf8');

  const baseline = {
    at: nowIso(),
    utility_score: utilityScore,
    metrics,
    categorization_coverage_ratio: metrics.categorization_coverage_ratio,
    memory_nonempty_line_count: metrics.memory_nonempty_line_count,
    memory_heading_count: metrics.memory_heading_count,
    categorization_category_count: metrics.categorization_category_count
  };
  fs.writeFileSync(fitnessCp, JSON.stringify(baseline, null, 2) + '\n', 'utf8');

  const allDates = listCheckpointDates();
  if (allDates.length > 8) {
    const toDelete = allDates.slice(0, allDates.length - 8);
    toDelete.forEach((tag) => {
      const m = path.join(CHECKPOINT_DIR, `memory_checkpoint_${tag}.md`);
      const f = path.join(CHECKPOINT_DIR, `fitness_checkpoint_${tag}.json`);
      if (fs.existsSync(m)) fs.unlinkSync(m);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  }

  appendEvent({ at: nowIso(), type: 'checkpoint_created', checkpoint_date: todayTag, utility_score: utilityScore });
  return todayTag;
}

function computeDriftScore(currentUtility, metrics, baseline) {
  if (!baseline) return 0;
  const bu = Number(baseline.utility_score) || 0;
  const bm = baseline.metrics || baseline;
  const bLines = Number(bm.memory_nonempty_line_count) || 1;
  const bHeads = Number(bm.memory_heading_count) || 1;
  const bCats = Number(bm.categorization_category_count) || 1;
  const bCoverage = Number(bm.categorization_coverage_ratio) || 0;

  const utilityDiff = Math.abs(currentUtility - bu);
  const structuralDelta =
    Math.abs((metrics.memory_nonempty_line_count - bLines) / bLines) +
    Math.abs((metrics.memory_heading_count - bHeads) / bHeads) +
    Math.abs((metrics.categorization_category_count - bCats) / bCats);
  const categoryDistributionDelta = Math.abs(metrics.categorization_coverage_ratio - bCoverage);

  return round6(utilityDiff + structuralDelta + categoryDistributionDelta);
}

function latestCheckpointTag() {
  const dates = listCheckpointDates();
  return dates.length ? dates[dates.length - 1] : null;
}

function restoreFromCheckpoint(tag) {
  const m = path.join(CHECKPOINT_DIR, `memory_checkpoint_${tag}.md`);
  const f = path.join(CHECKPOINT_DIR, `fitness_checkpoint_${tag}.json`);
  if (!fs.existsSync(m) || !fs.existsSync(f)) return false;
  fs.writeFileSync(MEMORY_FILE, fs.readFileSync(m, 'utf8'), 'utf8');
  return true;
}

function countRecentGlobalRollbacks(days) {
  if (!fs.existsSync(EVENTS_FILE)) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return fs.readFileSync(EVENTS_FILE, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.type === 'global_rollback' && new Date(e.at).getTime() >= cutoff)
    .length;
}

function ensureGenesisAnchor() {
  if (!fs.existsSync(GENESIS_FILE)) {
    fs.writeFileSync(GENESIS_FILE, readText(MEMORY_FILE), 'utf8');
    appendEvent({ at: nowIso(), type: 'genesis_anchor_created' });
  }
}

function countRecentPruneRewards() {
  const events = readRecentEvents(500);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return events.filter((e) => {
    if (!e || !e.at) return false;
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t) || t < cutoff) return false;
    return e.type === 'memory_prune' || (e.type === 'mutation_kept' && String(e.mutation || '').startsWith('prune_'));
  }).length;
}

function main() {
  ensureDir(CHECKPOINT_DIR);
  ensureGenesisAnchor();

  const fitness = loadFitness();
  const previousFinalScore = Number(fitness.final_score != null ? fitness.final_score : fitness.utility_score) || 0;

  const config = {
    optimal_zone: fitness.optimal_zone || { nonempty_line_count: { min: 20, max: 40 }, heading_count: { min: 4, max: 8 } },
    stagnation_threshold: Number(fitness.stagnation_threshold) || 3,
    drift_threshold: Number(fitness.drift_threshold) || 0.25
  };

  const weights = Object.assign({}, DEFAULT_WEIGHTS, fitness.weights || {});
  const metrics = computeMetrics(config, fitness);

  const pruneRewards = countRecentPruneRewards();
  if (pruneRewards > 0) {
    metrics.pruning_gain_score = round6(clamp01(metrics.pruning_gain_score + Math.min(0.2, pruneRewards * 0.05)));
  }

  const normalized = normalizeMetricForScore(metrics);
  const utilityScore = computeUtilityScore(normalized, weights);

  createCheckpointIfDue(fitness, metrics, utilityScore);
  const cpTag = latestCheckpointTag();
  const baseline = cpTag ? readCheckpointFitness(cpTag) : null;

  const driftScore = computeDriftScore(utilityScore, metrics, baseline);
  const driftThreshold = config.drift_threshold;
  const driftWarningCounter = driftScore > driftThreshold ? (Number(fitness.drift_warning_counter) || 0) + 1 : 0;
  if (driftScore > driftThreshold) {
    appendEvent({ at: nowIso(), type: 'drift_warning', drift_score: driftScore, drift_threshold: driftThreshold, drift_warning_counter: driftWarningCounter });
  }

  const stabilityBonus = round6(clamp01(1 - driftScore));
  const finalScore = round6(clamp01(utilityScore * 0.9 + stabilityBonus * 0.1));

  const unchanged = Math.abs(finalScore - previousFinalScore) < 1e-6;
  const nextStagnation = unchanged ? (Number(fitness.stagnation_counter) || 0) + 1 : 0;
  const explorationReady = nextStagnation >= config.stagnation_threshold;

  let freezeUntil = fitness.mutation_freeze_until || null;
  let rollbacked = false;
  let emergencyReset = false;

  if (driftWarningCounter >= 3 && cpTag) {
    rollbacked = restoreFromCheckpoint(cpTag);
    if (rollbacked) {
      freezeUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      appendEvent({ at: nowIso(), type: 'global_rollback', reason: 'excessive_drift', checkpoint_date: cpTag, drift_score: driftScore });

      const recentGlobalRollbacks = countRecentGlobalRollbacks(7);
      if (recentGlobalRollbacks >= 2 && fs.existsSync(GENESIS_FILE)) {
        fs.writeFileSync(MEMORY_FILE, fs.readFileSync(GENESIS_FILE, 'utf8'), 'utf8');
        freezeUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        emergencyReset = true;
        appendEvent({ at: nowIso(), type: 'emergency_reset', reason: 'double_global_rollback_within_7_days' });
      }
    }
  }

  const next = {
    ...fitness,
    schema_version: 4,
    utility_score: utilityScore,
    final_score: finalScore,
    stability_bonus: stabilityBonus,
    drift_score: driftScore,
    drift_threshold: driftThreshold,
    drift_warning_counter: rollbacked ? 0 : driftWarningCounter,
    metrics,
    weights,
    optimal_zone: config.optimal_zone,
    stagnation_threshold: config.stagnation_threshold,
    stagnation_counter: rollbacked ? 0 : nextStagnation,
    exploration_ready: rollbacked ? false : explorationReady,
    mutation_freeze_until: freezeUntil,
    last_checkpoint_date: cpTag || null,
    last_evaluated_at: nowIso(),
    history: Array.isArray(fitness.history)
      ? [...fitness.history, { at: nowIso(), utility_score: utilityScore, final_score: finalScore, drift_score: driftScore, metrics }]
      : [{ at: nowIso(), utility_score: utilityScore, final_score: finalScore, drift_score: driftScore, metrics }]
  };

  fs.writeFileSync(FITNESS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    utility_score: utilityScore,
    final_score: finalScore,
    drift_score: driftScore,
    drift_warning_counter: next.drift_warning_counter,
    exploration_ready: next.exploration_ready,
    rollbacked,
    emergency_reset: emergencyReset,
    mutation_freeze_until: next.mutation_freeze_until,
    metrics
  }, null, 2) + '\n');
}

main();
