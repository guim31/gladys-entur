// -----------------------------------------------------------------------------
// From the recorded estimated calls to departures: minutes, delays, filters,
// traffic messages in the user's language.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilters,
  clockTime,
  parseCalls,
  pickText,
  running,
  situationsOf,
} from '../src/departures.js';
import { FIXTURE_TIME, JERNBANETORGET, OSLO_S, recordedStops } from './helpers/world.js';

const stops = recordedStops();
const oslo = () => parseCalls(stops[OSLO_S].estimatedCalls, FIXTURE_TIME, 'fr');

test('the recorded Oslo S calls: minutes, delay, platform, real time', () => {
  const departures = oslo();
  assert.equal(departures.length, 20);
  const [first, second] = departures;
  // L1 to Spikkestad, aimed 07:41, expected 07:45:39: 4 min late, leaving now.
  assert.deepEqual(
    {
      line: first.line,
      mode: first.mode,
      destination: first.destination,
      platform: first.platform,
      minutes: first.minutes,
      delay: first.delay,
      realtime: first.realtime,
      cancelled: first.cancelled,
    },
    {
      line: 'L1',
      mode: 'rail',
      destination: 'Spikkestad',
      platform: '7',
      minutes: 0,
      delay: 5,
      realtime: true,
      cancelled: false,
    },
  );
  assert.equal(clockTime(first.aimed), '07:41');
  assert.equal(clockTime(first.expected), '07:45');
  assert.equal(second.line, 'R13');
  assert.equal(second.minutes, 0);
  // Soonest first.
  for (let i = 1; i < departures.length; i += 1) {
    assert.ok(departures[i].expected >= departures[i - 1].expected);
  }
  // A key per journey and day.
  assert.equal(new Set(departures.map((d) => d.key)).size, departures.length);
});

test('a departure already gone is dropped; an early one has no delay', () => {
  const calls = structuredClone(stops[OSLO_S].estimatedCalls.slice(0, 2));
  calls[1].expectedDepartureTime = '2026-10-22T07:47:00+02:00';
  calls[1].aimedDepartureTime = '2026-10-22T07:48:00+02:00';
  const later = parseCalls(calls, FIXTURE_TIME + 5 * 60000, 'en');
  assert.equal(later.length, 0);
  const now = parseCalls(calls, FIXTURE_TIME, 'en');
  assert.equal(now.find((d) => d.line === 'R13').delay, 0);
  assert.deepEqual(parseCalls([{ aimedDepartureTime: 'nope' }], FIXTURE_TIME, 'en'), []);
});

test('filters: lines (any case), direction (part, accents ignored), mode', () => {
  const departures = oslo();
  assert.deepEqual(
    [...new Set(applyFilters(departures, { lines: ['l1'] }).map((d) => d.line))],
    ['L1'],
  );
  const toSki = applyFilters(departures, { direction: 'ski' });
  assert.ok(toSki.length > 0);
  assert.ok(toSki.every((d) => d.destination.toLowerCase().includes('ski')));
  assert.equal(applyFilters(departures, { direction: 'lillestrom' }).length, 1);
  const torget = parseCalls(stops[JERNBANETORGET].estimatedCalls, FIXTURE_TIME, 'en');
  const metro = applyFilters(torget, { mode: 'metro' });
  assert.ok(metro.length > 0 && metro.every((d) => d.mode === 'metro'));
  assert.deepEqual(applyFilters(departures, {}), departures);
});

test('traffic messages: in the user language, else English, else Norwegian', () => {
  const values = [
    { value: 'Færre vogner', language: 'no' },
    { value: 'Fewer carriages', language: 'en' },
  ];
  assert.equal(pickText(values, 'fr'), 'Fewer carriages');
  assert.equal(pickText(values, 'en'), 'Fewer carriages');
  assert.equal(pickText([values[0]], 'de'), 'Færre vogner');
  assert.equal(pickText([{ value: 'Text', language: 'sv' }], 'de'), 'Text');
  assert.equal(pickText(null, 'fr'), '');
  const found = situationsOf(oslo());
  assert.equal(found.length, 5);
  assert.equal(found[0].summary, 'Fewer carriages');
  assert.equal(found[0].line, 'R13');
});

test('running departures leave the cancelled ones out', () => {
  const departures = oslo();
  departures[0].cancelled = true;
  assert.equal(running(departures).length, 19);
  assert.equal(running(departures)[0].line, 'R13');
});
