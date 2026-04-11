'use strict';

/**
 * Basic tests for bree-plugin-one-time
 * Run: node test/index.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const QUEUE_FILE = path.join(__dirname, 'test-queue.json');

// Clean up before tests
function cleanup() {
  try { fs.unlinkSync(QUEUE_FILE); } catch {}
}

cleanup();

// ── Mock Bree for unit testing ─────────────────────────────────────────────

const EventEmitter = require('events');

class MockBree extends EventEmitter {
  constructor() {
    super();
    this.config = { jobs: [] };
    this._added = [];
    this._initialized = false;
    this._started = false;
  }
}

MockBree.prototype.add = function(jobs) {
  const arr = Array.isArray(jobs) ? jobs : [jobs];
  this._added.push(...arr);
  for (const j of arr) this.config.jobs.push(j);
};

MockBree.prototype.init = async function() {
  this._initialized = true;
};

MockBree.prototype.start = async function() {
  this._started = true;
};

MockBree.extend = function(plugin, options) {
  if (!plugin.$i) {
    plugin(options, MockBree);
    plugin.$i = true;
  }
  return MockBree;
};

// ── Load plugin ────────────────────────────────────────────────────────────

const oneTime = require('../index.js');
// Reset install flag for tests
oneTime.$i = false;

MockBree.extend(oneTime, { queueFile: QUEUE_FILE, verbose: false });

// ── Test 1: add() persists date-based jobs ────────────────────────────────

const bree1 = new MockBree();
const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

bree1.add({
  name: 'test-job-1',
  path: './jobs/test.cjs',
  date: futureDate,
  env: { FOO: 'bar' },
});

const queue1 = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
assert.strictEqual(queue1.length, 1, 'Queue should have 1 entry after add()');
assert.strictEqual(queue1[0].name, 'test-job-1', 'Queue entry should have correct name');
assert.strictEqual(queue1[0].date, futureDate.toISOString(), 'Queue entry should store ISO date');
console.log('✓ Test 1: add() persists date-based jobs to queue file');

// ── Test 2: add() does NOT persist non-date jobs ──────────────────────────

bree1.add({ name: 'recurring-job', cron: '*/5 * * * *' });
const queue2 = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
assert.strictEqual(queue2.length, 1, 'Queue should still have 1 entry (no date job not persisted)');
console.log('✓ Test 2: add() does not persist cron/interval jobs');

// ── Test 3: init() restores future jobs, skips expired ───────────────────

// Write a queue with one future + one past job
fs.writeFileSync(QUEUE_FILE, JSON.stringify([
  { name: 'future-job', path: './jobs/x.cjs', date: new Date(Date.now() + 3600000).toISOString() },
  { name: 'past-job',   path: './jobs/x.cjs', date: new Date(Date.now() - 3600000).toISOString() },
]));

const bree2 = new MockBree();
bree2.init().then(() => {
  const restoredNames = bree2._added.map(j => j.name);
  assert.ok(restoredNames.includes('future-job'), 'init() should restore future job');
  assert.ok(!restoredNames.includes('past-job'), 'init() should skip past job');

  const queueAfterInit = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  assert.strictEqual(queueAfterInit.length, 1, 'Queue should only contain future job after init()');
  console.log('✓ Test 3: init() restores future jobs, skips expired ones');

  // ── Test 4: worker deleted cleans up queue ───────────────────────────────

  fs.writeFileSync(QUEUE_FILE, JSON.stringify([
    { name: 'cleanup-job', path: './jobs/x.cjs', date: new Date(Date.now() + 3600000).toISOString() },
  ]));

  const bree3 = new MockBree();
  bree3.start().then(() => {
    bree3.emit('worker deleted', 'cleanup-job');

    // Small delay to allow sync file write
    setTimeout(() => {
      const queueAfterDelete = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      assert.strictEqual(queueAfterDelete.length, 0, 'Queue should be empty after worker deleted');
      console.log('✓ Test 4: worker deleted event removes job from queue');

      cleanup();
      console.log('\nAll tests passed.');
    }, 50);
  });
});
