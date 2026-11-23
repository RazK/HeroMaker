import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceText } from './price.js';

test('shekels read as the backend writes them', () => {
  assert.equal(priceText(1000, 'ILS'), '₪10');          // one seat
  assert.equal(priceText(10000, 'ILS'), '₪100');        // the 10-seat minimum
  assert.equal(priceText(3900, 'ILS'), '₪39');
  assert.equal(priceText(1050, 'ILS'), '₪10.50');
  assert.equal(priceText(1005, 'ILS'), '₪10.05');
  assert.equal(priceText(-250, 'ILS'), '-₪2.50');
});

test('without a currency it is US dollars, as Lemon Squeezy prices were', () => {
  assert.equal(priceText(3550), '$35.50');
  assert.equal(priceText(125, undefined), '$1.25');
});
