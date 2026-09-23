import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  callVroom,
  FLEET_TIMEOUT_MS,
  fleetBase,
  mapVroomError,
  type VroomRequest,
} from '../src/routing/vroom';
import { fetchMock } from './helpers/fetch-mock';

const env = { FLEET_BASE: 'https://fleet.test/' } as never;
const body: VroomRequest = {
  vehicles: [{ id: 0, profile: 'motor_scooter', start: [106.698, 10.7725], max_tasks: 10 }],
  jobs: [{ id: 0, location: [106.6958, 10.7826], service: 0, priority: 0 }],
};
const mock = (status: number, reply: object | string) =>
  fetchMock.get('https://fleet.test').intercept({ path: '/', method: 'POST' }).reply(status, reply);
const loi = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
};
/** Thông điệp thật của vroom-express 0.12 / VROOM 1.15 khi một điểm nằm ngoài graph (đo 23/09/2026). */
const UNFOUND = 'Unfound route(s) from location [107.084300,10.346000]';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe('fleetBase', () => {
  it('cắt dấu / cuối; vắng FLEET_BASE → 503 nêu tên biến', () => {
    expect(fleetBase({ FLEET_BASE: 'https://x.test/fleet/' })).toBe('https://x.test/fleet');
    try {
      fleetBase({});
      throw new Error('phải ném');
    } catch (e) {
      expect((e as ApiError).status).toBe(503);
      expect((e as ApiError).message).toMatch(/FLEET_BASE/);
    }
  });
});

describe('mapVroomError', () => {
  it('413 và 400 → 400 invalid_request; code 3 Unfound → 404 no_route qua hàm đặt tên; còn lại 503', () => {
    expect(
      mapVroomError(413, { code: 4, error: 'Too many locations ( 41 ) in query' }).status,
    ).toBe(400);
    const tuChoi = mapVroomError(400, { code: 2, error: 'Invalid profile: bike.' });
    expect(tuChoi.status).toBe(400);
    expect(tuChoi.message).toMatch(/mã 2.*Invalid profile/);
    const unfound = mapVroomError(500, { code: 3, error: UNFOUND }, (error) => `tên: ${error}`);
    expect(unfound.status).toBe(404);
    expect(unfound.code).toBe('no_route');
    expect(unfound.message).toBe(`tên: ${UNFOUND}`);
    expect(mapVroomError(500, { code: 3, error: UNFOUND }).message).toMatch(/không tới được/);
    expect(
      mapVroomError(500, { code: 3, error: 'Failed to connect to valhalla:8002' }).status,
    ).toBe(503);
    expect(mapVroomError(500, { code: 1, error: 'boom' }).status).toBe(503);
    expect(mapVroomError(302, null).status).toBe(503);
  });
});

describe('callVroom', () => {
  it('POST {base}/ với header JSON, trả JSON khi code 0', async () => {
    mock(200, { code: 0, summary: { routes: 1 }, routes: [], unassigned: [] });
    const json = await callVroom(env, body);
    expect(json.code).toBe(0);
  });

  it('code khác 0 hoặc thiếu routes trong 200 → 503 dữ liệu không hợp lệ', async () => {
    mock(200, { code: 1, error: 'lạ' });
    expect((await loi(callVroom(env, body))).message).toMatch(/không hợp lệ/);
    mock(200, 'not json');
    expect((await loi(callVroom(env, body))).status).toBe(503);
  });

  it('HTTP lỗi đi qua mapVroomError; fetch ném → 503 không phản hồi', async () => {
    mock(500, { code: 3, error: UNFOUND });
    expect((await loi(callVroom(env, body))).code).toBe('no_route');
    fetchMock
      .get('https://fleet.test')
      .intercept({ path: '/', method: 'POST' })
      .replyWithError(new Error('ECONNREFUSED'));
    expect((await loi(callVroom(env, body))).message).toMatch(/không phản hồi/);
    expect(FLEET_TIMEOUT_MS).toBe(18_000);
  });
});
