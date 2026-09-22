import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @param {string} query */
const get = (query) =>
  fetch(`${base}/v1/optimized-route?${query}`, { headers: { 'X-Api-Key': key } });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
// from Nhà thờ Đức Bà; stops Bitexco, Nhà hát TP; to Bến Thành.
const FROM = '10.7798,106.6990';
const STOPS = '10.7716,106.7043;10.7769,106.7032';
const TO = '10.7725,106.6980';

describe('/v1/optimized-route trên Valhalla fixture Quận 1', () => {
  it('order là hoán vị của [0, 1]; 3 leg; 4 waypoint theo thứ tự đi; câu tiếng Việt', async () => {
    const response = await get(`from=${FROM}&stops=${STOPS}&to=${TO}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect([...body.order].sort()).toEqual([0, 1]);
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].legs).toHaveLength(3);
    expect(body.waypoints).toHaveLength(4);
    expect(body.waypoints[0].location).toEqual([106.699, 10.7798]);
    expect(body.waypoints[3].location).toEqual([106.698, 10.7725]);
    const steps = body.routes[0].legs.flatMap(
      (/** @type {{ steps: { instruction: string }[] }} */ leg) => leg.steps,
    );
    expect(steps.some((/** @type {{ instruction: string }} */ s) => VI.test(s.instruction))).toBe(
      true,
    );
  });

  it('bỏ to → quay về from: waypoint cuối trùng from, 3 leg', async () => {
    const response = await get(`from=${FROM}&stops=${STOPS}&mode=car`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.waypoints.at(-1).location).toEqual([106.699, 10.7798]);
    expect(body.routes[0].legs).toHaveLength(3);
  });

  it('một stop ngoài graph (Vũng Tàu) → 404 no_route', async () => {
    const response = await get(`from=${FROM}&stops=10.3460,107.0843;10.7769,106.7032`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('no_route');
  });
});
