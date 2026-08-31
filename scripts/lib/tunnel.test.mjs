import { describe, expect, it, vi } from 'vitest';
import { waitForPort } from './tunnel.mjs';

describe('waitForPort', () => {
  it('trả true ngay khi cổng sẵn sàng', async () => {
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(waitForPort(probe, sleep, 3)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('trả false khi hết số lần thử', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await expect(waitForPort(probe, vi.fn(), 2)).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
