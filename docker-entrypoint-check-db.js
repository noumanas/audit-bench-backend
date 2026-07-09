// Fails fast with a clear message when the database isn't reachable, instead
// of letting `prisma migrate deploy` hang until the platform's startup
// timeout kills the container (Cloud Run's generic "failed to start and
// listen on the port" error gives no hint that this was the actual cause).
const net = require('net');
const fs = require('fs');

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set. Set it as an environment variable on the service.');
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error('DATABASE_URL is not a valid connection string.');
  process.exit(1);
}

// Cloud SQL's Unix-socket form: postgresql://user:pass@localhost/db?host=/cloudsql/PROJECT:REGION:INSTANCE
const socketHost = url.searchParams.get('host');
if (socketHost && socketHost.startsWith('/')) {
  const socketPath = `${socketHost}/.s.PGSQL.5432`;
  if (!fs.existsSync(socketPath)) {
    console.error(
      `Cloud SQL socket not found at ${socketPath}. Attach the Cloud SQL connection to this ` +
        'Cloud Run service (Console: service > Edit & deploy new revision > Connections > Cloud SQL connections).',
    );
    process.exit(1);
  }
  process.exit(0);
}

const host = url.hostname;
const port = Number(url.port || 5432);
const socket = net.createConnection({ host, port, timeout: 8000 });

socket.on('connect', () => {
  socket.end();
  process.exit(0);
});
socket.on('timeout', () => {
  console.error(
    `Could not reach database at ${host}:${port} within 8s. Check DATABASE_URL, and that this ` +
      "host allows inbound connections from Cloud Run (it can't reach your laptop's localhost).",
  );
  process.exit(1);
});
socket.on('error', (err) => {
  console.error(`Could not reach database at ${host}:${port}: ${err.message}`);
  process.exit(1);
});
