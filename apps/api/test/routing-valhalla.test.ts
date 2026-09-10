import { fetchMock } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  callValhalla,
  fetchValhallaStatus,
  mapValhallaError,
  routingBase,
  routingHeaders,
  valhallaBody,
} from '../src/routing/valhalla';

const env = { ROUTING_BASE: 'https://routing.test/' } as never;
const params = {
  locations: [
    { lat: 10.7798, lng: 106.699 },
    { lat: 10.7725, lng: 106.698 },
  ],
  mode: 'motorbike' as const,
  lang: 'vi' as const,
  alternatives: false,
};
const code = (e: unknown) => (e as ApiError).code;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('valhallaBody', () => {
  it('ánh xạ mode→costing, lang→locale, lat/lng→lat/lon type break, id', () => {
    expect(valhallaBody(params, 'req-1')).toEqual({
      locations: [
        { lat: 10.7798, lon: 106.699, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'motor_scooter',
      directions_options: { language: 'vi-VN', units: 'kilometers' },
      id: 'req-1',
    });
    expect(valhallaBody({ ...params, mode: 'car', lang: 'en' }, 'r').costing).toBe('auto');
    expect(valhallaBody({ ...params, mode: 'walk' }, 'r').costing).toBe('pedestrian');
    expect(valhallaBody({ ...params, lang: 'en' }, 'r').directions_options.language).toBe('en-US');
  });

  it('alternates chỉ có khi alternatives=true', () => {
    expect('alternates' in valhallaBody(params, 'r')).toBe(false);
    expect(valhallaBody({ ...params, alternatives: true }, 'r').alternates).toBe(1);
  });
});

describe('routingBase / routingHeaders', () => {
  it('cắt dấu / cuối; vắng ROUTING_BASE → 503 upstream_unavailable', () => {
    expect(routingBase({ ROUTING_BASE: 'https://x.test/' })).toBe('https://x.test');
    expect(() => routingBase({})).toThrowError(ApiError);
    try {
      routingBase({ ROUTING_BASE: '' });
    } catch (e) {
      expect((e as ApiError).status).toBe(503);
      expect(code(e)).toBe('upstream_unavailable');
    }
  });

  it('header Access chỉ khi đủ cả hai secret VÀ đích là https (không lộ token qua http)', () => {
    const secrets = { ROUTING_ACCESS_CLIENT_ID: 'id', ROUTING_ACCESS_CLIENT_SECRET: 's' };
    expect(routingHeaders({}, 'https://x.test')).toEqual({ 'content-type': 'application/json' });
    expect(routingHeaders({ ROUTING_ACCESS_CLIENT_ID: 'id' }, 'https://x.test')).toEqual({
      'content-type': 'application/json',
    });
    expect(routingHeaders(secrets, 'https://x.test')).toEqual({
      'content-type': 'application/json',
      'CF-Access-Client-Id': 'id',
      'CF-Access-Client-Secret': 's',
    });
    expect(routingHeaders(secrets, 'http://127.0.0.1:8002')).toEqual({
      'content-type': 'application/json',
    });
  });
});

describe('mapValhallaError', () => {
  it('HTTP 400 + 441/442/170/171 → 404 no_route; 400 khác → 400; mọi status khác → 503', () => {
    for (const errorCode of [441, 442, 170, 171]) {
      expect(mapValhallaError(400, { error_code: errorCode })).toMatchObject({
        status: 404,
        code: 'no_route',
      });
    }
    expect(mapValhallaError(400, { error_code: 154 })).toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(mapValhallaError(400, null).message).toContain('400');
    for (const status of [302, 401, 403, 404, 405, 500, 502]) {
      expect(mapValhallaError(status, null)).toMatchObject({
        status: 503,
        code: 'upstream_unavailable',
      });
    }
  });
});

describe('callValhalla / fetchValhallaStatus (fetchMock)', () => {
  it('200 → trả JSON; 400+442 → no_route; 500 → 503; lỗi mạng → 503', async () => {
    const origin = fetchMock.get('https://routing.test');
    origin.intercept({ path: '/route', method: 'POST' }).reply(200, { trip: { legs: [] } });
    expect(await callValhalla(env, {})).toEqual({ trip: { legs: [] } });

    origin.intercept({ path: '/route', method: 'POST' }).reply(400, { error_code: 442 });
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 404, code: 'no_route' });

    origin.intercept({ path: '/route', method: 'POST' }).reply(500, 'boom');
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });

    origin.intercept({ path: '/route', method: 'POST' }).replyWithError(new Error('ECONNREFUSED'));
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });

    origin.intercept({ path: '/route', method: 'POST' }).reply(200, '<html>login</html>');
    await expect(callValhalla(env, {})).rejects.toMatchObject({ status: 503 });
  });

  it('timeout → 503', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
      });
    await expect(callValhalla(env, {}, { fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({
      status: 503,
      code: 'upstream_unavailable',
    });
  });

  it('status: 200 → version + tileset_last_modified; 500 → 503', async () => {
    const origin = fetchMock.get('https://routing.test');
    origin
      .intercept({ path: '/status', method: 'GET' })
      .reply(200, { version: '3.8.3', tileset_last_modified: 1789430400 });
    expect(await fetchValhallaStatus(env)).toEqual({
      version: '3.8.3',
      tileset_last_modified: 1789430400,
    });
    origin.intercept({ path: '/status', method: 'GET' }).reply(500, 'x');
    await expect(fetchValhallaStatus(env)).rejects.toMatchObject({ status: 503 });
  });
});
