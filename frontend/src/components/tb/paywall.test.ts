import assert from 'node:assert/strict';
import { test } from 'node:test';
import { perHero, planLines } from './paywall.js';

const single = { name: 'One hero', heroes: 1, price_cents: 1000, price_display: '₪10' };
const family = { name: 'Family', heroes: 5, price_cents: 3900, price_display: '₪39' };

test('one hero is for this drawing', () => {
  assert.deepEqual(planLines(single), { title: 'One hero', line: 'This drawing' });
});

test('a pack says how many heroes and what each one costs', () => {
  assert.deepEqual(planLines(family), { title: 'Family pack', line: '5 heroes · ₪7.80 each' });
});

test('a name that already says pack is not said twice', () => {
  assert.equal(planLines({ ...family, name: 'Family pack' }).title, 'Family pack');
});

test('the price each keeps the pack\'s own currency sign, to the agora', () => {
  assert.equal(perHero({ heroes: 3, price_cents: 2500, price_display: '$25' }), '$8.33');
  assert.equal(perHero(family), '₪7.80');
});
