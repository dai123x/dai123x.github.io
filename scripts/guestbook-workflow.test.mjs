import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = (await readFile(new URL('../.github/workflows/guestbook.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const publish = workflow.slice(workflow.indexOf('  publish:'));
const script = publish.split('          script: |\n')[1].split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run(action, comments = [], { text = 'Hello', failWrite = false, failDispatch = false, concurrentChange = false } = {}) {
  const calls = [];
  const labelsRemoved = [];
  let reads = 0;
  const issue = { number: 7, body: `### 昵称\nVisitor\n### 留言\n${text}`, created_at: '2026-10-25T00:00:00Z' };
  const context = { payload: { issue, action, repository: { default_branch: 'main' } }, repo: { owner: 'owner', repo: 'site' } };
  const github = { rest: {
    repos: {
      getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(comments)).toString('base64'), sha: concurrentChange && reads++ > 0 ? 'concurrent' : 'original' } }),
      createOrUpdateFileContents: async args => {
        if (failWrite || (concurrentChange && args.sha !== 'concurrent')) throw new Error('conflict');
        calls.push(['write', args]);
      },
    },
    actions: { createWorkflowDispatch: async args => { if (failDispatch) throw new Error('dispatch unavailable'); calls.push(['dispatch', args]); } },
    issues: { createComment: async () => {}, removeLabel: async args => { labelsRemoved.push(args.name); } },
  } };
  try { await new AsyncFunction('github', 'context', 'Buffer', script)(github, context, Buffer); }
  catch (error) { return { calls, error, labelsRemoved }; }
  return { calls, labelsRemoved };
}

test('publishing a comment requests Pages deployment after saving it', async () => {
  const { calls, error } = await run('labeled');
  assert.ifError(error);
  assert.deepEqual(calls.map(call => call[0]), ['write', 'dispatch']);
  assert.deepEqual(calls[1][1], { owner: 'owner', repo: 'site', workflow_id: 'deploy.yml', ref: 'main' });
});

test('withdrawing a comment also requests deployment', async () => {
  const { calls, error } = await run('unlabeled', [{ n: 7 }]);
  assert.ifError(error);
  assert.deepEqual(calls.map(call => call[0]), ['write', 'dispatch']);
});

test('empty comments do not request deployment', async () => {
  const { calls, error } = await run('labeled', [], { text: '' });
  assert.ifError(error);
  assert.deepEqual(calls, []);
});

test('retry after a failed publish dispatch deploys the saved comment without rewriting it', async () => {
  const first = await run('labeled', [], { failDispatch: true });
  assert.match(first.error.message, /dispatch unavailable/);
  assert.deepEqual(first.calls.map(call => call[0]), ['write']);
  const saved = JSON.parse(Buffer.from(first.calls[0][1].content, 'base64').toString('utf8'));
  const retry = await run('labeled', saved);
  assert.ifError(retry.error);
  assert.deepEqual(retry.calls.map(call => call[0]), ['dispatch']);
  assert.deepEqual(retry.labelsRemoved, ['pending-review']);
});

test('retry after a failed withdrawal dispatch deploys the saved removal', async () => {
  const first = await run('unlabeled', [{ n: 7 }], { failDispatch: true });
  assert.match(first.error.message, /dispatch unavailable/);
  const saved = JSON.parse(Buffer.from(first.calls[0][1].content, 'base64').toString('utf8'));
  const retry = await run('unlabeled', saved);
  assert.ifError(retry.error);
  assert.deepEqual(retry.calls.map(call => call[0]), ['dispatch']);
  assert.deepEqual(retry.labelsRemoved, ['pending-review']);
});

test('a concurrent file edit fails safely instead of overwriting the newer comments', async () => {
  const { calls, error } = await run('labeled', [], { concurrentChange: true });
  assert.match(error?.message ?? '', /conflict/);
  assert.deepEqual(calls, []);
});

test('failed writes do not request deployment', async () => {
  const { calls, error } = await run('labeled', [], { failWrite: true });
  assert.match(error.message, /conflict/);
  assert.deepEqual(calls, []);
});

test('publishing job can dispatch the deployment workflow', () => {
  assert.match(workflow, /actions: write/);
});

