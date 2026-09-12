/**
 * Chế độ dẫn đường của Playground (spec 2026-09-12-playground-dan-duong-design.md).
 * Sở hữu mọi phần tử `#nav-*`; không đọc/ghi URL hay state playground — báo qua `onChange`.
 */
import {
  TRAVEL_MODES,
  pointFromAutocomplete,
  pointFromLngLat,
  pointFromPoi,
} from '/playground-lib.js';

/** @typedef {import('/playground-lib.js').NavPoint} NavPoint */

const MY_LOCATION_LABEL = 'Vị trí của tôi';

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Đặt chữ vào ô của web component (shadow root mở) mà không phát `select`.
 * @param {HTMLElement} ac
 * @param {string} text
 */
function setAutocompleteText(ac, text) {
  const input = ac.shadowRoot?.querySelector('input');
  if (input) input.value = text;
}

/**
 * @param {{
 *   map: any,
 *   sdk: any,
 *   initial: { from: NavPoint | null, to: NavPoint | null, tmode: string },
 *   lang: string,
 *   rate: number,
 *   fixture: boolean,
 *   apiKey: string,
 *   apiBase: string,
 *   onChange: (patch: { from?: NavPoint | null, to?: NavPoint | null, tmode?: string, tab?: 'dan-duong' | null }) => void,
 *   describeError: (err: unknown) => string,
 * }} deps
 */
export function initNavigation(deps) {
  const { map, sdk, onChange, describeError } = deps;
  const gl = map.gl;

  /** @type {NavPoint | null} */
  let from = deps.initial.from;
  /** @type {NavPoint | null} */
  let to = deps.initial.to;
  let tmode = TRAVEL_MODES.includes(deps.initial.tmode) ? deps.initial.tmode : 'motorbike';
  /** @type {[number, number] | null} */
  let myLocation = null;
  let active = false;
  /** @type {'plan' | 'nav'} */
  let phase = 'plan';
  /** @type {any} marker điểm đi */
  let fromMarker = null;
  /** @type {any} marker điểm đến */
  let toMarker = null;
  /** @type {any} popup chọn điểm */
  let popup = null;

  const card = el('nav-card');
  const fromAc = el('nav-from');
  const toAc = el('nav-to');
  const msg = el('nav-msg');

  for (const ac of [fromAc, toAc]) {
    ac.setAttribute('api-key', deps.apiKey);
    ac.setAttribute('api-base', deps.apiBase);
    /** @type {any} */ (ac).map = map;
  }

  /**
   * @param {string} text
   * @param {'error'} [state]
   */
  const say = (text, state) => {
    msg.textContent = text;
    if (state) msg.dataset.state = state;
    else msg.removeAttribute('data-state');
  };

  const renderModes = () => {
    for (const button of card.querySelectorAll('.nav-mode')) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-mode') === tmode));
    }
  };

  const renderPoints = () => {
    setAutocompleteText(fromAc, from ? from.label : myLocation ? MY_LOCATION_LABEL : '');
    setAutocompleteText(toAc, to ? to.label : '');
    fromMarker?.remove();
    fromMarker = from ? map.addMarker({ lng: from.lng, lat: from.lat, color: '#2458a6' }) : null;
    toMarker?.remove();
    toMarker = to ? map.addMarker({ lng: to.lng, lat: to.lat, color: '#d92d20' }) : null;
  };

  /** Điểm đi hiệu dụng: điểm đã chọn, hoặc vị trí của tôi. */
  const effectiveFrom = () =>
    from ??
    (myLocation ? { lng: myLocation[0], lat: myLocation[1], label: MY_LOCATION_LABEL } : null);

  /**
   * @param {'from' | 'to'} kind
   * @param {NavPoint | null} point
   */
  function setPoint(kind, point) {
    if (kind === 'from') from = point;
    else to = point;
    renderPoints();
    onChange(kind === 'from' ? { from } : { to });
    void compute();
  }

  /** @param {string} mode */
  function setMode(mode) {
    if (!TRAVEL_MODES.includes(mode) || mode === tmode) return;
    tmode = mode;
    renderModes();
    onChange({ tmode });
    void compute();
  }

  /** Hoán vị đi/đến; "Vị trí của tôi" khi thành điểm đến thì đóng băng thành toạ độ. */
  function swap() {
    const oldFrom = effectiveFrom();
    from = to;
    to =
      oldFrom && oldFrom.label === MY_LOCATION_LABEL
        ? pointFromLngLat([oldFrom.lng, oldFrom.lat])
        : oldFrom;
    renderPoints();
    onChange({ from, to });
    void compute();
  }

  /** Popup "Đi từ đây · Đến đây" tại một điểm trên bản đồ. @param {NavPoint} point */
  function offerPoint(point) {
    popup?.remove();
    const template = /** @type {HTMLTemplateElement} */ (el('nav-popup-template'));
    const node = /** @type {HTMLElement} */ (template.content.firstElementChild?.cloneNode(true));
    node.querySelector('.nav-popup-label').textContent = point.label;
    node.querySelector('[data-kind="from"]').addEventListener('click', () => {
      popup?.remove();
      setPoint('from', point);
    });
    node.querySelector('[data-kind="to"]').addEventListener('click', () => {
      popup?.remove();
      setPoint('to', point);
    });
    popup = new sdk.maplibregl.Popup({ offset: 12, closeButton: false })
      .setLngLat([point.lng, point.lat])
      .setDOMContent(node)
      .addTo(gl);
  }

  /* compute(), startNav(), backToPlan() được thêm ở Task 6 và 7 */
  async function compute() {}

  function enter() {
    if (active) return;
    active = true;
    document.body.dataset.nav = '1';
    delete document.body.dataset.tools;
    card.hidden = false;
    el('tools').hidden = false;
    renderModes();
    renderPoints();
    onChange({ tab: 'dan-duong' });
    void compute();
  }

  function exit() {
    if (!active) return;
    if (phase === 'nav') map.navigation.stop();
    phase = 'plan';
    active = false;
    popup?.remove();
    fromMarker?.remove();
    toMarker?.remove();
    fromMarker = null;
    toMarker = null;
    from = null;
    to = null;
    map.routes.clear();
    card.hidden = true;
    el('nav-banner').hidden = true;
    el('nav-bar').hidden = true;
    el('tools').hidden = true;
    delete document.body.dataset.nav;
    delete document.body.dataset.tools;
    delete document.body.dataset.navPhase;
    onChange({ tab: null, from: null, to: null });
  }

  el('nav-exit').addEventListener('click', exit);
  el('nav-swap').addEventListener('click', swap);
  el('tools').addEventListener('click', () => {
    if (document.body.dataset.tools === '1') delete document.body.dataset.tools;
    else document.body.dataset.tools = '1';
  });
  for (const button of card.querySelectorAll('.nav-mode')) {
    button.addEventListener('click', () => setMode(button.getAttribute('data-mode') ?? ''));
  }
  fromAc.addEventListener('select', (event) => {
    setPoint('from', pointFromAutocomplete(/** @type {CustomEvent} */ (event).detail));
  });
  toAc.addEventListener('select', (event) => {
    setPoint('to', pointFromAutocomplete(/** @type {CustomEvent} */ (event).detail));
  });

  return {
    enter,
    exit,
    get active() {
      return active;
    },
    setPoint,
    /** @param {[number, number]} lngLat */
    setMyLocation(lngLat) {
      myLocation = lngLat;
      if (active && !from) {
        renderPoints();
        void compute();
      }
    },
    /** @param {[number, number]} lngLat */
    onMapClick(lngLat) {
      if (!active || phase !== 'plan') return;
      offerPoint(pointFromLngLat(lngLat));
    },
    /** @param {{ name: string, lngLat: [number, number] }} poi */
    onPoiClick(poi) {
      if (!active || phase !== 'plan') return;
      offerPoint(pointFromPoi(poi));
    },
  };
}
