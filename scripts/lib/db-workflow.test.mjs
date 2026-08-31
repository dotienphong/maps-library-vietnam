import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('DB test workflow prerequisites', () => {
  it('builds the style templates before running fixture QA', () => {
    const workflow = readFileSync('.github/workflows/dbtest.yml', 'utf8');
    const styleBuild = workflow.indexOf('pnpm --filter @mapslibvn/style build');
    const dbtest = workflow.indexOf('pnpm test:db');

    expect(styleBuild).toBeGreaterThan(-1);
    expect(dbtest).toBeGreaterThan(styleBuild);
  });
});
