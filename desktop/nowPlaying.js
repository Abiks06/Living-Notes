// Runs the Now Playing helper while System audio is on, and passes its messages to the page.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const VERBS = new Set(['toggle', 'next', 'previous']);
const MAX_FIELD = 512;

/** Commands are tab-separated lines, so nothing from a song's name can add a field or a line. */
const field = (text) => text.replace(/[\t\r\n]/g, ' ').slice(0, MAX_FIELD);

export function nowPlayingHelper(path, send) {
  let child = null;

  return {
    start() {
      if (child) return;
      const started = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      const finished = () => {
        if (child === started) child = null;
      };
      child = started;
      started.once('error', finished);
      started.once('exit', finished);
      started.stdin.on('error', () => undefined);
      createInterface({ input: started.stdout }).on('line', (line) => {
        try {
          send(JSON.parse(line));
        } catch {
          // Half a message from a helper being stopped.
        }
      });
    },
    stop() {
      // The helper exits when its input closes.
      child?.stdin.end();
      child = null;
    },
    command(verb, id, title) {
      if (!VERBS.has(verb) || typeof id !== 'string' || typeof title !== 'string') return;
      child?.stdin.write(`${verb}\t${field(id)}\t${field(title)}\n`);
    },
  };
}
