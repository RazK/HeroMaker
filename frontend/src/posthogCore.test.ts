import assert from 'node:assert/strict';
import test from 'node:test';
import { PostHogLike, PostHogSetting, allowed, initOptions, scrubEvent, scrubUrl, startIfAllowed } from './posthogCore.js';

const KEY = `phc_${'A1b2C3d4E5'.repeat(4)}`;
const setting: PostHogSetting = { key: KEY, host: 'https://eu.i.posthog.com' };
const person = { robot: false, visitor: '0f8b0c1e-7a54-4d7e-9a2b-3c5d6e7f8a9b' };

/** A stand-in for posthog-js that records what it is told. */
function library() {
  const calls: Array<[string, unknown, unknown?]> = [];
  const posthog: PostHogLike = {
    init: (key, options) => { calls.push(['init', key, options]); },
    capture: (event, properties) => { calls.push(['capture', event, properties]); },
    register: (properties) => { calls.push(['register', properties]); },
    setPersonProperties: (properties) => { calls.push(['setPersonProperties', properties]); },
  };
  let loads = 0;
  return { calls, load: async () => { loads += 1; return posthog; }, loaded: () => loads };
}

test('with no key, nothing is loaded and nothing is sent', async () => {
  for (const none of [null, undefined, { key: '', host: 'https://eu.i.posthog.com' },
    { key: 'phx_a_personal_key_not_a_project_key_000000', host: 'https://eu.i.posthog.com' },
    { key: KEY, host: '' }, { key: KEY, host: 'https://collect.example.com' }, { key: KEY, host: 'http://eu.i.posthog.com' },
  ] as Array<PostHogSetting | null | undefined>) {
    const lib = library();
    assert.equal(await startIfAllowed(none, person, lib.load), null);
    assert.equal(lib.loaded(), 0, 'the library was fetched with no key');
    assert.deepEqual(lib.calls, []);
  }
});

test('an automated browser never loads it, key or not', async () => {
  const lib = library();
  assert.equal(allowed(setting, { ...person, robot: true }), false);
  assert.equal(await startIfAllowed(setting, { ...person, robot: true }, lib.load), null);
  assert.equal(lib.loaded(), 0);
});

test('with a key it starts once, with every privacy rule set', async () => {
  const lib = library();
  const started = await startIfAllowed(setting, person, lib.load);
  assert.ok(started);
  assert.equal(lib.loaded(), 1);
  assert.equal(lib.calls.length, 1);
  const [what, key, options] = lib.calls[0] as [string, string, Record<string, unknown>];
  assert.equal(what, 'init');
  assert.equal(key, KEY);
  assert.equal(options.api_host, 'https://eu.i.posthog.com');
  // No session recording, and no way for an external script (the recorder) to arrive.
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.disable_external_dependency_loading, true);
  // No cookies, nothing stored; the id is our own.
  assert.equal(options.persistence, 'memory');
  assert.deepEqual(options.bootstrap, { distinctID: person.visitor });
  // Nobody identified; what the page says is masked; addresses are scrubbed.
  assert.equal(options.person_profiles, 'identified_only');
  assert.equal('identify' in options, false);
  assert.equal(options.mask_all_text, true);
  assert.equal(options.mask_all_element_attributes, true);
  assert.equal(options.before_send, scrubEvent);
  // What Raz asked for stays on.
  assert.equal(options.autocapture, true);
  assert.equal(options.capture_heatmaps, true);
  assert.equal(options.capture_pageleave, true);
  // Nothing else of PostHog's.
  assert.equal(options.advanced_disable_flags, true);
  assert.equal(options.disable_surveys, true);
});

test('session recording cannot be turned on by a setting', () => {
  for (const host of ['https://eu.i.posthog.com', 'https://us.i.posthog.com']) {
    const options = initOptions({ key: KEY, host }, person);
    assert.equal(options.disable_session_recording, true);
    assert.equal(options.disable_external_dependency_loading, true);
  }
});

test('an address keeps where the visitor came from and loses every secret', () => {
  assert.equal(scrubUrl('https://heromaker.app/'), 'https://heromaker.app/');
  assert.equal(scrubUrl('https://heromaker.app/?via=fair-telaviv-nov'), 'https://heromaker.app/?via=fair-telaviv-nov');
  assert.equal(scrubUrl('https://heromaker.app/?utm_source=instagram&utm_campaign=launch&fbclid=AbC123'),
    'https://heromaker.app/?utm_source=instagram&utm_campaign=launch');
  // A hero's page is public by its id; a claim link's token, a class's PIN and a reset token are not.
  assert.equal(scrubUrl('https://heromaker.app/hero/3f2b8c1e-9a44-4d1f-8e2a-5b6c7d8e9f00'),
    'https://heromaker.app/hero/3f2b8c1e-9a44-4d1f-8e2a-5b6c7d8e9f00');
  assert.equal(scrubUrl('https://heromaker.app/claim/eyJndWVzdCI6IjEyMyJ9.sig'), 'https://heromaker.app/claim/:token');
  assert.equal(scrubUrl('https://heromaker.app/join/482913'), 'https://heromaker.app/join/:pin');
  assert.equal(scrubUrl('https://heromaker.app/reset-password?token=abc.def.ghi'), 'https://heromaker.app/reset-password');
  assert.equal(scrubUrl('https://heromaker.app/?purchase=done&email=maya%40example.com#top'), 'https://heromaker.app/');
  assert.equal(scrubUrl('/claim/secret-token?via=class-1'), '/claim/:token?via=class-1');
  assert.equal(scrubUrl(''), '');
});

test('every address in an event is scrubbed before it is sent', () => {
  const event = scrubEvent({
    properties: {
      $current_url: 'https://heromaker.app/claim/secret-token?x=1',
      $referrer: 'https://heromaker.app/reset-password?token=abc',
      $pathname: '/join/482913',
      $prev_pageview_pathname: '/claim/secret-token',
      screen: 'claim',
      seconds: 12,
    },
  });
  assert.deepEqual(event.properties, {
    $current_url: 'https://heromaker.app/claim/:token',
    $referrer: 'https://heromaker.app/reset-password',
    $pathname: '/join/:pin',
    $prev_pageview_pathname: '/claim/:token',
    screen: 'claim',
    seconds: 12,
  });
  assert.equal(scrubEvent(null), null);
});
