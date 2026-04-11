import Bree from 'bree';

export interface OneTimePluginOptions {
  /** Path to the JSON queue file. Default: cwd/.bree-one-time-queue.json */
  queueFile?: string;
  /** Log queue operations to console. Default: false */
  verbose?: boolean;
}

declare function oneTimePlugin(options: OneTimePluginOptions, Bree: typeof Bree): void;

export = oneTimePlugin;
