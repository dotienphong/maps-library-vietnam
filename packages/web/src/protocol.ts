import { Protocol } from 'pmtiles';

let registered = false;

export interface ProtocolHost {
  addProtocol(name: string, loadFn: Protocol['tile']): void;
}

/** Đăng ký giao thức pmtiles:// đúng một lần cho toàn trang. */
export function ensurePmtilesProtocol(host: ProtocolHost): void {
  if (registered) return;
  host.addProtocol('pmtiles', new Protocol().tile);
  registered = true;
}

export function resetProtocolForTests(): void {
  registered = false;
}
