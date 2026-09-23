/**
 * Playground MapsLibVN — chỉ dùng UMD `/sdk/mapslibvn.umd.js` (đã có global `MapsLibVN`)
 * và logic thuần trong `/playground-lib.js`. Không tải tài nguyên ngoài origin docs, API và tiles.
 * Playground không bao giờ gọi `POST /v1/edits`.
 */
import { resolveApiBase } from '/playground-config.js';
import { initFleet } from '/playground-fleet.js';
import {
  buildSnippet,
  circleGeoJson,
  DEFAULT_KEY,
  maskKey,
  navSnippet,
  PRECISION_ZOOM,
  parseState,
  pointFromPoi,
  poiSourcesForProfile,
  radiusForPrecision,
  toSearchParams,
} from '/playground-lib.js';
import { initNavigation } from '/playground-nav.js';

const SDK = globalThis.MapsLibVN;
const apiBase = resolveApiBase();
const TABS = ['ban-do', 'tim-kiem', 'geocode', 'doi-xe', 'ma-nhung'];

let state = parseState(location.search, apiBase);
let activeTab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TABS[0];
let map = null;
let mapLoaded = false;
let client = null;
let baseMarker = null;
let pins = [];
let reverseMode = false;
/** @type {import('maplibre-gl').Marker | null} */
let myLocationMarker = null;
/** @type {[number, number] | null} lng, lat */
let myLocation = null;
/** @type {ReturnType<typeof import('/playground-nav.js').initNavigation> | null} */
let nav = null;
/** @type {ReturnType<typeof initFleet> | null} */
let fleet = null;
/** @type {import('/playground-lib.js').NavPoint | null} Địa điểm vừa tìm/chọn — điền sẵn khi bấm "Dẫn đường". */
let lastSearchPoint = null;
const fixtureMode = new URLSearchParams(location.search).get('fixture') === '1';
const playbackRate = Math.max(1, Number(new URLSearchParams(location.search).get('rate') ?? '20'));

/** @param {string} id */
const el = (id) => document.getElementById(id);
const statusEl = el('status');

/**
 * @param {string} text
 * @param {string} [dataState] `loading` | `loaded` | `error`
 */
function setStatus(text, dataState) {
  statusEl.textContent = text;
  if (dataState) statusEl.dataset.state = dataState;
}

/** @param {string} value */
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

/** @param {unknown} err */
function describeError(err) {
  if (err && typeof err === 'object' && err.name === 'MapsLibVNError') {
    const rid = err.requestId ? ` · request_id ${err.requestId}` : '';
    return `Lỗi ${err.status} ${err.code}: ${err.message}${rid}`;
  }
  const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err);
  return `Lỗi: ${message}`;
}

/**
 * @param {string} id
 * @param {string} text
 * @param {'error'} [dataState]
 */
function showOut(id, text, dataState) {
  const node = el(id);
  if (!node) return;
  node.textContent = text;
  if (dataState) node.dataset.state = dataState;
  else node.removeAttribute('data-state');
}

/**
 * Hiện URL yêu cầu đã gọi. Khoá đi qua header `X-Api-Key` và luôn được che bằng `maskKey`.
 * @param {string} id
 * @param {string} path
 * @param {Record<string, string | number | undefined>} params
 */
function showReq(id, path, params) {
  const node = el(id);
  if (!node) return;
  const url = new URL(state.api.replace(/\/+$/, '') + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  node.textContent = `GET ${url.toString()} · X-Api-Key: ${maskKey(state.key)}`;
}

/* ---------- Trạng thái, URL, form ---------- */

function syncUrl() {
  const qs = toSearchParams(state, apiBase).toString();
  const hash = state.embed ? '' : `#${activeTab}`;
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${hash}`);
}

function renderTabs() {
  for (const name of TABS) {
    const tab = el(`tab-${name}`);
    const panel = el(`panel-${name}`);
    if (!tab || !panel) continue;
    const selected = name === activeTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }
}

/** @param {string} name */
function selectTab(name) {
  activeTab = name;
  renderTabs();
  syncUrl();
}

function fillForm() {
  el('f-style').value = state.style;
  el('f-lang').value = state.lang;
  el('f-poi').checked = state.poi;
  el('f-sources').value = state.sources;
  el('f-compact').checked = state.compact;
  el('f-key').value = state.key;
  el('f-api').value = state.api;
}

function renderSnippets() {
  const script = el('snippet-script');
  const esm = el('snippet-esm');
  if (script) script.textContent = buildSnippet(state, 'script');
  if (esm) esm.textContent = buildSnippet(state, 'esm');
  const navPre = el('snippet-nav');
  if (navPre) navPre.textContent = navSnippet(state);
  fleet?.renderSnippet();
}

function renderView() {
  const center = el('v-center');
  const zoom = el('v-zoom');
  if (center) center.textContent = `${state.center[0].toFixed(4)}, ${state.center[1].toFixed(4)}`;
  if (zoom) zoom.textContent = state.zoom.toFixed(2);
}

function makeClient() {
  const poiSources = poiSourcesForProfile(state.sources);
  client = SDK
    ? SDK.createClient({
        apiKey: state.key,
        baseUrl: state.api,
        ...(poiSources ? { poiSources } : {}),
      })
    : null;
}

/** Đọc tuỳ chọn từ form vào state; tâm và zoom lấy từ bản đồ đang chạy. */
function readForm() {
  const center = map
    ? [Number(map.gl.getCenter().lng.toFixed(6)), Number(map.gl.getCenter().lat.toFixed(6))]
    : state.center;
  const zoom = map ? Number(map.gl.getZoom().toFixed(2)) : state.zoom;
  state = {
    ...state,
    style: el('f-style').value,
    lang: el('f-lang').value,
    poi: el('f-poi').checked,
    sources: el('f-sources').value,
    compact: el('f-compact').checked,
    key: el('f-key').value.trim() || DEFAULT_KEY,
    api: el('f-api').value.trim() || apiBase,
    center,
    zoom,
  };
}

/* ---------- Bản đồ ---------- */

function clearPins() {
  for (const marker of pins) {
    try {
      marker.remove();
    } catch {
      // Bản đồ có thể đã bị xoá trước marker.
    }
  }
  pins = [];
}

/**
 * @param {number} lng
 * @param {number} lat
 * @param {string} popupHtml
 */
function addPin(lng, lat, popupHtml) {
  if (!map) return;
  pins.push(map.addMarker({ lng, lat, popupHtml }));
}

/**
 * Vòng tròn ước lượng vẽ bằng nguồn GeoJSON của MapLibre (`map.gl`).
 * @param {number} lng
 * @param {number} lat
 * @param {number} radiusM 0 nghĩa là xoá vòng.
 */
function drawCircle(lng, lat, radiusM) {
  if (!map || !mapLoaded) return;
  const gl = map.gl;
  const data =
    radiusM > 0 ? circleGeoJson(lng, lat, radiusM) : { type: 'FeatureCollection', features: [] };
  const source = gl.getSource('pg-circle');
  if (source) {
    source.setData(data);
    return;
  }
  if (radiusM <= 0) return;
  gl.addSource('pg-circle', { type: 'geojson', data });
  gl.addLayer({
    id: 'pg-circle-fill',
    type: 'fill',
    source: 'pg-circle',
    paint: { 'fill-color': '#2458a6', 'fill-opacity': 0.12 },
  });
  gl.addLayer({
    id: 'pg-circle-line',
    type: 'line',
    source: 'pg-circle',
    paint: { 'line-color': '#2458a6', 'line-width': 1.5 },
  });
}

/* ---------- Vị trí của tôi ---------- */

/** @param {[number, number]} lngLat */
function setMyLocation(lngLat) {
  myLocation = lngLat;
  if (!map) return;
  if (!myLocationMarker) {
    const dot = document.createElement('div');
    dot.className = 'pg-my-location';
    dot.setAttribute('aria-label', 'Vị trí của tôi');
    myLocationMarker = new SDK.maplibregl.Marker({ element: dot }).setLngLat(lngLat).addTo(map.gl);
  } else {
    myLocationMarker.setLngLat(lngLat);
  }
  el('locate')?.setAttribute('aria-pressed', 'true');
  nav?.setMyLocation(lngLat);
}

/**
 * Xin vị trí một lần. Từ chối/không hỗ trợ chỉ ghi vào thanh trạng thái (spec: không hộp thoại).
 * @param {{ fly: boolean }} opts
 */
function locateMe({ fly }) {
  if (!('geolocation' in navigator)) {
    setStatus('Trình duyệt không có Geolocation');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lngLat = /** @type {[number, number]} */ ([
        Number(pos.coords.longitude.toFixed(6)),
        Number(pos.coords.latitude.toFixed(6)),
      ]);
      setMyLocation(lngLat);
      if (fly && map) map.flyTo(lngLat, 16);
    },
    (err) => {
      el('locate')?.setAttribute('aria-pressed', 'false');
      setStatus(
        err.code === 1
          ? 'Chưa cho phép truy cập vị trí — bấm ◎ để thử lại'
          : 'Không lấy được vị trí',
      );
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

/** @param {import('@mapslibvn/core').PoiFeature} poi */
function onPoiClick(poi) {
  if (nav?.active) {
    nav.onPoiClick(poi);
    return;
  }
  lastSearchPoint = pointFromPoi(poi);
  setStatus(`${poi.name} · ${poi.category} (${poi.group})`);
  const box = el('poi-box');
  if (!box) return;
  box.hidden = false;
  el('poi-info').textContent = `${poi.name} · ${poi.category} (${poi.group}) · id ${poi.id}`;
  el('poi-detail').dataset.id = poi.id;
  el('poi-req').textContent = '';
  el('poi-json').hidden = true;
}

function onMoveEnd() {
  if (!map) return;
  const center = map.gl.getCenter();
  state = {
    ...state,
    center: [Number(center.lng.toFixed(6)), Number(center.lat.toFixed(6))],
    zoom: Number(map.gl.getZoom().toFixed(2)),
  };
  renderView();
  renderSnippets();
  syncUrl();
}

/** Khởi tạo lại module dẫn đường cho map mới; nếu đang ở chế độ dẫn đường thì vào lại. */
function attachNavigation() {
  const wasActive = Boolean(nav?.active);
  nav = initNavigation({
    map,
    sdk: SDK,
    initial: { from: state.from, to: state.to, tmode: state.tmode },
    lang: state.lang,
    rate: playbackRate,
    fixture: fixtureMode,
    apiKey: state.key,
    apiBase: state.api,
    describeError,
    onChange(patch) {
      state = { ...state, ...patch };
      renderSnippets();
      syncUrl();
    },
  });
  if (myLocation) nav.setMyLocation(myLocation);
  if (wasActive || state.tab === 'dan-duong') nav.enter();
}

function buildMap() {
  mapLoaded = false;
  clearPins();
  myLocationMarker = null;
  if (baseMarker) {
    try {
      baseMarker.remove();
    } catch {
      // Bản đồ có thể đã bị xoá trước marker.
    }
    baseMarker = null;
  }
  if (map) {
    const keep = { from: state.from, to: state.to, tab: state.tab };
    nav?.exit();
    state = { ...state, ...keep };
    map.remove();
    map = null;
  }
  window.__map = null;
  setStatus('Đang tải…', 'loading');
  makeClient();

  if (!SDK) {
    setStatus('Lỗi: không tải được /sdk/mapslibvn.umd.js', 'error');
    return;
  }
  try {
    const poiSources = poiSourcesForProfile(state.sources);
    map = SDK.createMap({
      container: 'map',
      apiKey: state.key,
      apiBase: state.api,
      style: state.style,
      center: state.center,
      zoom: state.zoom,
      lang: state.lang,
      poiLayer: state.poi,
      ...(poiSources ? { poiSources } : {}),
      compactAttribution: state.compact,
    });
  } catch (err) {
    setStatus(describeError(err), 'error');
    return;
  }

  window.__map = map;
  map.on('load', () => {
    mapLoaded = true;
    setStatus('Bản đồ đã tải', 'loaded');
    if (myLocation) setMyLocation(myLocation);
    else locateMe({ fly: true });
  });
  map.on('poiClick', onPoiClick);
  map.gl.on('error', (event) => console.warn('maplibre', event.error?.message));
  map.gl.on('moveend', onMoveEnd);
  map.gl.on('click', onMapClick);
  baseMarker = map.addMarker({
    lng: 106.6981,
    lat: 10.7725,
    popupHtml: '<b>Chợ Bến Thành</b>',
  });

  const ac = el('ac');
  if (ac) {
    ac.setAttribute('api-key', state.key);
    ac.setAttribute('api-base', state.api);
    ac.map = map;
  }
  renderView();
  attachNavigation();
  fleet?.attach();
}

/* ---------- Tìm kiếm ---------- */

/** `near` của REST API là "lat,lng" (xem `apps/api/src/params.ts`). */
const nearFromCenter = () => [state.center[1], state.center[0]];

/**
 * @param {{ lng: number, lat: number, name: string }} target
 * @param {number} zoom
 */
function goTo(target, zoom) {
  clearPins();
  addPin(target.lng, target.lat, `<b>${escapeHtml(target.name)}</b>`);
  if (map) map.flyTo([target.lng, target.lat], zoom);
  setStatus(`Đã chọn: ${target.name}`);
  lastSearchPoint = { lng: target.lng, lat: target.lat, label: target.name };
}

/**
 * Vùng hành chính trả kèm `bbox`, nên khung nhìn phải khớp cả vùng thay vì bay tới một điểm.
 * Marker chỉ là tâm phụ để thấy vùng nào vừa chọn; không gọi `/v1/places/:id` vì area không có id.
 * @param {{ lng: number, lat: number, name: string, bbox: [number, number, number, number] }} area
 */
function goToArea(area) {
  clearPins();
  addPin(area.lng, area.lat, `<b>${escapeHtml(area.name)}</b>`);
  // Thứ tự bbox của API là [minLng, minLat, maxLng, maxLat] — khớp `MapsLibVNMap.fitBounds`.
  if (map) map.fitBounds(area.bbox);
  setStatus(`Đã chọn: ${area.name}`);
  lastSearchPoint = { lng: area.lng, lat: area.lat, label: area.name };
}

/** @param {import('@mapslibvn/core').Place[]} items */
function renderPlaces(items) {
  el('s-results').replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('span');
      name.textContent = item.name;
      const secondary = document.createElement('small');
      secondary.textContent =
        [item.category?.code, item.address?.text].filter(Boolean).join(' · ') ||
        `${item.lat}, ${item.lng}`;
      button.append(name, secondary);
      button.addEventListener('click', () =>
        goTo({ lng: item.lng, lat: item.lat, name: item.name }, 17),
      );
      li.append(button);
      return li;
    }),
  );
}

async function runSearch() {
  if (!client) return;
  const q = el('s-q').value.trim();
  const category = el('s-cat').value.trim();
  if (!q && !category) {
    showOut('s-msg', 'Cần từ khoá hoặc mã loại.', 'error');
    return;
  }
  const radius = Number(el('s-radius').value) || 5000;
  const near = nearFromCenter();
  showOut('s-msg', 'Đang tìm…');
  showReq('s-req', '/v1/search', { q, category, near: near.join(','), radius });
  try {
    const res = await client.search(q, {
      category: category || undefined,
      near,
      radius,
    });
    el('s-json').textContent = JSON.stringify(res, null, 2);
    renderPlaces(res.items);
    showOut('s-msg', `Có ${res.items.length} kết quả trong tổng ${res.total}.`);
  } catch (err) {
    el('s-json').textContent = '—';
    el('s-results').replaceChildren();
    showOut('s-msg', describeError(err), 'error');
  }
}

async function runNearby() {
  if (!client) return;
  const radius = Number(el('n-radius').value) || 500;
  const category = el('n-cat').value.trim();
  const [lat, lng] = nearFromCenter();
  showOut('s-msg', 'Đang tìm quanh tâm bản đồ…');
  showReq('s-req', '/v1/nearby', { lat, lng, radius, category });
  try {
    const res = await client.nearby({
      lat,
      lng,
      radius,
      category: category || undefined,
    });
    el('s-json').textContent = JSON.stringify(res, null, 2);
    renderPlaces(res.items);
    showOut('s-msg', `Có ${res.items.length} địa điểm quanh tâm bản đồ.`);
  } catch (err) {
    el('s-json').textContent = '—';
    el('s-results').replaceChildren();
    showOut('s-msg', describeError(err), 'error');
  }
}

/* ---------- Geocode và reverse ---------- */

/** @param {import('@mapslibvn/core').GeocodeItem} item */
function showGeocodeItem(item) {
  clearPins();
  addPin(
    item.lng,
    item.lat,
    `<b>${escapeHtml(item.display_name)}</b><br />${escapeHtml(item.precision)} · confidence ${item.confidence}`,
  );
  const radius = radiusForPrecision(item.precision);
  drawCircle(item.lng, item.lat, radius);
  lastSearchPoint = { lng: item.lng, lat: item.lat, label: item.display_name };
  if (!map) return;
  if (radius > 0) map.flyTo([item.lng, item.lat], 17);
  else if (item.precision === 'rooftop') map.flyTo([item.lng, item.lat], 18);
  else if (item.bbox) map.fitBounds(item.bbox);
  else map.flyTo([item.lng, item.lat], PRECISION_ZOOM[item.precision] ?? 15);
}

/** @param {import('@mapslibvn/core').GeocodeItem[]} items */
function renderGeocode(items) {
  el('g-results').replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const precision = document.createElement('span');
      precision.className = 'pg-badge';
      precision.textContent = item.precision;
      const confidence = document.createElement('span');
      confidence.className = 'pg-badge';
      confidence.textContent = `confidence ${item.confidence}`;
      const name = document.createElement('span');
      name.textContent = item.display_name;
      const secondary = document.createElement('small');
      secondary.textContent = `${item.lat}, ${item.lng}`;
      button.append(precision, confidence, name, secondary);
      button.addEventListener('click', () => showGeocodeItem(item));
      li.append(button);
      return li;
    }),
  );
  if (items[0]) showGeocodeItem(items[0]);
}

async function runGeocode() {
  if (!client) return;
  const q = el('g-q').value.trim();
  if (!q) {
    showOut('g-msg', 'Nhập địa chỉ trước khi tra cứu.', 'error');
    return;
  }
  const near = nearFromCenter();
  showOut('g-msg', 'Đang tra cứu…');
  showReq('g-req', '/v1/geocode', { q, near: near.join(','), limit: 5 });
  try {
    const res = await client.geocode(q, { near, limit: 5 });
    renderGeocode(res.items);
    showOut(
      'g-msg',
      res.items.length > 0 ? `Có ${res.items.length} kết quả.` : 'Không tìm thấy kết quả.',
    );
  } catch (err) {
    el('g-results').replaceChildren();
    showOut('g-msg', describeError(err), 'error');
  }
}

/** @param {boolean} on */
function setReverseMode(on) {
  reverseMode = on;
  el('rev-toggle')?.setAttribute('aria-pressed', String(on));
  if (map) map.gl.getCanvas().style.cursor = on ? 'crosshair' : '';
  showOut(
    'rev-msg',
    on ? 'Đang chờ bạn bấm lên bản đồ. Nhấn Esc để tắt.' : 'Chế độ tra ngược đang tắt.',
  );
}

/** @param {{ lngLat: { lng: number, lat: number } }} event */
async function onMapClick(event) {
  if (nav?.active) {
    nav.onMapClick([event.lngLat.lng, event.lngLat.lat]);
    return;
  }
  if (fleet?.onMapClick([event.lngLat.lng, event.lngLat.lat])) return;
  if (!reverseMode || !client) return;
  setReverseMode(false);
  const lat = Number(event.lngLat.lat.toFixed(6));
  const lng = Number(event.lngLat.lng.toFixed(6));
  showOut('rev-msg', 'Đang tra cứu…');
  showReq('rev-req', '/v1/reverse', { lat, lng });
  clearPins();
  addPin(lng, lat, '<b>Điểm đã bấm</b>');
  try {
    const res = await client.reverse(lat, lng);
    el('rev-out').hidden = false;
    el('rev-name').textContent = res.address.display_name || '—';
    el('rev-hn').textContent = res.address.approx_housenumber || '—';
    el('rev-poi').textContent = res.nearest_poi ? res.nearest_poi.name : '—';
    showOut('rev-msg', 'Đã có kết quả. Chế độ tra ngược đã tắt.');
  } catch (err) {
    el('rev-out').hidden = true;
    showOut('rev-msg', describeError(err), 'error');
  }
}

/* ---------- Sao chép mã nhúng ---------- */

/** @param {string} text */
async function copyText(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Không có quyền clipboard — rơi xuống cách chọn sẵn đoạn mã.
  }
  return false;
}

/** @param {Element} node */
function selectNode(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * @param {string} buttonId
 * @param {string} preId
 * @param {string} [msgId]
 */
function wireCopy(buttonId, preId, msgId = 'copy-msg') {
  el(buttonId).addEventListener('click', async () => {
    const pre = el(preId);
    const ok = await copyText(pre.textContent ?? '');
    if (!ok) selectNode(pre);
    showOut(
      msgId,
      ok
        ? 'Đã sao chép vào bộ nhớ tạm.'
        : 'Trình duyệt không cho sao chép tự động — đoạn mã đã được chọn, hãy nhấn Ctrl/Cmd + C.',
    );
  });
}

/* ---------- Gắn sự kiện cho bảng điều khiển ---------- */

function wirePanel() {
  for (const name of TABS) {
    el(`tab-${name}`).addEventListener('click', () => selectTab(name));
  }
  document.querySelector('.pg-tabs').addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(activeTab) + step + TABS.length) % TABS.length];
    selectTab(next);
    el(`tab-${next}`).focus();
  });

  const toggle = el('panel-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.dataset.panel !== 'closed';
    document.body.dataset.panel = open ? 'closed' : 'open';
    toggle.setAttribute('aria-expanded', String(!open));
    el('panel-toggle-label').textContent = open ? 'Mở' : 'Thu gọn';
  });

  for (const id of ['f-style', 'f-lang', 'f-poi', 'f-sources', 'f-compact', 'f-key', 'f-api']) {
    el(id).addEventListener('change', () => {
      readForm();
      fillForm();
      renderSnippets();
      renderView();
      makeClient();
      syncUrl();
    });
  }

  el('apply').addEventListener('click', () => {
    readForm();
    fillForm();
    renderSnippets();
    renderView();
    syncUrl();
    buildMap();
  });

  el('reset').addEventListener('click', () => {
    state = parseState('', apiBase);
    fillForm();
    renderSnippets();
    renderView();
    syncUrl();
    buildMap();
  });

  el('ac').addEventListener('select', (event) => {
    const item = event.detail;
    if (item.type === 'area' && Array.isArray(item.bbox)) {
      goToArea({ lng: item.lng, lat: item.lat, name: item.name, bbox: item.bbox });
      return;
    }
    goTo({ lng: item.lng, lat: item.lat, name: item.name }, 16);
  });

  el('poi-detail').addEventListener('click', async () => {
    const id = el('poi-detail').dataset.id;
    if (!id || !client) return;
    showReq('poi-req', `/v1/places/${encodeURIComponent(id)}`, {});
    const json = el('poi-json');
    json.hidden = false;
    json.textContent = 'Đang tải…';
    try {
      json.textContent = JSON.stringify(await client.getPlace(id), null, 2);
    } catch (err) {
      json.textContent = describeError(err);
    }
  });

  el('s-run').addEventListener('click', () => void runSearch());
  el('n-run').addEventListener('click', () => void runNearby());
  el('s-q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runSearch();
  });

  el('g-run').addEventListener('click', () => void runGeocode());
  el('g-q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runGeocode();
  });
  for (const chip of document.querySelectorAll('.pg-chip')) {
    chip.addEventListener('click', () => {
      el('g-q').value = chip.dataset.q ?? '';
      void runGeocode();
    });
  }

  el('rev-toggle').addEventListener('click', () => setReverseMode(!reverseMode));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reverseMode) setReverseMode(false);
  });

  wireCopy('copy-script', 'snippet-script');
  wireCopy('copy-esm', 'snippet-esm');
  wireCopy('copy-nav', 'snippet-nav');
  wireCopy('copy-fleet', 'snippet-fleet', 'fl-copy-msg');

  el('enter-nav').addEventListener('click', () => {
    fleet?.clearRoute();
    nav?.enter(lastSearchPoint);
  });

  fleet = initFleet({
    sdk: SDK,
    getMap: () => map,
    getClient: () => client,
    getState: () => state,
    describeError,
    setStatus,
  });

  fillForm();
  renderTabs();
  renderSnippets();
  renderView();
}

/* ---------- Khởi động ---------- */

if (state.embed) {
  document.body.dataset.embed = '1';
  el('panel')?.remove();
  // Chế độ nhúng: chỉ bản đồ và thanh trạng thái — bỏ hẳn dẫn đường (fab, thẻ, popup, banner).
  for (const id of ['locate', 'tools', 'nav-card', 'nav-banner', 'nav-bar', 'nav-popup-template']) {
    el(id)?.remove();
  }
} else {
  wirePanel();
}
el('locate')?.setAttribute('aria-pressed', 'false');
el('locate')?.addEventListener('click', () => locateMe({ fly: true }));
syncUrl();
buildMap();
