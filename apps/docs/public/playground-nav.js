/**
 * Chế độ dẫn đường của Playground (spec 2026-09-12-playground-dan-duong-design.md).
 * Sở hữu mọi phần tử `#nav-*`; không đọc/ghi URL hay state playground — báo qua `onChange`.
 */
import {
  TRAVEL_MODES,
  directionsRequest,
  etaLabel,
  pointFromAutocomplete,
  pointFromLngLat,
  pointFromPoi,
  routeSummary,
} from '/playground-lib.js';

/** @typedef {import('/playground-lib.js').NavPoint} NavPoint */

const MY_LOCATION_LABEL = 'Vị trí của tôi';
/** Phụ đề câu vừa đọc hiện bấy nhiêu ms. */
const SUBTITLE_MS = 4000;
/** Banner "Đã đến nơi" giữ bấy nhiêu ms rồi trở về thẻ lập kế hoạch. */
const ARRIVED_HOLD_MS = 3000;

/** Ký hiệu theo `ManeuverKind` (spec A) — glyph hình học, không phụ thuộc font emoji. */
const ICONS = {
  depart: '●',
  arrive: '⚑',
  continue: '↑',
  slight_right: '↗',
  slight_left: '↖',
  turn_right: '↱',
  turn_left: '↰',
  sharp_right: '↳',
  sharp_left: '↲',
  uturn_right: '↷',
  uturn_left: '↶',
  ramp_straight: '↑',
  ramp_right: '↗',
  ramp_left: '↖',
  exit_right: '↗',
  exit_left: '↖',
  keep_right: '↗',
  keep_left: '↖',
  merge: '↑',
  merge_right: '↗',
  merge_left: '↖',
  roundabout_enter: '↻',
  roundabout_exit: '↻',
  ferry_enter: '⛴',
  ferry_exit: '⛴',
  elevator: '⇕',
  steps: '≡',
  escalator: '≡',
  building_enter: '⌂',
  building_exit: '⌂',
  other: '•',
};

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
  /** @type {any} DirectionsResponse đang hiện */
  let response = null;
  let activeRoute = 0;
  let requestId = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let subtitleTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let arrivedTimer = null;
  const provider = deps.fixture
    ? { directions: async () => (await fetch('/fixtures/directions-q1.json')).json() }
    : map.places;

  const card = el('nav-card');
  const fromAc = el('nav-from');
  const toAc = el('nav-to');
  const msg = el('nav-msg');

  for (const ac of [fromAc, toAc]) {
    ac.setAttribute('api-key', deps.apiKey);
    ac.setAttribute('api-base', deps.apiBase);
    /** @type {any} */ (ac).map = map;
  }
  map.on('routeClick', (e) => {
    if (active && phase === 'plan') selectRoute(e.index);
  });

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

  /** @param {unknown} err */
  const routeErrorText = (err) => {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : 0;
    if (status === 429) {
      return 'Quá giới hạn 20 lượt/phút của khoá demo — chờ một chút hoặc dán khoá riêng ở ⋯ Công cụ.';
    }
    if (status === 503 || status === 504) return 'Máy chủ chỉ đường đang bận, thử lại sau.';
    if (status === 404 || status === 422) return 'Chưa có đường cho đoạn này.';
    return describeError(err);
  };

  const renderRoutes = () => {
    const list = el('nav-routes');
    if (!response) {
      list.replaceChildren();
      return;
    }
    list.replaceChildren(
      ...response.routes.map((route, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(index === activeRoute));
        const summary = routeSummary(route);
        const strong = document.createElement('strong');
        strong.textContent = `${summary.distanceText} · ${summary.minutes} phút`;
        const small = document.createElement('small');
        small.textContent = summary.via
          ? `qua ${summary.via}`
          : index === 0
            ? 'Tuyến nhanh nhất'
            : 'Tuyến thay thế';
        button.append(strong, small);
        button.addEventListener('click', () => selectRoute(index));
        li.append(button);
        return li;
      }),
    );
  };

  const renderSteps = () => {
    const box = el('nav-steps-box');
    const list = el('nav-steps');
    const route = response?.routes[activeRoute];
    if (!route) {
      box.hidden = true;
      list.replaceChildren();
      return;
    }
    box.hidden = false;
    list.replaceChildren(
      ...route.legs.flatMap((leg) =>
        leg.steps.map((step) => {
          const li = document.createElement('li');
          li.textContent = `${ICONS[step.kind] ?? '•'} ${step.instruction} (${sdk.formatDistanceShort(step.distance_m)})`;
          return li;
        }),
      ),
    );
  };

  /** @param {number} index */
  function selectRoute(index) {
    if (!response || !response.routes[index]) return;
    activeRoute = index;
    map.routes.setActive(index);
    renderRoutes();
    renderSteps();
  }

  const setBusy = (busy) => card.setAttribute('aria-busy', String(busy));

  async function compute() {
    if (!active || phase !== 'plan') return;
    const origin = effectiveFrom();
    const id = ++requestId;
    if (!to || !origin) {
      response = null;
      map.routes.clear();
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = true;
      el('nav-simulate').disabled = true;
      say(
        !to
          ? 'Chọn điểm đến bằng ô tìm kiếm hoặc bấm lên bản đồ.'
          : 'Đang chờ vị trí của bạn… hoặc chọn điểm đi khác.',
      );
      return;
    }
    setBusy(true);
    say('Đang tính tuyến…');
    try {
      const result = await provider.directions(
        directionsRequest({ from: origin, to, mode: tmode, lang: deps.lang }),
      );
      if (id !== requestId) return;
      if (!result.routes[0]) {
        throw Object.assign(new Error('Chưa có đường cho đoạn này.'), { status: 404 });
      }
      response = result;
      activeRoute = 0;
      map.routes.show(result, { active: 0, markers: false });
      const [minLng, minLat, maxLng, maxLat] = result.routes[0].bbox;
      gl.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: window.innerWidth > 720 ? { top: 60, right: 60, bottom: 60, left: 400 } : 60 },
      );
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = false;
      el('nav-simulate').disabled = false;
      say(`${result.routes.length} tuyến · bấm để đổi tuyến, rồi Bắt đầu hoặc Giả lập.`);
    } catch (err) {
      if (id !== requestId) return;
      response = null;
      map.routes.clear();
      renderRoutes();
      renderSteps();
      el('nav-start').disabled = true;
      el('nav-simulate').disabled = true;
      say(routeErrorText(err), 'error');
    } finally {
      if (id === requestId) setBusy(false);
    }
  }

  /** @param {'plan' | 'nav'} next */
  const setPhase = (next) => {
    phase = next;
    document.body.dataset.navPhase = next;
    card.hidden = next !== 'plan';
    el('nav-banner').hidden = next !== 'nav';
    el('nav-bar').hidden = next !== 'nav';
  };

  /** @param {string} text */
  const showSubtitle = (text) => {
    const node = el('nav-subtitle');
    node.textContent = text;
    node.hidden = false;
    if (subtitleTimer) clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => {
      node.hidden = true;
    }, SUBTITLE_MS);
  };

  /** @param {string} status */
  const setBanner = (status) => {
    el('nav-banner').dataset.status = status;
  };

  function backToPlan() {
    if (arrivedTimer) clearTimeout(arrivedTimer);
    arrivedTimer = null;
    setPhase('plan');
    el('nav-recenter').hidden = true;
    el('nav-start').disabled = response === null;
    el('nav-simulate').disabled = response === null;
  }

  /** @param {boolean} simulate */
  function startNav(simulate) {
    const route = response?.routes[activeRoute];
    if (!response || !route) return;
    const options = {
      response,
      routeIndex: activeRoute,
      provider,
      lang: deps.lang,
      voice: !simulate,
    };
    if (simulate) {
      options.source = sdk.playbackSource(sdk.simulateFixes(route, { jitter_m: 4, seed: 7 }), {
        rate: deps.rate,
      });
    }
    popup?.remove();
    setBanner('navigating');
    el('nav-icon').textContent = '•';
    el('nav-distance').textContent = '—';
    el('nav-instruction').textContent = 'Đang chờ vị trí…';
    el('nav-eta').textContent = '—';
    el('nav-subtitle').hidden = true;
    setPhase('nav');
    map.navigation.start(options);
  }

  map.navigation.on('progress', (p) => {
    const next = p.nextStep ?? p.step;
    el('nav-icon').textContent = ICONS[next.kind] ?? '•';
    el('nav-distance').textContent = sdk.formatDistanceShort(p.distanceToStep_m);
    el('nav-instruction').textContent = next.instruction;
    el('nav-eta').textContent = etaLabel(p.remaining_s, p.remaining_m, Date.now());
  });
  map.navigation.on('announce', (a) => showSubtitle(a.text));
  map.navigation.on('status', (e) => {
    if (phase !== 'nav') return;
    setBanner(e.status);
    if (e.status === 'off_route') el('nav-instruction').textContent = 'Lệch tuyến — đang tính lại…';
    if (e.status === 'arrived') {
      el('nav-icon').textContent = '⚑';
      el('nav-distance').textContent = '';
      el('nav-instruction').textContent = 'Đã đến nơi';
      arrivedTimer = setTimeout(backToPlan, ARRIVED_HOLD_MS);
    }
  });
  map.navigation.on('reroute', (e) => {
    response = e.response;
    activeRoute = 0;
    renderRoutes();
    renderSteps();
  });
  map.navigation.on('rerouteFailed', (e) => {
    showSubtitle(`Không tính lại được (${e.attempts}/3)${e.final ? ' — dừng tự tính' : ''}`);
  });
  map.navigation.on('positionError', (e) => {
    if (e.code === 'denied' && phase === 'nav') {
      map.navigation.stop();
      setBanner('error');
      el('nav-instruction').textContent = 'Mất quyền vị trí — bấm Dừng rồi cho phép lại';
    } else {
      showSubtitle(`GPS: ${e.message}`);
    }
  });
  map.navigation.on('voiceUnavailable', () =>
    showSubtitle('Máy không có giọng tiếng Việt — xem phụ đề'),
  );
  map.navigation.on('followChange', (following) => {
    el('nav-recenter').hidden = following;
  });

  el('nav-start').addEventListener('click', () => startNav(false));
  el('nav-simulate').addEventListener('click', () => startNav(true));
  el('nav-stop').addEventListener('click', () => {
    map.navigation.stop();
    backToPlan();
  });
  el('nav-recenter').addEventListener('click', () => map.navigation.recenter());

  /** @param {NavPoint | null} [prefillTo] Điểm vừa tìm/chọn trước khi vào chế độ — điền sẵn nếu chưa có điểm đến. */
  function enter(prefillTo) {
    if (active) return;
    active = true;
    document.body.dataset.nav = '1';
    delete document.body.dataset.tools;
    const filledTo = !to && prefillTo ? prefillTo : null;
    if (filledTo) to = filledTo;
    card.hidden = false;
    el('tools').hidden = false;
    renderModes();
    renderPoints();
    onChange(filledTo ? { tab: 'dan-duong', to: filledTo } : { tab: 'dan-duong' });
    void compute();
  }

  function exit() {
    if (!active) return;
    if (subtitleTimer) clearTimeout(subtitleTimer);
    if (arrivedTimer) clearTimeout(arrivedTimer);
    if (phase === 'nav') map.navigation.stop();
    setPhase('plan');
    active = false;
    popup?.remove();
    fromMarker?.remove();
    toMarker?.remove();
    fromMarker = null;
    toMarker = null;
    from = null;
    to = null;
    response = null;
    activeRoute = 0;
    requestId += 1;
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
