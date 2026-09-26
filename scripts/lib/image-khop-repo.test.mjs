import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docNhan, loiImageLechRepo, NHAN_DIRTY, NHAN_REV, PATHSPEC } from './image-khop-repo.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const HEAD = '9198da8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CU = '0df785fbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LOCAL = 'mapslibvn/pipeline:local';
const GHCR = 'ghcr.io/dotienphong/mapslibvn-pipeline:latest';
const khop = {
  image: LOCAL,
  rev: HEAD,
  dirty: 'false',
  head: HEAD,
  revCoTrongRepo: true,
  thayDoi: [],
};

describe('loiImageLechRepo', () => {
  it('image dựng đúng HEAD từ cây sạch → đi tiếp', () => {
    expect(loiImageLechRepo(khop)).toBeNull();
  });

  it('commit khác HEAD nhưng không đổi file nào chạy trong image (chỉ docs/apps) → đi tiếp', () => {
    expect(loiImageLechRepo({ ...khop, rev: CU })).toBeNull();
  });

  it('ca 26/09: image có đủ tên migration nhưng db-permissions.mjs cũ → DỪNG, liệt kê file', () => {
    const msg = loiImageLechRepo({
      ...khop,
      rev: CU,
      thayDoi: ['scripts/lib/db-permissions.mjs', 'db/migrations/0026_moi.sql'],
    });
    expect(msg).toContain('0df785f');
    expect(msg).toContain('9198da8');
    expect(msg).toContain('scripts/lib/db-permissions.mjs');
    expect(msg).toContain('db/migrations/0026_moi.sql');
    expect(msg).toContain('pnpm image:build');
  });

  it('image không có nhãn commit (dựng trước bản sửa) → DỪNG, không đoán', () => {
    expect(loiImageLechRepo({ ...khop, rev: '' })).toContain(NHAN_REV);
  });

  it('image dựng từ cây có thay đổi chưa commit → DỪNG (migration chưa xong không lên production)', () => {
    expect(loiImageLechRepo({ ...khop, dirty: 'true' })).toContain('chưa commit');
  });

  it('commit của image không có trong repo → DỪNG', () => {
    expect(loiImageLechRepo({ ...khop, rev: CU, revCoTrongRepo: false })).toContain('git fetch');
  });

  it('image GHCR lệch → chờ job image của CI, không bảo build tay', () => {
    const msg = loiImageLechRepo({ ...khop, image: GHCR, rev: CU, thayDoi: ['scripts/x.mjs'] });
    expect(msg).toContain('CI');
    expect(msg).not.toContain('pnpm image:build');
  });
});

describe('docNhan', () => {
  it('`<no value>` của docker inspect là nhãn vắng', () => {
    expect(docNhan('<no value>\n')).toBe('');
    expect(docNhan(`${HEAD}\n`)).toBe(HEAD);
  });
});

describe('phạm vi so', () => {
  it('gồm mọi thứ chạy trong image ở server:update/setup/restore, bỏ test và tài liệu', () => {
    for (const p of [
      'db',
      'scripts',
      'pipelines',
      'packages/core',
      'packages/style',
      'pnpm-lock.yaml',
    ]) {
      expect(PATHSPEC).toContain(p);
    }
    expect(PATHSPEC.join(' ')).toContain('*.test.mjs');
    expect(PATHSPEC.join(' ')).toContain('*.md');
  });
});

describe('nơi gắn nhãn và nơi kiểm', () => {
  const read = (/** @type {string} */ p) => readFileSync(resolve(ROOT, p), 'utf8');
  const update = read('scripts/server-update.mjs');
  const setup = read('scripts/server-setup.mjs');

  it('CI và pnpm image:build đều gắn nhãn commit + trạng thái cây', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(`${NHAN_REV}=\${{ github.sha }}`);
    expect(ci).toContain(`${NHAN_DIRTY}=false`);
    const image = read('scripts/image.mjs');
    expect(image).toContain('NHAN_REV');
    expect(image).toContain('NHAN_DIRTY');
    expect(image).toContain("'--label'");
  });

  it('server:update và server:setup dừng TRƯỚC khi migrate; server:update còn trước `up -d`', () => {
    /** @type {[string, string][]} */
    const cap = [
      [update, 'serverMigrateRun(env'],
      [setup, 'scripts/db-migrate.mjs'],
    ];
    for (const [src, buocMigrate] of cap) {
      expect(src).toContain('phaiKhopRepo(');
      expect(src.indexOf('phaiKhopRepo(')).toBeLessThan(src.indexOf(buocMigrate));
    }
    expect(update.indexOf('phaiKhopRepo(')).toBeLessThan(update.indexOf("'up', '-d'"));
  });

  it('server:update migrate bằng chính image (không mount db/ của cây), mật khẩu không nằm trên argv', () => {
    expect(update).toContain('mountDb: false');
    expect(update).not.toContain('POSTGRES_PASSWORD=${');
  });
});
