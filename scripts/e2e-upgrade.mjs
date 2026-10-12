// The upgrade e2e (`pnpm run e2e:upgrade [commit]`, run locally): builds an earlier version (default: the
// M3 release commit) in a temporary git worktree, builds the current tree, and runs e2e/upgrade.spec.ts,
// which installs the earlier build, upgrades it in place to the current one and checks nothing was lost.
// A failed build of the earlier version fails the run: the upgrade is never tested against anything else.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FROM = process.argv[2] ?? '4524123';
const OUT = join(ROOT, '.output/e2e-upgrade');

function run(cmd, args, cwd, env = process.env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}  (in ${cwd === ROOT ? 'the repository' : 'the worktree'})`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status ?? r.signal}`);
}

rmSync(OUT, { recursive: true, force: true });
const worktree = join(mkdtempSync(join(tmpdir(), 'translate-side-upgrade-')), 'from');
try {
  run('git', ['worktree', 'add', '--detach', worktree, FROM], ROOT);
  run('pnpm', ['install', '--frozen-lockfile'], worktree);
  run('pnpm', ['run', 'build'], worktree);
  if (!existsSync(join(worktree, '.output/chrome-mv3/manifest.json'))) throw new Error(`the build of ${FROM} has no manifest`);
  cpSync(join(worktree, '.output/chrome-mv3'), join(OUT, 'from'), { recursive: true });
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'inherit' });
  rmSync(resolve(worktree, '..'), { recursive: true, force: true });
}
run('pnpm', ['run', 'build'], ROOT);
cpSync(join(ROOT, '.output/chrome-mv3'), join(OUT, 'to'), { recursive: true });
run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e/playwright.config.ts', 'e2e/upgrade.spec.ts'], ROOT, {
  ...process.env,
  UPGRADE_FROM: join(OUT, 'from'),
  UPGRADE_TO: join(OUT, 'to'),
});
