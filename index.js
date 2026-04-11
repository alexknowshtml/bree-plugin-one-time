'use strict';

const fs = require('fs');
const path = require('path');

/**
 * bree-plugin-one-time
 *
 * Persistent one-time job scheduling for Bree. Jobs added with a `date`
 * property are automatically saved to a JSON queue file and restored on
 * scheduler restart, so they survive process restarts.
 *
 * Usage:
 *   const Bree = require('bree');
 *   const oneTime = require('bree-plugin-one-time');
 *   Bree.extend(oneTime, { queueFile: './one-time-queue.json' });
 *
 * Then add jobs as normal — any job with a `date` property is auto-persisted:
 *   bree.add({ name: 'my-job', path: './jobs/my-job.cjs', date: new Date('2026-04-12T13:17:00-04:00') });
 *
 * Options:
 *   Bree.extend(oneTime, {
 *     queueFile: './one-time-queue.json',  // Path to queue file (default: cwd/.bree-one-time-queue.json)
 *     verbose: false,                      // Log queue operations (default: false)
 *   });
 */

module.exports = function oneTimePlugin(options, Bree) {
  const opts = {
    queueFile: path.join(process.cwd(), '.bree-one-time-queue.json'),
    verbose: false,
    ...options
  };

  // ── Queue persistence helpers ──────────────────────────────────────────────

  function loadQueue() {
    try {
      const raw = fs.readFileSync(opts.queueFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveQueue(queue) {
    fs.writeFileSync(opts.queueFile, JSON.stringify(queue, null, 2));
  }

  function addToQueue(job) {
    const queue = loadQueue().filter(j => j.name !== job.name);
    queue.push({
      name: job.name,
      path: job.path || null,
      date: job.date instanceof Date ? job.date.toISOString() : job.date,
      worker: job.worker || null,
      env: job.env || null,
    });
    saveQueue(queue);
    if (opts.verbose) console.log(`[bree-plugin-one-time] queued: ${job.name} at ${job.date}`);
  }

  function removeFromQueue(name) {
    const queue = loadQueue().filter(j => j.name !== name);
    saveQueue(queue);
    if (opts.verbose) console.log(`[bree-plugin-one-time] dequeued: ${name}`);
  }

  // ── Wrap Bree.prototype.add ────────────────────────────────────────────────
  // Intercept jobs with a `date` property and persist them before adding to Bree.

  const originalAdd = Bree.prototype.add;

  Bree.prototype.add = function (jobs) {
    const jobsArr = Array.isArray(jobs) ? jobs : [jobs];

    for (const job of jobsArr) {
      if (job && typeof job === 'object' && job.date) {
        addToQueue(job);
      }
    }

    return originalAdd.call(this, jobs);
  };

  // ── Wrap Bree.prototype.init ───────────────────────────────────────────────
  // On startup, restore any persisted jobs that haven't fired yet.

  const originalInit = Bree.prototype.init;

  Bree.prototype.init = async function () {
    const result = await originalInit.call(this);

    const queue = loadQueue();
    const now = Date.now();
    const stillValid = [];

    for (const job of queue) {
      const fireAt = new Date(job.date).getTime();

      if (isNaN(fireAt)) {
        if (opts.verbose) console.log(`[bree-plugin-one-time] invalid date, skipping: ${job.name}`);
        continue;
      }

      if (fireAt <= now) {
        if (opts.verbose) console.log(`[bree-plugin-one-time] already past, skipping: ${job.name} (was ${job.date})`);
        continue;
      }

      // Re-register with Bree using native date-based scheduling
      const restored = {
        name: job.name,
        date: new Date(job.date),
        ...(job.path && { path: job.path }),
        ...(job.worker && { worker: job.worker }),
        ...(job.env && { env: job.env }),
      };

      try {
        await originalAdd.call(this, restored);
        stillValid.push(job);
        if (opts.verbose) console.log(`[bree-plugin-one-time] restored: ${job.name} fires at ${job.date}`);
      } catch (err) {
        console.error(`[bree-plugin-one-time] failed to restore ${job.name}:`, err.message);
      }
    }

    // Rewrite queue with only still-valid jobs
    saveQueue(stillValid);

    return result;
  };

  // ── Wrap Bree.prototype.start ──────────────────────────────────────────────
  // After start, listen for job completion to clean up the queue file.

  const originalStart = Bree.prototype.start;

  Bree.prototype.start = async function (name) {
    // Bree calls this.start(job.name) internally for each job — only attach
    // the cleanup listener on the initial no-arg "start everything" call to
    // avoid infinite recursion (Bree binds this.start in the constructor).
    if (!name) {
      this.on('worker deleted', (workerName) => {
        const queue = loadQueue();
        const wasOneTime = queue.some(j => j.name === workerName);
        if (wasOneTime) {
          removeFromQueue(workerName);
        }
      });
    }

    return originalStart.call(this, name);
  };
};
