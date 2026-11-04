import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { anchorsOf, checkLinks, slug } from './mdlinks.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

test('GitHub-style slugs and repeated headings', () => {
  assert.equal(slug('Q-13 — Xbox controller coverage'), 'q-13--xbox-controller-coverage');
  assert.equal(slug('Finish plan — 2026-11-04'), 'finish-plan--2026-11-04');
  const a = anchorsOf('# Tests\n## Tests\n```\n# not a heading\n```\n## `code` and [link](x.md)\n<a id="pin"></a>\n');
  assert.deepEqual([...a].sort(), ['code-and-link', 'pin', 'tests', 'tests-1']);
});

test('reports missing files and anchors, skips code and external links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mdlinks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/a.md'), '# Alpha\n## Beta gamma\n');
  await writeFile(join(root, 'README.md'), [
    '[ok](docs/a.md#beta-gamma) [ok2](docs/a.md) [web](https://example.com/x#y)',
    '[bad anchor](docs/a.md#nope) [bad file](docs/missing.md)',
    '`[in code](docs/missing.md)`',
    '```', '[fenced](docs/missing.md)', '```',
  ].join('\n'));
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '.']);
  const r = checkLinks(root);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.broken, ['README.md:2: missing anchor docs/a.md#nope', 'README.md:2: missing file docs/missing.md']);
});

test('every relative link in the repo docs resolves', () => {
  const r = checkLinks(REPO);
  assert.ok(r.checked > 100, `only ${r.checked} links checked`);
  assert.deepEqual(r.broken, []);
});
