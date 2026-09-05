import { execFileSync, spawn } from 'node:child_process';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function tailnetIp() {
  try {
    const value = execFileSync('tailscale', ['ip', '-4'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (
      !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/u.test(value)
    ) {
      fail('Tailscale did not return a private CGNAT IPv4 address.');
    }
    return value;
  } catch (error) {
    fail(
      `Tailscale must be installed and connected before starting private live voice. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

const ip = tailnetIp();
process.stdout.write(
  [
    "Starting LiveKit's development server on loopback and this Mac's tailnet address.",
    `Signal: ws://${ip}:7880`,
    `Web/TLS signal: use npm run tailscale:serve, then read npm run tailscale:status.`,
    'Credentials: devkey / secret (development only).',
    '',
  ].join('\n'),
);

const child = spawn(
  process.env.LIVEKIT_COMMAND?.trim() || 'livekit-server',
  ['--dev', '--bind', '127.0.0.1', '--bind', ip, '--node-ip', ip],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) =>
  fail(
    `Could not start livekit-server. Install it with "brew install livekit" or set LIVEKIT_COMMAND. (${error.message})`,
  ),
);
child.once('exit', (code, signal) => {
  process.exitCode = signal === null ? (code ?? 1) : 1;
});
