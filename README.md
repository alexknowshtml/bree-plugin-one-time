# bree-plugin-one-time

Persistent one-time job scheduling for [Bree](https://github.com/breejs/bree). Jobs added with a `date` property are automatically saved to a JSON queue file and restored on scheduler restart — so they survive process restarts.

## The problem

Bree natively supports one-time jobs via the `date` property, but they only live in memory. If your scheduler process restarts before the job fires, the job is silently lost.

## The solution

This plugin wraps `Bree.prototype.add` to detect date-based jobs and persist them to a local JSON file. On `init`, it reads the file and re-registers any jobs that haven't fired yet. On job completion, the entry is removed from the file automatically.

## Install

```sh
npm install bree-plugin-one-time
```

## Usage

```js
const Bree = require('bree');
const oneTime = require('bree-plugin-one-time');

Bree.extend(oneTime, {
  queueFile: './jobs/one-time-queue.json', // optional, default: cwd/.bree-one-time-queue.json
  verbose: true,                            // optional, default: false
});

const bree = new Bree({ jobs: [] });
await bree.init();
await bree.start();

// Schedule a one-time job — automatically persisted
bree.add({
  name: 'send-flight-reminder',
  path: './jobs/discord-ping.cjs',
  date: new Date('2026-04-12T13:17:00-04:00'),
  env: {
    DISCORD_CHANNEL_ID: '1234567890',
    DISCORD_USER_ID: '279033205628207104',
    MESSAGE: 'Check in to AA 5838 SAV → PHL — confirmation KJEVBS',
  },
});
```

If the scheduler restarts before `2026-04-12T13:17:00`, the job is restored from the queue file and will still fire on time.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `queueFile` | `string` | `cwd/.bree-one-time-queue.json` | Path to the JSON queue file |
| `verbose` | `boolean` | `false` | Log queue operations to console |

## How it works

1. **`add`** — wraps `Bree.prototype.add`. Any job with a `date` property is written to the queue file before being passed to Bree.
2. **`init`** — wraps `Bree.prototype.init`. After initialization, reads the queue file, skips expired jobs, re-registers future jobs with Bree.
3. **`start`** — wraps `Bree.prototype.start`. Attaches a `worker deleted` listener to remove completed jobs from the queue file.

## Queue file format

```json
[
  {
    "name": "send-flight-reminder",
    "path": "./jobs/discord-ping.cjs",
    "date": "2026-04-12T17:17:00.000Z",
    "worker": null,
    "env": {
      "DISCORD_CHANNEL_ID": "1234567890",
      "MESSAGE": "Check in to your flight!"
    }
  }
]
```
