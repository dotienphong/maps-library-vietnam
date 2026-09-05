#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ADMIN_OLD_FIXTURE_PBF, ADMIN_OLD_MANIFEST, ADMIN_OLD_PBF, FIXTURE } from '../lib/env.mjs';
import { connect, publishNew, withAdvisoryLock } from '../pg.mjs';
import { downloadVerified, loadOldAdminRaw } from './admin-old-source.mjs';
import { buildOldAdmin } from './admin-overlay.mjs';

const manifest = JSON.parse(readFileSync(ADMIN_OLD_MANIFEST, 'utf8'));
const pbf = FIXTURE ? ADMIN_OLD_FIXTURE_PBF : ADMIN_OLD_PBF;
if (!FIXTURE) await downloadVerified({ ...manifest, target: pbf });
const sql = connect();
try {
  await withAdvisoryLock(sql, 'mapslibvn-admin-publish', async (connection) => {
    try {
      const sourceStats = await loadOldAdminRaw(connection, { pbfPath: pbf });
      const report = await buildOldAdmin(connection, { currentTable: 'admin_area', sourceStats });
      const publishStarted = performance.now();
      await publishNew(connection, ['admin_area_old', 'admin_alias']);
      console.log(
        `✓ admin old ${report.oldCount}; alias ${report.aliasCount}; publish ${Math.round(performance.now() - publishStarted)} ms`,
      );
    } finally {
      await connection.unsafe(
        'DROP TABLE IF EXISTS admin_area_old_new,admin_alias_new,admin_overlap_work',
      );
    }
  });
} finally {
  await sql.end();
}
