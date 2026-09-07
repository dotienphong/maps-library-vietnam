import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { sleep } from './run.mjs';

/** @param {number} port @param {string} host */
export function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection(port, host);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * @param {() => Promise<boolean>} probe
 * @param {(ms: number) => Promise<void>} sleepFn
 * @param {number} attempts
 */
export async function waitForPort(probe, sleepFn, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await probe()) return true;
    if (attempt < attempts - 1) await sleepFn(1000);
  }
  return false;
}

/**
 * Mở Cloudflare Tunnel tới Postgres máy chủ và trỏ DATABASE_URL vào 127.0.0.1:5433.
 * Không có DB_TUNNEL_HOSTNAME/PIPELINE_DATABASE_URL thì không làm gì (dùng DATABASE_URL sẵn có).
 * Trả hàm cleanup idempotent.
 * @param {(message: string) => void} [log]
 */
export async function openDatabaseTunnel(log = console.log) {
  if (!process.env.DB_TUNNEL_HOSTNAME || !process.env.PIPELINE_DATABASE_URL) return () => {};
  const child = spawn('cloudflared', ['access', 'tcp'], {
    stdio: 'inherit',
    // Dùng env cloudflared hỗ trợ để service secret không xuất hiện trong process arguments.
    env: {
      ...process.env,
      TUNNEL_SERVICE_HOSTNAME: process.env.DB_TUNNEL_HOSTNAME,
      TUNNEL_SERVICE_URL: '127.0.0.1:5433',
      TUNNEL_SERVICE_TOKEN_ID: process.env.CF_ACCESS_CLIENT_ID ?? '',
      TUNNEL_SERVICE_TOKEN_SECRET: process.env.CF_ACCESS_CLIENT_SECRET ?? '',
    },
  });
  /** @type {Error | undefined} */
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const close = () => {
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
  };
  process.once('exit', close);
  const ready = await waitForPort(() => probePort(5433), sleep, 30);
  if (!ready) {
    process.removeListener('exit', close);
    close();
    if (spawnError) throw spawnError;
    throw new Error(`Tunnel ${process.env.DB_TUNNEL_HOSTNAME} không mở cổng 127.0.0.1:5433`);
  }
  process.env.DATABASE_URL = process.env.PIPELINE_DATABASE_URL;
  log(`DB qua Tunnel ${process.env.DB_TUNNEL_HOSTNAME}`);
  return () => {
    process.removeListener('exit', close);
    close();
  };
}
