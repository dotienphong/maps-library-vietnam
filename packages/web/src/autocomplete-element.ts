import {
  type AutocompleteItem,
  type AutocompleteType,
  createClient,
  type MapsLibVNClient,
  parsePoiSourcesCsv,
} from '@mapslibvn/core';

/** Map cung cấp cả tâm và Places client để bản đồ/tìm kiếm luôn dùng cùng tập nguồn POI. */
interface NearSource {
  gl: { getCenter(): { lat: number; lng: number } };
  places?: MapsLibVNClient;
}

const STYLE = `
:host { display: block; position: relative; color: #172033; font: 14px system-ui, sans-serif; }
input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #9ca8ba;
  border-radius: 8px; color: inherit; background: #fff; font: inherit; outline: none; }
input:focus { border-color: #2458a6; box-shadow: 0 0 0 3px rgba(36,88,166,.18); }
ul { position: absolute; left: 0; right: 0; margin: 4px 0 0; padding: 4px; list-style: none;
  background: #fff; border: 1px solid #c7cfda; border-radius: 8px; z-index: 30;
  max-height: 280px; overflow-y: auto; box-shadow: 0 8px 24px rgba(23,32,51,.16); }
li { padding: 8px 10px; border-radius: 5px; cursor: pointer; }
li:hover, li[aria-selected="true"] { background: #e9f1fc; }
.secondary { color: #667085; font-size: 12px; display: block; margin-top: 2px; }
.icon { display: inline-block; width: 1.2em; color: #667085; font-size: 12px; }
li[data-type="area"] .icon { color: #2458a6; }
.status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

let instanceId = 0;

/** Debounce mặc định của ô tìm kiếm, tính bằng mili giây. */
export const DEFAULT_DEBOUNCE_MS = 200;

/**
 * Ký hiệu phân biệt loại gợi ý. Dùng glyph hình học thay vì emoji để không phụ thuộc font emoji
 * của hệ điều hành. Vùng hành chính (`area`) phải khác POI vì hai loại này hay đứng cạnh nhau.
 */
const TYPE_ICON: Record<AutocompleteType, string> = {
  poi: '●',
  street: '─',
  address: '⌂',
  area: '▣',
};

/**
 * Lớp cơ sở của web component. `class … extends HTMLElement` đánh giá `HTMLElement` NGAY lúc nạp
 * module, nên trước 13/09/2026 `import '@mapslibvn/web'` (và `@mapslibvn/react`, vì react import
 * web) ném `ReferenceError: HTMLElement is not defined` trong mọi host dựng trang phía máy chủ —
 * Next.js, Remix, Astro — trước khi kịp render gì. Ở môi trường không có DOM, kế thừa một lớp rỗng:
 * component không bao giờ được khởi tạo ở đó, chỉ cần module nạp được.
 */
const ElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/** Autocomplete Places không phụ thuộc framework, tự debounce và phát event `select`. */
export class MapsLibVNAutocomplete extends ElementBase {
  static observedAttributes = ['api-key', 'api-base', 'placeholder', 'near', 'sources', 'debounce'];

  #map: NearSource | null = null;

  /** Gán map trả về từ createMap để dùng cùng Places client và tâm bản đồ. */
  get map(): NearSource | null {
    return this.#map;
  }

  set map(value: NearSource | null) {
    if (value === this.#map) return;
    this.#map = value;
    clearTimeout(this.#timer);
    this.#cancelPending();
    this.#render([]);
  }

  #client: MapsLibVNClient | null = null;
  #input: HTMLInputElement | null = null;
  #list: HTMLUListElement | null = null;
  #status: HTMLDivElement | null = null;
  #items: AutocompleteItem[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;
  #abortController: AbortController | undefined;
  #activeIndex = -1;
  #listId = `mapslibvn-autocomplete-${++instanceId}`;

  connectedCallback() {
    if (this.#input) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><input type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="${this.#listId}" /><ul id="${this.#listId}" role="listbox" hidden></ul><div class="status" role="status" aria-live="polite"></div>`;
    this.#input = root.querySelector('input');
    this.#list = root.querySelector('ul');
    this.#status = root.querySelector('.status');
    if (!this.#input || !this.#list || !this.#status) return;
    this.#input.placeholder = this.getAttribute('placeholder') ?? 'Tìm địa điểm…';
    this.#input.addEventListener('input', this.#onInput);
    this.#input.addEventListener('keydown', this.#onKeydown);
    this.#input.addEventListener('blur', this.#onBlur);
    this.#list.addEventListener('pointerdown', this.#onPointerDown);
  }

  disconnectedCallback() {
    clearTimeout(this.#timer);
    this.#cancelPending();
    this.#input?.removeEventListener('input', this.#onInput);
    this.#input?.removeEventListener('keydown', this.#onKeydown);
    this.#input?.removeEventListener('blur', this.#onBlur);
    this.#list?.removeEventListener('pointerdown', this.#onPointerDown);
    this.#input = null;
    this.#list = null;
    this.#status = null;
  }

  attributeChangedCallback(name: string) {
    if (name === 'api-key' || name === 'api-base' || name === 'sources') {
      this.#client = null;
      this.#cancelPending();
    }
    if (name === 'placeholder' && this.#input)
      this.#input.placeholder = this.getAttribute('placeholder') ?? 'Tìm địa điểm…';
  }

  #onInput = () => {
    clearTimeout(this.#timer);
    this.#cancelPending();
    const value = this.#input?.value ?? '';
    if (value.trim().length < 2) {
      this.#cancelPending();
      this.#render([]);
      this.#announce('');
      return;
    }
    this.#announce('Đang tìm…');
    this.#timer = setTimeout(() => void this.#query(value), this.#debounceMs());
  };

  #onBlur = () => {
    this.#cancelPending();
    this.#timer = setTimeout(() => this.#render([]), 150);
  };

  #onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      clearTimeout(this.#timer);
      this.#cancelPending();
      this.#render([]);
      return;
    }
    if (this.#items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const start = this.#activeIndex < 0 ? (delta > 0 ? -1 : 0) : this.#activeIndex;
      this.#setActive((start + delta + this.#items.length) % this.#items.length);
    } else if (event.key === 'Enter' && this.#activeIndex >= 0) {
      event.preventDefault();
      this.#select(this.#activeIndex);
    }
  };

  #onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (option) this.#select(Number(option.dataset.index));
  };

  #getClient(): MapsLibVNClient | null {
    if (this.#map?.places) return this.#map.places;
    if (this.#client) return this.#client;
    const apiKey = this.getAttribute('api-key');
    const baseUrl = this.getAttribute('api-base');
    if (!apiKey || !baseUrl) return null;
    // Thuộc tính vắng → để client tự dùng mặc định; có nhưng sai → cảnh báo rồi vẫn dùng mặc định,
    // vì một thuộc tính gõ sai không nên làm ô tìm kiếm chết hẳn.
    const rawSources = this.getAttribute('sources');
    const poiSources = rawSources === null ? null : parsePoiSourcesCsv(rawSources);
    if (rawSources !== null && !poiSources) {
      console.warn(`<mapslibvn-autocomplete sources="${rawSources}"> không hợp lệ — dùng mặc định`);
    }
    this.#client = createClient({
      apiKey,
      baseUrl,
      ...(poiSources ? { poiSources } : {}),
    });
    return this.#client;
  }

  /**
   * Thuộc tính vắng hoặc sai → dùng mặc định, giống cách `sources` xử lý: một thuộc tính gõ sai
   * không được làm ô tìm kiếm chết hẳn.
   */
  #debounceMs(): number {
    const raw = this.getAttribute('debounce');
    if (raw === null) return DEFAULT_DEBOUNCE_MS;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      console.warn(
        `<mapslibvn-autocomplete debounce="${raw}"> không hợp lệ — dùng ${DEFAULT_DEBOUNCE_MS} ms`,
      );
      return DEFAULT_DEBOUNCE_MS;
    }
    return value;
  }

  /** Vô hiệu hoá truy vấn đang chờ: tăng seq (che kết quả trễ) và huỷ request đang bay ra mạng. */
  #cancelPending(): void {
    this.#seq++;
    this.#abortController?.abort();
  }

  #near(): [number, number] | undefined {
    if (this.#map) {
      const center = this.#map.gl.getCenter();
      return [center.lat, center.lng];
    }
    const parts = this.getAttribute('near')?.split(',').map(Number);
    const lat = parts?.[0];
    const lng = parts?.[1];
    return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
      ? [lat, lng]
      : undefined;
  }

  async #query(raw: string) {
    const query = raw.trim();
    const client = this.#getClient();
    if (!client || query.length < 2) {
      this.#render([]);
      this.#announce(client ? '' : 'Thiếu cấu hình API.');
      return;
    }
    const seq = ++this.#seq;
    const controller = new AbortController();
    this.#abortController = controller;
    try {
      const near = this.#near();
      const { items } = await client.autocomplete(query, {
        ...(near ? { near } : {}),
        signal: controller.signal,
      });
      if (seq !== this.#seq) return;
      this.#render(items);
      this.#announce(items.length > 0 ? `Có ${items.length} kết quả.` : 'Không tìm thấy kết quả.');
    } catch {
      if (seq !== this.#seq) return;
      this.#render([]);
      this.#announce('Không thể tải gợi ý. Vui lòng thử lại.');
    }
  }

  #render(items: AutocompleteItem[]) {
    if (!this.#list || !this.#input) return;
    this.#items = items;
    this.#activeIndex = -1;
    this.#input.removeAttribute('aria-activedescendant');
    this.#input.setAttribute('aria-expanded', String(items.length > 0));
    this.#list.hidden = items.length === 0;
    this.#list.replaceChildren(
      ...items.map((item, index) => {
        const option = document.createElement('li');
        option.id = `${this.#listId}-option-${index}`;
        option.dataset.index = String(index);
        option.dataset.type = item.type;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = TYPE_ICON[item.type] ?? TYPE_ICON.poi;
        const name = document.createElement('span');
        name.textContent = item.name;
        const secondary = document.createElement('span');
        secondary.className = 'secondary';
        // Tên cũ của đường/địa danh (spec 6.3): nói rõ vì sao dòng này khớp, người dùng gõ
        // "Công Lý" mà thấy "Nam Kỳ Khởi Nghĩa" thì cần biết lý do.
        secondary.textContent = item.matched_alt
          ? `${item.secondary}${item.secondary ? ' · ' : ''}tên cũ: ${item.matched_alt}`
          : item.secondary;
        option.append(icon, name, secondary);
        return option;
      }),
    );
  }

  #setActive(index: number) {
    if (!this.#input || !this.#list) return;
    this.#activeIndex = index;
    for (const [optionIndex, option] of Array.from(this.#list.children).entries()) {
      option.setAttribute('aria-selected', String(optionIndex === index));
    }
    const active = this.#list.children.item(index) as HTMLElement | null;
    if (active) {
      this.#input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  #select(index: number) {
    const item = this.#items[index];
    if (!item || !this.#input) return;
    this.#input.value = item.name;
    this.#render([]);
    this.#announce(`Đã chọn ${item.name}.`);
    this.dispatchEvent(new CustomEvent('select', { detail: item, bubbles: true, composed: true }));
  }

  #announce(message: string) {
    if (this.#status) this.#status.textContent = message;
  }
}

export function defineAutocomplete(): void {
  // No-op ngoài trình duyệt: bản UMD gọi hàm này ở tầng module, và host SSR gọi nó trong đường
  // dựng trang chung — cả hai không được nổ khi không có registry.
  if (typeof customElements === 'undefined') return;
  if (!customElements.get('mapslibvn-autocomplete'))
    customElements.define('mapslibvn-autocomplete', MapsLibVNAutocomplete);
}
