import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { createTranslator, fallbackChain, negotiate, type Messages } from './index.js';

// .test-build is the cwd; the locale files stay in src.
const DIR = path.resolve('../src/i18n/locales');
const files: Record<string, Messages> = Object.fromEntries(
  readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(path.join(DIR, f), 'utf8'))]),
);

test('fallback chain ends at the source locale', () => {
  assert.deepEqual(fallbackChain('he-IL'), ['he-IL', 'he', 'en']);
  assert.deepEqual(fallbackChain('en'), ['en']);
  assert.equal(negotiate(['he-IL', 'en-US'], Object.keys(files)), 'he');
  assert.equal(negotiate(['fr-FR'], Object.keys(files)), 'en');
});

test('every locale parses, and has no key the source lacks', () => {
  const source = Object.keys(files.en);
  for (const [tag, msgs] of Object.entries(files)) {
    assert.ok(msgs.$meta, `${tag}.json has no $meta`);
    for (const [k, v] of Object.entries(msgs)) {
      if (k === '$meta') continue;
      assert.ok(source.includes(k), `${tag}.json has "${k}", which en.json lacks`);
      assert.doesNotThrow(() => new IntlMessageFormat(v as string, tag), `${tag}: "${k}" is not valid ICU`);
    }
  }
});

test('the share video says it in each language, never needing the child gender', () => {
  const he = createTranslator('he-IL', files);
  assert.equal(he.meta.dir, 'rtl');
  assert.equal(he.t('shareVideo.f1.title', { child: 'דן' }), 'תראו את הציור של דן');
  assert.equal(he.t('shareVideo.f1.title', { child: 'מאיה', childGender: 'female' }), 'תראו מה מאיה ציירה');
  assert.equal(he.t('shareVideo.f1.title'), 'תראו את הציור הזה');
  const en = createTranslator('en-US', files);
  assert.equal(en.t('shareVideo.f1.title', { child: 'Dan' }), 'Dan drew this!');
  assert.equal(en.t('shareSheet.title', { hero: 'Violet Volt' }), 'Share Violet Volt');
  assert.equal(en.t('no.such.key'), 'no.such.key');
});
