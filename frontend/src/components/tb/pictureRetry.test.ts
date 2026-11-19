import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RETRY_DELAYS_MS, retryDelay, retryUrl } from './pictureRetry.js';

test('the first try is the address itself', () => {
  assert.equal(retryUrl('/api/files/u/c/thumb_rendered.png?v=1a', 0), '/api/files/u/c/thumb_rendered.png?v=1a');
});

test('a retry is a new address, keeping the version', () => {
  assert.equal(retryUrl('/api/files/u/c/thumb_rendered.png?v=1a', 1), '/api/files/u/c/thumb_rendered.png?v=1a&r=1');
  assert.equal(retryUrl('/api/files/u/c/original.jpg', 2), '/api/files/u/c/original.jpg?r=2');
});

test('retrying a retry replaces its count rather than adding another', () => {
  assert.equal(retryUrl('/x.png?v=1&r=1', 2), '/x.png?v=1&r=2');
  assert.equal(retryUrl('/x.png?r=1', 2), '/x.png?r=2');
  assert.equal(retryUrl('/x.png?r=1&v=1', 2), '/x.png?v=1&r=2');
});

test('a fragment stays at the end', () => {
  assert.equal(retryUrl('/x.png?v=1#a', 1), '/x.png?v=1&r=1#a');
});

test('two retries, then it gives up', () => {
  assert.equal(retryDelay(1), RETRY_DELAYS_MS[0]);
  assert.equal(retryDelay(2), RETRY_DELAYS_MS[1]);
  assert.equal(retryDelay(3), null);
  assert.equal(retryDelay(0), null);
});
