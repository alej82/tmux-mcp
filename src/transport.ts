import type { Config } from './config.js';
import type { CommandSpec } from './types.js';

export type TransportMode = 'host' | 'direct';

export class Transport {
  readonly mode: TransportMode;

  constructor(private readonly config: Config) {
    this.mode = config.hostExec ? 'host' : 'direct';
  }

  describe(): string {
    if (this.mode === 'host') {
      return `mode=host executor=${this.config.hostExec} tmux=${this.config.tmuxBin} socket=${this.config.socket} home=${this.config.hostHome}`;
    }
    return `mode=direct tmux=${this.config.tmuxBin} socket=${this.config.socket}`;
  }

  tmux(args: string[]): CommandSpec {
    return this.wrap([this.config.tmuxBin, '-S', this.config.socket, ...args]);
  }

  wait(nonce: string, seconds: number): CommandSpec {
    if (this.config.waitBin) {
      return this.wrap([
        this.config.waitBin,
        `${seconds}s`,
        this.config.tmuxBin,
        '-S',
        this.config.socket,
        'wait-for',
        nonce,
      ]);
    }
    return this.wrap([this.config.tmuxBin, '-S', this.config.socket, 'wait-for', nonce]);
  }

  shell(script: string, args: string[]): CommandSpec {
    return this.wrap(['/bin/sh', '-c', script, 'sh', ...args]);
  }

  private wrap(argv: string[]): CommandSpec {
    if (this.mode === 'host') {
      return {
        file: this.config.hostExec as string,
        args: [
          '/usr/bin/env',
          '-i',
          `HOME=${this.config.hostHome}`,
          `PATH=${this.config.hostPath}`,
          `LANG=${this.config.lang}`,
          ...argv,
        ],
      };
    }

    const [file, ...args] = argv;
    if (!file) {
      throw new Error('empty command');
    }
    return {
      file,
      args,
      env: {
        HOME: this.config.hostHome,
        PATH: this.config.hostPath,
        LANG: this.config.lang,
      },
    };
  }
}
