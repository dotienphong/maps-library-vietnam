import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';
import type { FleetPlanOptions, FleetPlanResponse } from './types';

const PLAN: FleetPlanResponse = {
  mode: 'motorbike',
  vehicles: [],
  unassigned: [],
  summary: {
    vehicles_used: 0,
    jobs_assigned: 0,
    jobs_unassigned: 0,
    distance_m: 0,
    duration_s: 0,
    service_s: 0,
    waiting_s: 0,
  },
  attribution: '© OpenStreetMap contributors',
};

describe('client.fleetPlan', () => {
  it('POST /v1/fleet-plan, body JSON giữ nguyên [lat, lng] và mọi trường tuỳ chọn', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(PLAN), { headers: { 'content-type': 'application/json' } }),
    );
    const client = createClient({
      apiKey: 'mlv_live_test00000000000000000000',
      baseUrl: 'https://api.test/',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const opts: FleetPlanOptions = {
      mode: 'car',
      vehicles: [
        { id: 'xe-1', start: [10.7725, 106.698], capacity: 20, max_jobs: 4 },
        { id: 'xe-2', start: [10.7725, 106.698], end: 'open' },
      ],
      jobs: [
        {
          id: 'don-1',
          location: [10.7826, 106.6958],
          demand: 3,
          service_s: 300,
          time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']],
        },
      ],
    };
    const result = await client.fleetPlan(opts);
    expect(result).toEqual(PLAN);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new URL(url).pathname).toBe('/v1/fleet-plan');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['X-Api-Key']).toBe('mlv_live_test00000000000000000000');
    expect(JSON.parse(String(init.body))).toEqual(opts);
  });
});
