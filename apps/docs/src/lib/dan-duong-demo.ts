import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type DirectionsResponse,
  type ManeuverKind,
  type NavigationProgress,
  type NavigationStartOptions,
  type RouteProvider,
  type TravelMode,
  createMap,
  formatDistanceShort,
  playbackSource,
  simulateFixes,
} from '@mapslibvn/web';
import * as maplibregl from 'maplibre-gl';
import { resolveApiBase } from './api-base';

const DEMO_KEY = 'mlv_live_demo00000000000000000000';
const CENTER: [number, number] = [106.699, 10.7798];

const ICONS: Readonly<Record<ManeuverKind, string>> = {
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

const STATUS_TEXT: Readonly<Record<string, string>> = {
  idle: 'Chưa dẫn đường',
  navigating: 'Đang dẫn đường',
  off_route: 'Lệch tuyến',
  rerouting: 'Đang tính lại tuyến…',
  arrived: 'Đã đến nơi',
};

function byId<T extends HTMLElement>(root: Document, id: string): T {
  const el = root.getElementById(id);
  if (!el) throw new Error(`Thiếu #${id}`);
  return el as T;
}

export function mountDemo(root: Document = document): void {
  const q = new URLSearchParams(location.search);
  const apiBase = resolveApiBase(location.search, location.hostname);
  const apiKey = q.get('key') ?? DEMO_KEY;
  const useFixture = q.get('fixture') === '1';
  let simulate = q.get('simulate') === '1';
  const rate = Math.max(1, Number(q.get('rate') ?? '20'));

  const status = byId<HTMLElement>(root, 'status');
  const findButton = byId<HTMLButtonElement>(root, 'find');
  const startButton = byId<HTMLButtonElement>(root, 'start');
  const simulateButton = byId<HTMLButtonElement>(root, 'simulate');
  const stopButton = byId<HTMLButtonElement>(root, 'stop');
  const recenterButton = byId<HTMLButtonElement>(root, 'recenter');
  const modeSelect = byId<HTMLSelectElement>(root, 'mode');
  const hint = byId<HTMLElement>(root, 'hint');
  const icon = byId<HTMLElement>(root, 'icon');
  const instruction = byId<HTMLElement>(root, 'instruction');
  const distance = byId<HTMLElement>(root, 'distance');
  const eta = byId<HTMLElement>(root, 'eta');
  const gps = byId<HTMLElement>(root, 'gps');
  const steps = byId<HTMLOListElement>(root, 'steps');
  const announcements = byId<HTMLOListElement>(root, 'announcements');
  const log = byId<HTMLUListElement>(root, 'log');

  const map = createMap(
    { container: 'map', apiKey, apiBase, center: CENTER, zoom: 15 },
    { maplibre: maplibregl },
  );

  let from: [number, number] | null = null; // [lng, lat]
  let to: [number, number] | null = null;
  let fromMarker: maplibregl.Marker | null = null;
  let toMarker: maplibregl.Marker | null = null;
  let response: DirectionsResponse | null = null;
  let fixCount = 0;

  const provider: RouteProvider = useFixture
    ? {
        directions: async () =>
          (await (await fetch('/fixtures/directions-q1.json')).json()) as DirectionsResponse,
      }
    : map.places;

  const addLog = (text: string): void => {
    const li = root.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString('vi-VN')} — ${text}`;
    log.prepend(li);
  };
  const setStatus = (s: string): void => {
    status.dataset.status = s;
    status.textContent = STATUS_TEXT[s] ?? s;
  };
  const setPoints = (): void => {
    hint.textContent = !from
      ? 'Bấm lên bản đồ để chọn điểm đi.'
      : !to
        ? 'Bấm lên bản đồ để chọn điểm đến.'
        : 'Bấm "Tìm tuyến".';
    findButton.disabled = !(useFixture || (from && to));
  };

  map.gl.on('click', (e) => {
    if (map.navigation.status !== 'idle' && map.navigation.status !== 'arrived') return;
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (!from || (from && to)) {
      from = lngLat;
      to = null;
      fromMarker?.remove();
      toMarker?.remove();
      fromMarker = map.addMarker({ lng: lngLat[0], lat: lngLat[1], color: '#2458a6' });
      response = null;
      map.routes.clear();
      startButton.disabled = true;
      simulateButton.disabled = true;
    } else {
      to = lngLat;
      toMarker = map.addMarker({ lng: lngLat[0], lat: lngLat[1], color: '#d92d20' });
    }
    setPoints();
  });

  const renderSteps = (r: DirectionsResponse): void => {
    steps.replaceChildren();
    const route = r.routes[0];
    if (!route) return;
    for (const leg of route.legs) {
      for (const s of leg.steps) {
        const li = root.createElement('li');
        li.textContent = `${ICONS[s.kind]} ${s.instruction} (${formatDistanceShort(s.distance_m)})`;
        steps.append(li);
      }
    }
  };

  findButton.addEventListener('click', async () => {
    findButton.disabled = true;
    try {
      const mode = modeSelect.value as TravelMode;
      const req = useFixture
        ? { from: [10.7798, 106.699] as [number, number], to: [10.7725, 106.698] as [number, number], mode }
        : {
            from: [from?.[1] ?? 0, from?.[0] ?? 0] as [number, number],
            to: [to?.[1] ?? 0, to?.[0] ?? 0] as [number, number],
            mode,
          };
      response = await provider.directions(req);
      const route = response.routes[0];
      if (!route) throw new Error('Không có tuyến');
      map.routes.show(response);
      map.fitBounds(route.bbox, 60);
      renderSteps(response);
      startButton.disabled = false;
      simulateButton.disabled = false;
      addLog(`Tuyến ${formatDistanceShort(route.distance_m)}, ${Math.round(route.duration_s / 60)} phút, ${route.legs[0]?.steps.length ?? 0} bước`);
    } catch (error) {
      addLog(`Lỗi tính tuyến: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      findButton.disabled = false;
    }
  });

  const start = (): void => {
    if (!response) return;
    const route = response.routes[0];
    if (!route) return;
    fixCount = 0;
    announcements.replaceChildren();
    const options: NavigationStartOptions = { response, provider, voice: !simulate };
    if (simulate) {
      options.source = playbackSource(simulateFixes(route, { jitter_m: 4, seed: 7 }), { rate });
    }
    map.navigation.start(options);
    startButton.disabled = true;
    simulateButton.disabled = true;
    stopButton.disabled = false;
  };
  startButton.addEventListener('click', () => {
    simulate = q.get('simulate') === '1';
    start();
  });
  simulateButton.addEventListener('click', () => {
    simulate = true;
    start();
  });
  stopButton.addEventListener('click', () => {
    map.navigation.stop();
    setStatus('idle');
    stopButton.disabled = true;
    startButton.disabled = response === null;
    simulateButton.disabled = response === null;
  });
  recenterButton.addEventListener('click', () => map.navigation.recenter());

  map.navigation.on('status', (e) => {
    setStatus(e.status);
    if (e.status === 'arrived') {
      stopButton.disabled = true;
      startButton.disabled = false;
      simulateButton.disabled = false;
    }
  });
  map.navigation.on('progress', (p: NavigationProgress) => {
    fixCount += 1;
    const next = p.nextStep ?? p.step;
    icon.textContent = ICONS[next.kind];
    instruction.textContent = next.instruction;
    distance.textContent = formatDistanceShort(p.distanceToStep_m);
    eta.textContent = `${Math.max(1, Math.round(p.remaining_s / 60))} phút · ${formatDistanceShort(p.remaining_m)}`;
    gps.textContent = `${fixCount} điểm · sai số ${Math.round(p.fix.accuracy_m ?? 0)} m · lệch ${Math.round(p.offRoute_m)} m`;
  });
  map.navigation.on('announce', (a) => {
    const li = root.createElement('li');
    li.textContent = a.text;
    li.dataset.kind = a.kind;
    announcements.append(li);
  });
  map.navigation.on('offRoute', (e) => addLog(`Lệch tuyến ${Math.round(e.distance_m)} m`));
  map.navigation.on('reroute', (e) => {
    addLog(`Có tuyến mới (${e.reason})`);
    renderSteps(e.response);
  });
  map.navigation.on('rerouteFailed', (e) => addLog(`Tính lại thất bại lần ${e.attempts}${e.final ? ' — dừng tự tính' : ''}`));
  map.navigation.on('arrive', () => addLog('Đã đến nơi'));
  map.navigation.on('positionError', (e) => addLog(`GPS: ${e.code} — ${e.message}`));
  map.navigation.on('voiceUnavailable', () => addLog('Máy không có giọng đọc cho ngôn ngữ này'));
  map.navigation.on('followChange', (following) => {
    recenterButton.hidden = following;
  });

  setStatus('idle');
  setPoints();
  (globalThis as { __mapslibvnDemo?: unknown }).__mapslibvnDemo = {
    map,
    hasRouteLayer: () => Boolean(map.gl.getLayer('mapslibvn-route-line')),
  };
}
