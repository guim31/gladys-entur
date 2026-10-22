// -----------------------------------------------------------------------------
// The Entur client against a fake fetch: headers, the batched departures
// query, the stop search, and how each failure is reported.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_NAME,
  DEPARTURES_FILTERED,
  DEPARTURES_UNFILTERED,
  Entur,
  EnturError,
  GEOCODER_URL,
  JOURNEY_PLANNER_URL,
  parseStopPlaceId,
} from '../src/entur.js';
import { JERNBANETORGET, OSLO_S, createFetch } from './helpers/world.js';

test('stop place ids: the number alone, any case, nothing else', () => {
  assert.equal(parseStopPlaceId('337'), OSLO_S);
  assert.equal(parseStopPlaceId(' nsr:stopplace:337 '), OSLO_S);
  assert.equal(parseStopPlaceId('NSR:Quay:7203'), null);
  assert.equal(parseStopPlaceId('Oslo S'), null);
  assert.equal(parseStopPlaceId('337") { x } #'), null);
});

test('every request names the client (ET-Client-Name)', async () => {
  const network = createFetch();
  const entur = new Entur({ fetch: network.fetch });
  await entur.searchStops('Oslo S');
  await entur.stopPlace(OSLO_S);
  await entur.departures([{ id: OSLO_S, filtered: false }]);
  assert.equal(network.calls.length, 3);
  for (const call of network.calls) {
    assert.equal(call.headers['ET-Client-Name'], CLIENT_NAME);
  }
  assert.equal(CLIENT_NAME, 'guim31-gladys');
});

test('one request reads every stop, more departures when filtered', async () => {
  const network = createFetch();
  const entur = new Entur({ fetch: network.fetch });
  const result = await entur.departures([
    { id: OSLO_S, filtered: false },
    { id: JERNBANETORGET, filtered: true },
    { id: OSLO_S, filtered: false },
    { id: 'NSR:StopPlace:999999999', filtered: false },
    { id: 'not an id', filtered: false },
  ]);
  assert.equal(network.calls.length, 1);
  assert.equal(network.calls[0].url, JOURNEY_PLANNER_URL);
  const query = network.calls[0].body.query;
  assert.equal((query.match(/stopPlace\(/g) ?? []).length, 3);
  assert.match(query, new RegExp(`numberOfDepartures: ${DEPARTURES_UNFILTERED}`));
  assert.match(query, new RegExp(`numberOfDepartures: ${DEPARTURES_FILTERED}`));
  assert.match(query, /includeCancelledTrips: true/);
  assert.equal(result.get(OSLO_S).name, 'Oslo S');
  assert.equal(result.get(OSLO_S).calls.length, 20);
  assert.equal(result.get(JERNBANETORGET).calls.length, 60);
  assert.equal(result.get('NSR:StopPlace:999999999'), null);
  assert.equal(result.has('not an id'), false);
  assert.deepEqual(await entur.departures([]), new Map());
});

test('a stop place with its lines; an unknown one is null', async () => {
  const entur = new Entur({ fetch: createFetch().fetch });
  const oslo = await entur.stopPlace(OSLO_S);
  assert.equal(oslo.name, 'Oslo S');
  assert.deepEqual(oslo.modes, ['rail']);
  assert.ok(oslo.lines.some((line) => line.code === 'L1' && line.mode === 'rail'));
  assert.equal(new Set(oslo.lines.map((line) => line.code)).size, oslo.lines.length);
  const torget = await entur.stopPlace(JERNBANETORGET);
  assert.deepEqual([...torget.modes].sort(), ['bus', 'metro', 'tram']);
  assert.equal(await entur.stopPlace('NSR:StopPlace:999999999'), null);
});

test('the search keeps stop places only', async () => {
  const network = createFetch();
  const entur = new Entur({ fetch: network.fetch });
  const found = await entur.searchStops('Oslo S');
  assert.deepEqual(found[0], { id: 'NSR:StopPlace:59872', name: 'Oslo S', label: 'Oslo S, Oslo' });
  const url = new URL(network.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, GEOCODER_URL);
  assert.equal(url.searchParams.get('layers'), 'venue');
  assert.deepEqual(await entur.searchStops('Zzyzx'), []);
});

test('failures: HTTP status, network, GraphQL error, invalid JSON', async () => {
  const network = createFetch();
  const entur = new Entur({ fetch: network.fetch });
  network.fail = 429;
  await assert.rejects(entur.stopPlace(OSLO_S), new EnturError('api.entur.io: HTTP 429'));
  network.fail = new Error('getaddrinfo EAI_AGAIN api.entur.io');
  await assert.rejects(entur.searchStops('Oslo'), /api\.entur\.io: getaddrinfo EAI_AGAIN/);
  const graphqlError = new Entur({
    fetch: async () =>
      Response.json({ errors: [{ message: "Validation error: Field 'nope' is undefined" }] }),
  });
  await assert.rejects(graphqlError.stopPlace(OSLO_S), /Entur: Validation error/);
  const html = new Entur({ fetch: async () => new Response('<html>') });
  await assert.rejects(html.stopPlace(OSLO_S), /invalid JSON/);
});
