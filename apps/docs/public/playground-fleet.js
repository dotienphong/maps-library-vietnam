/**
 * Tab "Đội xe" của Playground: `GET /v1/matrix`, `GET /v1/optimized-route` (spec 22/09/2026) và
 * `POST /v1/fleet-plan` (spec 23/09/2026).
 * Sở hữu mọi phần tử `#fl-*` và marker đánh số của mình; tuyến vẽ qua `map.routes` dùng chung với
 * chế độ dẫn đường, nên playground gọi `clearRoute()` trước khi vào dẫn đường.
 */
import {
  FLEET_SAMPLE,
  fleetPlanRequest,
  fleetSnippet,
  matrixPlan,
  optimizedPlan,
  pointFromAutocomplete,
  pointFromLngLat,
  shortDistance,
  shortDuration,
  visitLegs,
} from '/playground-lib.js';

/** @typedef {import('/playground-lib.js').NavPoint} NavPoint */

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {{
 *   sdk: any,
 *   getMap: () => any,
 *   getClient: () => any,
 *   getState: () => import('/playground-lib.js').PlaygroundState,
 *   describeError: (err: unknown) => string,
 *   setStatus: (text: string) => void,
 * }} deps
 */
export function initFleet(deps) {
  /** @type {NavPoint[]} */
  let points = [];
  /** @type {any[]} */
  let markers = [];
  let pickMode = false;
  /** Thứ tự tối ưu vừa tính (chỉ số vào `points`), để nút "Áp dụng thứ tự" xếp lại danh sách. */
  /** @type {number[] | null} */
  let lastSequence = null;
  /** @type {import('@mapslibvn/core').MatrixResponse | null} */
  let lastMatrix = null;
  /** @type {{ sources: number[], targets: number[] } | null} */
  let lastMatrixIdx = null;
  let busy = false;
  /** Chỉ số điểm → màu xe được giao, để tô marker đơn sau khi chia đơn. */
  /** @type {Map<number, string>} */
  let assignment = new Map();
  const FLEET_COLORS_FALLBACK = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00'];
  /** @param {number} k */
  const colorOf = (k) => {
    /** @type {string[]} */
    const colors = deps.sdk?.FLEET_COLORS ?? FLEET_COLORS_FALLBACK;
    return colors[k % colors.length] ?? FLEET_COLORS_FALLBACK[0];
  };
  /** Ngày hôm nay theo giờ Việt Nam, YYYY-MM-DD — mốc cho giờ xuất phát và khung giờ. */
  const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  const lang = () => deps.getState().lang;
  const mode = () => /** @type {HTMLSelectElement} */ (el('fl-mode')).value;
  const roundTrip = () => /** @type {HTMLInputElement} */ (el('fl-round')).checked;

  /**
   * @param {string} id
   * @param {string} text
   * @param {'error'} [state]
   */
  function say(id, text, state) {
    const node = el(id);
    node.textContent = text;
    if (state) node.dataset.state = state;
    else node.removeAttribute('data-state');
  }

  /** @param {unknown} err */
  function errorText(err) {
    const e = /** @type {any} */ (err);
    if (e?.status === 429) {
      return 'Quá nhịp cho khoá này (ma trận/tối ưu 6 lần, chia đơn 2 lần mỗi phút; khoá demo dùng chung) — đợi một phút rồi thử lại, hoặc dùng khoá riêng ở tab Bản đồ.';
    }
    return deps.describeError(err);
  }

  /**
   * @param {string} id
   * @param {string} path
   * @param {Record<string, string | undefined>} params
   */
  function showReq(id, path, params) {
    const state = deps.getState();
    const url = new URL(state.api.replace(/\/+$/, '') + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    el(id).textContent = `GET ${decodeURIComponent(url.toString())}`;
  }

  /** @param {[number, number][]} list */
  const joinLatLng = (list) => list.map(([lat, lng]) => `${lat},${lng}`).join(';');

  /* ---------- Marker đánh số ---------- */

  function clearMarkers() {
    for (const marker of markers) {
      try {
        marker.remove();
      } catch {
        // Bản đồ có thể đã bị xoá trước marker.
      }
    }
    markers = [];
  }

  function renderMarkers() {
    clearMarkers();
    const map = deps.getMap();
    if (!map || !deps.sdk) return;
    points.forEach((point, index) => {
      const dot = document.createElement('div');
      dot.className = index === 0 ? 'fl-marker fl-marker-depot' : 'fl-marker';
      dot.textContent = String(index + 1);
      dot.title = point.label;
      const mauXe = assignment.get(index);
      if (mauXe && index > 0) dot.style.background = mauXe;
      const marker = new deps.sdk.maplibregl.Marker({ element: dot, draggable: true })
        .setLngLat([point.lng, point.lat])
        .addTo(map.gl);
      marker.on('dragend', () => {
        const { lng, lat } = marker.getLngLat();
        points[index] = pointFromLngLat([Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
        changed();
      });
      markers.push(marker);
    });
  }

  /* ---------- Danh sách điểm ---------- */

  /**
   * @param {string} text
   * @param {string} label
   * @param {() => void} onClick
   * @param {boolean} [disabled]
   */
  function iconButton(text, label, onClick, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fl-icon';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  function move(from, to) {
    const [item] = points.splice(from, 1);
    points.splice(to, 0, item);
    changed();
  }

  function renderPoints() {
    el('fl-points').replaceChildren(
      ...points.map((point, index) => {
        const li = document.createElement('li');
        const num = document.createElement('span');
        num.className = index === 0 ? 'fl-num fl-num-depot' : 'fl-num';
        num.textContent = String(index + 1);
        const name = document.createElement('span');
        name.className = 'fl-name';
        name.textContent = point.label;
        name.title = index === 0 ? 'Điểm xuất phát' : `${point.lat}, ${point.lng}`;
        const tw = document.createElement('input');
        tw.className = 'fl-tw';
        tw.placeholder = '08:30-09:30';
        tw.title = 'Khung giờ khách hẹn (chỉ dùng khi có giờ xuất phát)';
        tw.setAttribute('aria-label', `Khung giờ của ${point.label}`);
        tw.value = point.tw ?? '';
        tw.hidden = index === 0;
        tw.addEventListener('change', () => {
          const value = tw.value.trim();
          const { tw: _cu, ...rest } = points[index] ?? point;
          points[index] = value ? { ...rest, tw: value } : rest;
          resetResults();
        });
        li.append(
          num,
          name,
          tw,
          iconButton('↑', `Đưa ${point.label} lên`, () => move(index, index - 1), index === 0),
          iconButton(
            '↓',
            `Đưa ${point.label} xuống`,
            () => move(index, index + 1),
            index === points.length - 1,
          ),
          iconButton('✕', `Xoá ${point.label}`, () => {
            points.splice(index, 1);
            changed();
          }),
        );
        return li;
      }),
    );
    const n = points.length;
    say(
      'fl-count',
      n === 0
        ? 'Chưa có điểm nào.'
        : `${n} điểm · số 1 là điểm xuất phát${roundTrip() || n < 3 ? '' : `, số ${n} là điểm kết thúc`}.`,
    );
  }

  function renderSnippet() {
    el('snippet-fleet').textContent = fleetSnippet(deps.getState(), {
      points,
      roundTrip: roundTrip(),
      mode: mode(),
    });
  }

  /** Kết quả cũ không còn khớp danh sách điểm: xoá tuyến và bảng, giữ lại JSON để đối chiếu. */
  function resetResults(clearRoute = true) {
    lastSequence = null;
    lastMatrix = null;
    lastMatrixIdx = null;
    if (clearRoute) deps.getMap()?.routes.clear();
    el('fl-legs').replaceChildren();
    el('fl-table').hidden = true;
    el('fl-table').replaceChildren();
    say('fl-opt-msg', 'Chưa gọi API.');
    say('fl-mx-msg', 'Chưa gọi API.');
    const hadAssignment = assignment.size > 0;
    assignment = new Map();
    el('fl-plan-list').replaceChildren();
    el('fl-unassigned').hidden = true;
    say('fl-plan-msg', 'Chưa gọi API.');
    // Marker đơn đang tô màu theo kế hoạch cũ: vẽ lại về màu thường.
    if (hadAssignment) renderMarkers();
  }

  function changed() {
    resetResults();
    renderPoints();
    renderMarkers();
    renderSnippet();
  }

  /** @param {NavPoint} point */
  function addPoint(point) {
    points.push(point);
    changed();
    deps.setStatus(`Đã thêm điểm ${points.length}: ${point.label}`);
  }

  function fitPoints() {
    const map = deps.getMap();
    if (!map || points.length === 0) return;
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    const bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    if (points.length === 1) map.flyTo([points[0].lng, points[0].lat], 15);
    else fitBox(bbox);
  }

  /**
   * Khớp khung chừa chỗ cho bảng điều khiển: bên trái trên màn rộng, phía dưới trên điện thoại.
   * @param {number[]} bbox [minLng, minLat, maxLng, maxLat]
   */
  function fitBox([minLng, minLat, maxLng, maxLat]) {
    const map = deps.getMap();
    if (!map) return;
    const padding = { top: 50, right: 50, bottom: 50, left: 50 };
    const panel = document.getElementById('panel');
    if (panel && document.body.dataset.panel !== 'closed') {
      const box = panel.getBoundingClientRect();
      if (window.innerWidth > 720) padding.left = Math.round(box.right) + 30;
      else padding.bottom = Math.max(50, Math.round(window.innerHeight - box.top) + 30);
    }
    map.gl.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding },
    );
  }

  /** @param {boolean} on */
  function setPickMode(on) {
    pickMode = on;
    el('fl-pick').setAttribute('aria-pressed', String(on));
    const map = deps.getMap();
    if (map) map.gl.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (on) deps.setStatus('Bấm lên bản đồ để thêm điểm — Esc để dừng');
  }

  /* ---------- Tối ưu thứ tự ---------- */

  async function runOptimized() {
    const client = deps.getClient();
    if (!client || busy) return;
    const plan = optimizedPlan({ points, roundTrip: roundTrip(), mode: mode(), lang: lang() });
    if (!plan.ok) {
      say('fl-opt-msg', plan.error, 'error');
      return;
    }
    const { request } = plan;
    // Tuyến một xe thay cho kế hoạch đội xe: bỏ màu xe khỏi marker đơn để khỏi hiểu nhầm.
    if (assignment.size > 0) {
      assignment = new Map();
      el('fl-plan-list').replaceChildren();
      el('fl-unassigned').hidden = true;
      say('fl-plan-msg', 'Chưa gọi API.');
      renderMarkers();
    }
    showReq('fl-opt-req', '/v1/optimized-route', {
      from: `${request.from[0]},${request.from[1]}`,
      stops: joinLatLng(request.stops),
      to: request.to ? `${request.to[0]},${request.to[1]}` : undefined,
      mode: request.mode,
      lang: request.lang,
    });
    busy = true;
    say('fl-opt-msg', 'Đang tính thứ tự tối ưu…');
    const t0 = performance.now();
    try {
      const res = await client.optimizedRoute(request);
      const ms = Math.round(performance.now() - t0);
      el('fl-json').textContent = JSON.stringify(res, null, 2);
      const route = res.routes[0];
      if (!route) throw new Error('Không có tuyến nối các điểm này.');
      const map = deps.getMap();
      map?.routes.show(res, { active: 0, markers: false });
      fitBox(route.bbox);

      // Chỉ số vào `points`: stops trong request là points[1..] (bỏ điểm cuối khi có `to`).
      const stopBase = 1;
      lastSequence = [0, ...res.order.map((i) => i + stopBase)];
      if (!roundTrip()) lastSequence.push(points.length - 1);
      const legs = visitLegs({
        from: points[0],
        stops: plan.stops,
        to: roundTrip() ? null : points[points.length - 1],
        order: res.order,
        legs: route.legs,
      });
      renderLegs(legs);
      const inOrder = res.order.every((v, i) => v === i);
      say(
        'fl-opt-msg',
        `Tổng ${shortDistance(route.distance_m)} · ${shortDuration(route.duration_s)} · ${ms} ms.` +
          (inOrder ? ' Thứ tự đang có đã là tối ưu.' : ''),
      );
    } catch (err) {
      el('fl-legs').replaceChildren();
      deps.getMap()?.routes.clear();
      say('fl-opt-msg', errorText(err), 'error');
    } finally {
      busy = false;
    }
  }

  /** @param {ReturnType<typeof visitLegs>} legs */
  function renderLegs(legs) {
    const start = document.createElement('li');
    start.className = 'fl-leg-start';
    start.textContent = `Xuất phát: 1 · ${points[0].label}`;
    const items = legs.map((leg) => {
      const li = document.createElement('li');
      const pointIndex = leg.stopIndex === null ? null : leg.stopIndex + 1;
      const target = document.createElement('span');
      target.textContent =
        pointIndex === null
          ? roundTrip()
            ? `→ 1 · ${leg.label}`
            : `→ ${points.length} · ${leg.label}`
          : `→ ${pointIndex + 1} · ${leg.label}`;
      const meta = document.createElement('small');
      meta.textContent = `${shortDistance(leg.distance_m)} · ${shortDuration(leg.duration_s)}`;
      li.append(target, meta);
      return li;
    });
    const apply = document.createElement('li');
    apply.className = 'fl-leg-apply';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'fl-apply-order';
    button.textContent = 'Xếp danh sách theo thứ tự này';
    button.addEventListener('click', () => {
      if (!lastSequence) return;
      points = lastSequence.map((i) => points[i]);
      changed();
      say('fl-opt-msg', 'Đã xếp lại danh sách. Bấm "Tối ưu" để vẽ lại tuyến.');
    });
    apply.append(button);
    el('fl-legs').replaceChildren(start, ...items, apply);
  }

  /* ---------- Chia đơn cho nhiều xe ---------- */

  /** @param {string} id */
  const inputValue = (id) => /** @type {HTMLInputElement} */ (el(id)).value;
  /** "don-3" → chỉ số 3 trong `points` (đơn thứ i là points[i], vì points[0] là kho). */
  /** @param {string} jobId */
  const pointIndexOf = (jobId) => Number(jobId.replace('don-', ''));

  async function runFleetPlan() {
    const client = deps.getClient();
    if (!client || busy) return;
    const capRaw = inputValue('fl-cap').trim();
    const plan = fleetPlanRequest({
      points,
      vehicles: Number(inputValue('fl-veh')),
      capacity: capRaw === '' ? null : Math.max(0, Math.round(Number(capRaw)) || 0),
      demand: Math.max(0, Math.round(Number(inputValue('fl-dem'))) || 0),
      serviceMin: Math.max(0, Number(inputValue('fl-svc')) || 0),
      departure: inputValue('fl-dep'),
      shiftHours: Number(inputValue('fl-shift')) || 8,
      endMode: inputValue('fl-end') === 'open' ? 'open' : 'depot',
      mode: mode(),
      lang: lang(),
      today: todayVn(),
    });
    if (!plan.ok) {
      say('fl-plan-msg', plan.error, 'error');
      return;
    }
    const api = deps.getState().api.replace(/\/+$/, '');
    el('fl-plan-req').textContent =
      `POST ${api}/v1/fleet-plan\n${JSON.stringify(plan.body, null, 2)}`;
    busy = true;
    say('fl-plan-msg', 'Đang chia đơn…');
    const t0 = performance.now();
    try {
      const res = await client.fleetPlan(plan.body);
      const ms = Math.round(performance.now() - t0);
      el('fl-json').textContent = JSON.stringify(res, null, 2);
      deps.getMap()?.routes.showFleet(res, { markers: false });
      assignment = new Map();
      for (const [k, v] of res.vehicles.entries()) {
        for (const id of v.jobs) assignment.set(pointIndexOf(id), colorOf(k));
      }
      renderMarkers();
      /** @type {number[][]} */
      const boxes = [];
      for (const v of res.vehicles) {
        const bbox = v.routes[0]?.bbox;
        if (bbox) boxes.push(bbox);
      }
      if (boxes.length > 0) {
        fitBox([
          Math.min(...boxes.map((b) => b[0])),
          Math.min(...boxes.map((b) => b[1])),
          Math.max(...boxes.map((b) => b[2])),
          Math.max(...boxes.map((b) => b[3])),
        ]);
      }
      renderPlan(res);
      say(
        'fl-plan-msg',
        `${res.summary.vehicles_used}/${res.vehicles.length} xe dùng · ${res.summary.jobs_assigned} đơn xếp được · ` +
          `${shortDistance(res.summary.distance_m)} · ${shortDuration(res.summary.duration_s)} · ${ms} ms. ` +
          'Bấm một xe để làm nổi tuyến của xe đó.',
      );
    } catch (err) {
      el('fl-plan-list').replaceChildren();
      deps.getMap()?.routes.clear();
      say('fl-plan-msg', errorText(err), 'error');
    } finally {
      busy = false;
    }
  }

  /** @param {import('@mapslibvn/core').FleetPlanResponse} res */
  function renderPlan(res) {
    const blocks = res.vehicles.map((v, k) => {
      const block = document.createElement('div');
      block.className = 'fl-veh';
      const head = document.createElement('button');
      head.type = 'button';
      const swatch = document.createElement('span');
      swatch.className = 'fl-swatch';
      swatch.style.background = colorOf(k);
      const title = document.createElement('span');
      const route = v.routes[0];
      title.textContent =
        v.jobs.length === 0
          ? `Xe ${k + 1} · nghỉ`
          : `Xe ${k + 1} · ${v.jobs.length} đơn · ${shortDistance(route?.distance_m ?? 0)} · ${shortDuration(route?.duration_s ?? 0)}` +
            (v.departure_at ? ` · xuất phát ${v.departure_at.slice(11, 16)}` : '');
      head.append(swatch, title);
      head.addEventListener('click', () => deps.getMap()?.routes.setActive(k));
      const list = document.createElement('ol');
      for (const stop of v.stops) {
        const li = document.createElement('li');
        const i = pointIndexOf(stop.job);
        li.textContent = `→ ${i + 1} · ${points[i]?.label ?? stop.job}`;
        const meta = document.createElement('small');
        meta.textContent =
          (stop.arrival_at
            ? `đến ${stop.arrival_at.slice(11, 16)}`
            : `đến sau ${shortDuration(stop.arrival_s)}`) +
          (stop.waiting_s > 0 ? ` · chờ ${shortDuration(stop.waiting_s)}` : '') +
          (stop.service_s > 0 ? ` · dừng ${shortDuration(stop.service_s)}` : '');
        li.append(meta);
        list.append(li);
      }
      block.append(head, list);
      return block;
    });
    el('fl-plan-list').replaceChildren(...blocks);
    const chua = el('fl-unassigned');
    if (res.unassigned.length > 0) {
      chua.hidden = false;
      const ten = res.unassigned.map((u) => {
        const i = pointIndexOf(u.id);
        return `điểm ${i + 1} (${points[i]?.label ?? u.id})`;
      });
      chua.textContent = `Chưa xếp được: ${ten.join(', ')} — thêm xe, nới sức chứa hoặc khung giờ.`;
    } else {
      chua.hidden = true;
    }
  }

  /* ---------- Ma trận ---------- */

  async function runMatrix() {
    const client = deps.getClient();
    if (!client || busy) return;
    const kind = /** @type {'all' | 'depot'} */ (
      /** @type {HTMLSelectElement} */ (el('fl-kind')).value
    );
    const plan = matrixPlan(points, kind);
    if (!plan.ok) {
      say('fl-mx-msg', plan.error, 'error');
      return;
    }
    /** @param {NavPoint} p @returns {[number, number]} */
    const latLng = (p) => [p.lat, p.lng];
    const sources = plan.sources.map(latLng);
    const targets = plan.targets.map(latLng);
    showReq('fl-mx-req', '/v1/matrix', {
      sources: joinLatLng(sources),
      targets: joinLatLng(targets),
      mode: mode(),
    });
    busy = true;
    say('fl-mx-msg', 'Đang tính ma trận…');
    const t0 = performance.now();
    try {
      const res = await client.matrix({ sources, targets, mode: mode() });
      const ms = Math.round(performance.now() - t0);
      el('fl-json').textContent = JSON.stringify(res, null, 2);
      lastMatrix = res;
      lastMatrixIdx = {
        sources: plan.sources.map((p) => points.indexOf(p)),
        targets: plan.targets.map((p) => points.indexOf(p)),
      };
      renderMatrix();
      const nulls = res.durations_s.flat().filter((v) => v === null).length;
      say(
        'fl-mx-msg',
        `${sources.length} × ${targets.length} = ${sources.length * targets.length} cặp · ${ms} ms` +
          (nulls > 0 ? ` · ${nulls} ô không nối được (—)` : '') +
          '. Hàng là điểm đi, cột là điểm đến.',
      );
    } catch (err) {
      el('fl-table').hidden = true;
      say('fl-mx-msg', errorText(err), 'error');
    } finally {
      busy = false;
    }
  }

  function renderMatrix() {
    const table = /** @type {HTMLTableElement} */ (el('fl-table'));
    if (!lastMatrix || !lastMatrixIdx) return;
    const metric = /** @type {HTMLSelectElement} */ (el('fl-metric')).value;
    const grid = metric === 'distance' ? lastMatrix.distances_m : lastMatrix.durations_s;
    // Ô gọn: phút / km, đơn vị ghi một lần ở góc bảng; giá trị đầy đủ nằm trong title của ô.
    /** @param {number} v */
    const cell =
      metric === 'distance'
        ? (v) => (v / 1000).toFixed(1).replace('.', ',')
        : (v) => String(Math.max(1, Math.round(v / 60)));
    const full = metric === 'distance' ? shortDistance : shortDuration;
    const idx = lastMatrixIdx;

    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = metric === 'distance' ? 'km' : 'phút';
    corner.title = 'Hàng: điểm đi · cột: điểm đến';
    head.append(corner);
    for (const t of idx.targets) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = String(t + 1);
      th.title = points[t]?.label ?? '';
      head.append(th);
    }
    const rows = idx.sources.map((s, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = String(s + 1);
      th.title = points[s]?.label ?? '';
      tr.append(th);
      idx.targets.forEach((t, j) => {
        const td = document.createElement('td');
        const value = grid[i]?.[j];
        const known = value !== null && value !== undefined;
        if (s === t) {
          td.className = 'fl-diag';
          td.textContent = '·';
        } else {
          td.textContent = known ? cell(value) : '—';
        }
        td.title = `${points[s]?.label} → ${points[t]?.label}: ${known ? full(value) : 'không nối được'}`;
        tr.append(td);
      });
      return tr;
    });
    table.replaceChildren(head, ...rows);
    table.hidden = false;
  }

  /* ---------- Sự kiện ---------- */

  el('fl-add').addEventListener('select', (event) => {
    const item = /** @type {CustomEvent} */ (event).detail;
    addPoint(pointFromAutocomplete(item));
    fitPoints();
    const input = el('fl-add').shadowRoot?.querySelector('input');
    if (input) input.value = '';
  });
  el('fl-pick').addEventListener('click', () => setPickMode(!pickMode));
  el('fl-sample').addEventListener('click', () => {
    points = FLEET_SAMPLE.map((p) => ({ ...p }));
    changed();
    fitPoints();
  });
  el('fl-clear').addEventListener('click', () => {
    points = [];
    changed();
  });
  el('fl-opt').addEventListener('click', () => void runOptimized());
  el('fl-mx').addEventListener('click', () => void runMatrix());
  el('fl-plan').addEventListener('click', () => void runFleetPlan());
  for (const id of ['fl-veh', 'fl-cap', 'fl-dem', 'fl-svc', 'fl-dep', 'fl-shift', 'fl-end']) {
    el(id).addEventListener('change', () => {
      resetResults();
      renderSnippet();
    });
  }
  el('fl-metric').addEventListener('change', renderMatrix);
  el('fl-mode').addEventListener('change', () => {
    resetResults();
    renderSnippet();
  });
  el('fl-round').addEventListener('change', () => {
    resetResults();
    renderPoints();
    renderSnippet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pickMode) setPickMode(false);
  });

  renderPoints();
  renderSnippet();

  return {
    /** Playground gọi khi người dùng bấm lên bản đồ; trả true nếu tab đã nhận cú bấm. */
    /** @param {[number, number]} lngLat */
    onMapClick(lngLat) {
      if (!pickMode) return false;
      addPoint(pointFromLngLat([Number(lngLat[0].toFixed(6)), Number(lngLat[1].toFixed(6))]));
      return true;
    },
    /** Bản đồ vừa được tạo lại: gắn marker lên map mới (tuyến cũ đã mất theo map cũ). */
    attach() {
      setPickMode(false);
      // Map mới chưa có tuyến nào; không gọi routes.clear() để khỏi xoá tuyến dẫn đường vừa vào lại.
      resetResults(false);
      renderMarkers();
      const ac = el('fl-add');
      const state = deps.getState();
      ac.setAttribute('api-key', state.key);
      ac.setAttribute('api-base', state.api);
      /** @type {any} */ (ac).map = deps.getMap();
    },
    /** Trước khi vào dẫn đường: nhả `map.routes` và tắt chế độ thêm điểm. */
    clearRoute() {
      setPickMode(false);
      resetResults();
    },
    renderSnippet,
  };
}
