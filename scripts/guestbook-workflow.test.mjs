import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/guestbook.yml', import.meta.url), 'utf8');
const publish = workflow.slice(workflow.indexOf('  publish:'));
const script = publish.split('          script: |\n')[1].split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run(action, comments = [], { text = 'Hello', failWrite = false } = {}) {
  const calls = [];
  const issue = { number: 7, body: `### 昵称\nVisitor\n### 留言\n${text}`, created_at: '2026-10-25T00:00:00Z' };
  const context = { payload: { issue, action, repository: { default_branch: 'main' } }, repo: { owner: 'owner', repo: 'site' } };
  const github = { rest: {
    repos: {
      getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(comments)).toString('base64'), sha: 'original' } }),
      createOrUpdateFileContents: async args => { if (failWrite) throw new Error('conflict'); calls.push(['write', args]); },
    },
    actions: { createWorkflowDispatch: async args => { calls.push(['dispatch', args]); } },
    issues: { createComment: async () => {}, removeLabel: async () => {} },
  } };
  try { await new AsyncFunction('github', 'context', 'Buffer', script)(github, context, Buffer); }
  catch (error) { return { calls, error }; }
  return { calls };
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

test('empty, duplicate and absent comments do not request deployment', async () => {
  for (const result of [await run('labeled', [], { text: '' }), await run('labeled', [{ n: 7 }]), await run('unlabeled')]) {
    assert.ifError(result.error);
    assert.deepEqual(result.calls, []);
  }
});

test('failed writes do not request deployment', async () => {
  const { calls, error } = await run('labeled', [], { failWrite: true });
  assert.match(error.message, /conflict/);
  assert.deepEqual(calls, []);
});

test('publishing job can dispatch the deployment workflow', () => {
  assert.match(workflow, /actions: write/);
});
