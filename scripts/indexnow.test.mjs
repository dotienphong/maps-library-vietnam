import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chuTrongMain,
  lapPayload,
  main,
  tepChoUrl,
  timKhoa,
  urlTrongSitemap,
} from './indexnow.mjs';

const SITE = 'https://vi-du.test';
const KHOA = '0123456789abcdef0123456789abcdef';

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} HamFetch */

/**
 * fetch giả: tra URL trong bảng; thiếu thì 404.
 * @param {Record<string, string>} bang
 * @returns {HamFetch}
 */
const fetchGia = (bang) => async (url) => {
  const noiDung = bang[url];
  return noiDung === undefined
    ? new Response('', { status: 404 })
    : new Response(noiDung, { status: 200 });
};

/** @type {HamFetch} */
const matMang = async () => {
  throw new TypeError('fetch failed');
};

/** HTML có tên asset ngẫu nhiên như sau mỗi lần build. @param {string} chu */
const html = (chu) =>
  `<!doctype html><html><head><link rel="stylesheet" href="/_astro/a.${Math.random()}.css"></head><body><nav>Menu</nav><main><h1>${chu}</h1><script src="/_astro/x.${Math.random()}.js"></script></main></body></html>`;

/** @param {string[]} duong */
const sitemap = (duong) =>
  `<?xml version="1.0"?><urlset>${duong.map((d) => `<url><loc>${SITE}${d}</loc></url>`).join('')}</urlset>`;

const indexSong = `<sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`;

/**
 * Dựng dist tạm: tệp khoá, sitemap-0.xml và HTML cho từng đường dẫn.
 * @param {Record<string, string>} trang đường dẫn → chữ của h1
 */
function distTam(trang) {
  const dist = mkdtempSync(join(tmpdir(), 'mlv-indexnow-'));
  writeFileSync(join(dist, `${KHOA}.txt`), KHOA);
  writeFileSync(join(dist, 'sitemap-index.xml'), '<sitemapindex></sitemapindex>');
  writeFileSync(join(dist, 'sitemap-0.xml'), sitemap(Object.keys(trang)));
  for (const [duong, chu] of Object.entries(trang)) {
    const tep = tepChoUrl(dist, `${SITE}${duong}`);
    mkdirSync(dirname(tep), { recursive: true });
    writeFileSync(tep, html(chu));
  }
  return dist;
}

const tepTam = () => join(mkdtempSync(join(tmpdir(), 'mlv-out-')), 'payload.json');

describe('chuTrongMain', () => {
  it('chỉ lấy chữ trong <main>, bỏ script và thẻ — đổi tên asset không tính là trang đổi', () => {
    expect(chuTrongMain(html('Xin chào'))).toBe('Xin chào');
    expect(chuTrongMain(html('Xin chào'))).toBe(chuTrongMain(html('Xin chào')));
  });

  it('trang không có <main> thì lấy <body>', () => {
    expect(chuTrongMain('<html><body><h1>Playground</h1>\n  <p>Thử</p></body></html>')).toBe(
      'Playground Thử',
    );
  });
});

describe('tepChoUrl', () => {
  it('URL có gạch cuối là index.html trong thư mục; không gạch cuối là tệp .html', () => {
    expect(tepChoUrl('/d', `${SITE}/`)).toBe(join('/d', 'index.html'));
    expect(tepChoUrl('/d', `${SITE}/bang-gia/`)).toBe(join('/d', 'bang-gia', 'index.html'));
    expect(tepChoUrl('/d', `${SITE}/playground`)).toBe(join('/d', 'playground.html'));
  });
});

describe('urlTrongSitemap', () => {
  it('đọc mọi <loc>', () => {
    expect(urlTrongSitemap(sitemap(['/', '/a/']))).toEqual([`${SITE}/`, `${SITE}/a/`]);
  });
});

describe('timKhoa', () => {
  it('khoá là tệp 32 hex có nội dung trùng tên', () => {
    expect(timKhoa(distTam({}))).toBe(KHOA);
  });
});

describe('lapPayload', () => {
  it('chỉ gồm URL mới, URL đổi chữ và URL bị bỏ khỏi sitemap', async () => {
    const dist = distTam({ '/': 'Trang chủ', '/doi/': 'Bản mới', '/moi/': 'Trang mới' });
    const payload = await lapPayload({
      dist,
      site: SITE,
      fetchFn: fetchGia({
        [`${SITE}/sitemap-index.xml`]: indexSong,
        [`${SITE}/sitemap-0.xml`]: sitemap(['/', '/doi/', '/bo/']),
        [`${SITE}/`]: html('Trang chủ'),
        [`${SITE}/doi/`]: html('Bản cũ'),
      }),
    });
    expect(payload).toEqual({
      host: 'vi-du.test',
      key: KHOA,
      keyLocation: `${SITE}/${KHOA}.txt`,
      urlList: [`${SITE}/doi/`, `${SITE}/moi/`, `${SITE}/bo/`],
    });
  });

  it('mất mạng thì coi mọi URL là đổi — báo thừa còn hơn bỏ sót', async () => {
    const payload = await lapPayload({
      dist: distTam({ '/': 'A', '/b/': 'B' }),
      site: SITE,
      fetchFn: matMang,
    });
    expect(payload.urlList).toEqual([`${SITE}/`, `${SITE}/b/`]);
  });
});

describe('main', () => {
  it('truoc rồi gui: POST đúng payload lên api.indexnow.org, thoát 0', async () => {
    const dist = distTam({ '/': 'Mới' });
    const out = tepTam();
    /** @type {{ url: string, body: string }[]} */
    const daGui = [];
    /** @type {HamFetch} */
    const fetchFn = async (url, init) => {
      if (init?.method === 'POST') {
        daGui.push({ url, body: String(init.body) });
        return new Response('', { status: 202 });
      }
      return new Response('', { status: 404 });
    };
    expect(await main(['truoc', '--dist', dist, '--site', SITE, '--out', out], fetchFn)).toBe(0);
    expect(await main(['gui', '--site', SITE, '--list', out], fetchFn)).toBe(0);
    expect(daGui).toHaveLength(1);
    expect(daGui[0]?.url).toBe('https://api.indexnow.org/indexnow');
    expect(JSON.parse(daGui[0]?.body ?? '{}').urlList).toEqual([`${SITE}/`]);
  });

  it('dist hỏng hay IndexNow trả 403 vẫn thoát 0 — không bao giờ làm đỏ deploy', async () => {
    const out = tepTam();
    expect(
      await main(['truoc', '--dist', '/khong/co/thu/muc', '--site', SITE, '--out', out], matMang),
    ).toBe(0);
    expect(await main(['gui', '--site', SITE, '--list', out], matMang)).toBe(0);

    const out2 = tepTam();
    await main(['truoc', '--dist', distTam({ '/': 'X' }), '--site', SITE, '--out', out2], matMang);
    expect(
      await main(
        ['gui', '--site', SITE, '--list', out2],
        async () => new Response('', { status: 403 }),
      ),
    ).toBe(0);
  });

  it('không URL nào đổi thì không gửi gì', async () => {
    const dist = distTam({ '/': 'Giống' });
    const out = tepTam();
    let soLanPost = 0;
    /** @type {HamFetch} */
    const fetchFn = async (url, init) => {
      if (init?.method === 'POST') {
        soLanPost += 1;
        return new Response('', { status: 200 });
      }
      if (url === `${SITE}/sitemap-index.xml`) return new Response(indexSong);
      if (url === `${SITE}/sitemap-0.xml`) return new Response(sitemap(['/']));
      return new Response(html('Giống'));
    };
    await main(['truoc', '--dist', dist, '--site', SITE, '--out', out], fetchFn);
    await main(['gui', '--site', SITE, '--list', out], fetchFn);
    expect(soLanPost).toBe(0);
  });
});

describe('tệp khoá IndexNow trong hai site', () => {
  it('mỗi site đúng một tệp khoá, nội dung trùng tên, hai site cùng khoá', () => {
    const khoa = ['apps/site/public', 'apps/docs/public'].map((thuMuc) => {
      const tep = readdirSync(thuMuc).filter((ten) => /^[0-9a-f]{32}\.txt$/.test(ten));
      expect(tep, thuMuc).toHaveLength(1);
      const ten = String(tep[0]).slice(0, 32);
      expect(readFileSync(join(thuMuc, `${ten}.txt`), 'utf8').trim(), thuMuc).toBe(ten);
      return ten;
    });
    expect(khoa[0]).toBe(khoa[1]);
  });
});
