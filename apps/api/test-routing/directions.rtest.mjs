import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @param {string} query */
const get = (query) => fetch(`${base}/v1/directions?${query}`, { headers: { 'X-Api-Key': key } });
// Quận 1, TP.HCM: Nhà thờ Đức Bà → Chợ Bến Thành (~1,2 km đường bộ).
const FROM = '10.7798,106.6990';
const TO = '10.7725,106.6980';
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

describe('/v1/directions trên Valhalla fixture Quận 1', () => {
  for (const mode of ['motorbike', 'car', 'walk']) {
    it(`${mode}: 200, depart → arrive, quãng đường hợp lý, câu tiếng Việt có dấu`, async () => {
      const response = await get(`from=${FROM}&to=${TO}&mode=${mode}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      const route = body.routes[0];
      expect(route.mode).toBe(mode);
      expect(route.distance_m).toBeGreaterThan(800);
      expect(route.distance_m).toBeLessThan(4_000);
      expect(route.duration_s).toBeGreaterThan(0);
      expect(route.geometry.length).toBeGreaterThan(10);
      const steps = route.legs[0].steps;
      expect(steps[0].kind).toBe('depart');
      expect(steps.at(-1).kind).toBe('arrive');
      expect(steps.some((s) => VI.test(s.instruction))).toBe(true);
      // Spec B mục 6.2: câu đã qua bảng cụm từ, và mọi bước có verbal_alert (string hoặc null).
      expect(steps.at(-1).instruction).toMatch(/^(Điểm đến ở bên (trái|phải)\.|Bạn đã tới nơi\.)$/);
      for (const s of steps) {
        expect(s).toHaveProperty('verbal_alert');
        expect(s.instruction).not.toMatch(/hình chữ U|^Sáp nhập|nằm ở (trái|phải)\.$|^Lái về phía/);
      }
      expect(body.waypoints).toHaveLength(2);
      expect(body.engine.name).toBe('valhalla');
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  }

  it('via → hai leg, shape_offset của leg 2 > 0; alternatives bị bỏ qua', async () => {
    const response = await get(`from=${FROM}&via=10.7760,106.6985&to=${TO}&alternatives=1`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].legs).toHaveLength(2);
    expect(body.routes[0].legs[1].shape_offset).toBeGreaterThan(0);
    expect(body.waypoints).toHaveLength(3);
  });

  it('lang=en → câu tiếng Anh', async () => {
    const body = await (await get(`from=${FROM}&to=${TO}&lang=en`)).json();
    expect(body.routes[0].legs[0].steps[0].instruction).toMatch(/^(Head|Drive|Walk|Bike|Go)/);
  });

  it('điểm ngoài graph fixture (Hà Nội) → 404 no_route', async () => {
    const response = await get('from=21.0285,105.8542&to=21.0369,105.8348&mode=walk');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('no_route');
  });

  it('/healthz/routing → ok, version, graph_built_at ISO', async () => {
    const response = await fetch(`${base}/healthz/routing`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+/);
    expect(body.graph_built_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
