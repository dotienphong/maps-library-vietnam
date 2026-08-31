import { createConnection } from 'node:net';

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
