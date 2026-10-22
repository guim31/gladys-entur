// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the real Entur
// answers: configuration actions, discovered devices, states, scene triggers,
// widget, scene action, persistence, failures, logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NO_DEPARTURE_MINUTES } from '../src/devices.js';
import { MAX_WATCHES, TRIGGERS } from '../src/service.js';
import {
  JERNBANETORGET,
  OSLO_S,
  action,
  captureLogs,
  create,
  createFetch,
  createWorld,
  discovered,
  lastState,
} from './helpers/world.js';
import { stageEverything } from './helpers/scenario.js';

const fr = (message) => message.fr;

test('nothing watched: no request at all, the status says so', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.service.refresh();
  assert.equal(world.network.calls.length, 0);
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.match(fr(await action(world, 'status')), /Aucun arrêt suivi/);
});

test('search: by name, by identifier, nothing found, Entur down', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const byName = await action(world, 'search_stops', { query: 'Jernbanetorget' });
  assert.match(fr(byName), /1 arrêt\(s\) trouvé\(s\)/);
  assert.match(fr(byName), /• Jernbanetorget, Oslo \[NSR:StopPlace:58366\]/);
  assert.match(byName.de, /Haltestelle hinzufügen/);
  const byId = await action(world, 'search_stops', { query: '337' });
  assert.match(fr(byId), /• Oslo S \[NSR:StopPlace:337\]/);
  assert.equal(
    fr(await action(world, 'search_stops', { query: 'Zzyzx' })),
    'Aucun arrêt ne correspond à « Zzyzx ».',
  );
  assert.match(fr(await action(world, 'search_stops', { query: ' ' })), /Saisissez/);
  world.network.fail = 503;
  assert.equal(
    fr(await action(world, 'search_stops', { query: 'Oslo' })),
    'Entur est injoignable (api.entur.io: HTTP 503). Réessayez dans un instant.',
  );
});

test('add a stop: homonyms, unknown line or mode, filters in the name, duplicates', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ambiguous = await action(world, 'add_stop', { stop: 'Oslo' });
  assert.match(fr(ambiguous), /Plusieurs arrêts correspondent/);
  assert.match(fr(ambiguous), /Oslo lufthavn, Ullensaker \[NSR:StopPlace:58211\]/);
  assert.match(
    fr(await action(world, 'add_stop', { stop: '999999999' })),
    /aucun arrêt « 999999999 »/,
  );
  const wrongLine = await action(world, 'add_stop', { stop: OSLO_S, lines: 'L1, 31' });
  assert.match(fr(wrongLine), /Ligne\(s\) absente\(s\) de cet arrêt : 31\. Lignes desservies : /);
  const wrongMode = await action(world, 'add_stop', { stop: OSLO_S, mode: 'tram' });
  assert.equal(fr(wrongMode), 'Aucun Tram à cet arrêt. Modes desservis : Train.');
  assert.deepEqual(world.fake.discoveredDevices, []);

  const added = await action(world, 'add_stop', {
    stop: 'nsr:stopplace:337',
    lines: 'l1 l2',
    direction: 'Ski',
  });
  assert.equal(
    fr(added),
    "Oslo S (L1, L2 · → Ski) ajouté.\nOuvrez l'onglet Découverte pour créer son appareil.",
  );
  const byName = await action(world, 'add_stop', { stop: 'jernbanetorget', mode: 'metro' });
  assert.match(fr(byName), /^Jernbanetorget \(Métro\) ajouté/);
  assert.match(
    fr(await action(world, 'add_stop', { stop: '58366', mode: 'metro' })),
    /déjà suivi avec ces filtres/,
  );
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Entur · Oslo S (L1, L2 · → Ski)', 'ext:test-integration:stop:337-l1-l2-to-ski'],
      ['Entur · Jernbanetorget (Métro)', 'ext:test-integration:stop:58366-metro'],
    ],
  );
  assert.deepEqual(
    devices[0].features.map((f) => f.name),
    ['Prochain départ', 'Départ suivant', 'Retard', 'Ligne et destination', 'Perturbation'],
  );
  // Kept in /data.
  const saved = JSON.parse(await readFile(join(world.dataDir, 'watch.json'), 'utf8'));
  assert.equal(saved.watches.length, 2);
  // Nothing is read before a device is created.
  await world.service.refresh();
  assert.equal(world.network.departureRequests().length, 0);
});

test('at most MAX_WATCHES stops', async (t) => {
  const watches = Array.from({ length: MAX_WATCHES }, (_, i) => ({
    id: OSLO_S,
    name: 'Oslo S',
    lines: [],
    direction: `D${i}`,
    mode: '',
  }));
  const world = await createWorld({ saved: { watches } });
  t.after(() => world.app.stop());
  assert.match(fr(await action(world, 'add_stop', { stop: '58366' })), /déjà 20 arrêts/);
});

test('a created device gets its states at once, and the widget a refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await action(world, 'add_stop', { stop: JERNBANETORGET, lines: '30' });
  const oslo = await create(world, 'Oslo S');
  assert.equal(lastState(world, oslo, 'next'), 0);
  assert.equal(lastState(world, oslo, 'following'), 0);
  assert.equal(lastState(world, oslo, 'delay'), 5);
  assert.equal(lastState(world, oslo, 'line'), 'L1 → Spikkestad');
  assert.equal(lastState(world, oslo, 'disruption'), 1);
  assert.ok(world.fake.widgetRefreshes.includes('departures'));
  // Only the created device is read.
  assert.equal(world.network.departureRequests().length, 1);
  assert.equal(
    (world.network.departureRequests()[0].body.query.match(/stopPlace\(/g) ?? []).length,
    1,
  );

  const torget = await create(world, 'Jernbanetorget');
  assert.equal(lastState(world, torget, 'line'), '30 → Bygdøy via Bygdøynes');
  assert.equal(lastState(world, torget, 'next'), 0);
  assert.equal(lastState(world, torget, 'delay'), 2);
  assert.equal(lastState(world, torget, 'disruption'), 0);
  // Then both at once, in a single request.
  const before = world.network.departureRequests().length;
  await world.service.refresh();
  assert.equal(world.network.departureRequests().length, before + 1);
  assert.equal(
    (
      world.network
        .departureRequests()
        .at(-1)
        .body.query.match(/stopPlace\(/g) ?? []
    ).length,
    2,
  );
});

test('nothing in the next 24 hours: countdowns at their maximum', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.network.stops[OSLO_S].estimatedCalls = [];
  await action(world, 'add_stop', { stop: OSLO_S });
  const oslo = await create(world, 'Oslo S');
  assert.equal(lastState(world, oslo, 'next'), NO_DEPARTURE_MINUTES);
  assert.equal(lastState(world, oslo, 'following'), NO_DEPARTURE_MINUTES);
  assert.equal(lastState(world, oslo, 'delay'), 0);
  assert.equal(lastState(world, oslo, 'line'), 'Aucun départ dans les 24 heures');
  assert.equal(lastState(world, oslo, 'disruption'), 0);
});

test('a cancelled departure is skipped by the countdowns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.network.stops[OSLO_S].estimatedCalls[0].cancellation = true;
  await action(world, 'add_stop', { stop: OSLO_S });
  const oslo = await create(world, 'Oslo S');
  assert.equal(lastState(world, oslo, 'line'), 'R13 → Dal');
});

test('triggers: silent first read, then once per journey and threshold', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { device, events } = await stageEverything(world);
  const of = (key) => events.filter((event) => event.key === key);

  const [cancelled] = of(TRIGGERS.CANCELLED);
  assert.equal(of(TRIGGERS.CANCELLED).length, 1);
  assert.deepEqual(cancelled.data, {
    stop: device.external_id,
    stop_name: 'Oslo S',
    line: 'R21',
    mode: 'rail',
    destination: 'Moss',
    platform: '13',
    scheduled_time: '07:52',
    expected_time: '07:52',
    minutes: 3,
    delay_minutes: 0,
  });

  // R22, 12 minutes late: thresholds 1, 2, 3, 5 and 10 reached at once.
  const delayed = of(TRIGGERS.DELAYED).filter((event) => event.data.line === 'R22');
  assert.deepEqual(
    delayed.map((event) => event.data.threshold),
    ['1', '2', '3', '5', '10'],
  );
  assert.equal(delayed[0].data.expected_time, '08:12');
  // The delays already there at the first read are not news.
  assert.equal(of(TRIGGERS.DELAYED).filter((event) => event.data.line !== 'R22').length, 0);

  const [disruption] = of(TRIGGERS.DISRUPTION);
  assert.equal(of(TRIGGERS.DISRUPTION).length, 1);
  assert.deepEqual(disruption.data, {
    stop: device.external_id,
    stop_name: 'Oslo S',
    line: 'L1',
    summary: 'Signal failure',
    description: 'Signalfeil på Lillestrøm. Forsinkelser må påregnes.',
  });

  // R13 to Drammen: 5 min at the first read, 1 min three minutes later.
  const drammen = of(TRIGGERS.SOON).filter((event) => event.data.destination === 'Drammen');
  assert.deepEqual(
    drammen.map((event) => event.data.threshold),
    ['1', '2', '3'],
  );
  assert.equal(drammen[0].data.minutes, 1);
  // A cancelled train never says "time to leave".
  assert.equal(of(TRIGGERS.SOON).filter((event) => event.data.line === 'R21').length, 0);

  // Nothing again on the next read.
  const count = world.fake.sceneEvents.length;
  await world.service.refresh();
  assert.equal(world.fake.sceneEvents.length, count);
});

test('a restart does not announce the same cancellation or message again', async (t) => {
  const world = await createWorld();
  await stageEverything(world);
  await world.app.stop();
  const network = createFetch();
  network.stops = world.network.stops;
  const again = await createWorld({
    network,
    dataDir: world.dataDir,
    devices: world.fake.devices,
    clock: world.clock,
  });
  t.after(() => again.app.stop());
  world.clock.advance(60000);
  await again.service.refresh();
  const keys = again.fake.sceneEvents.map((event) => event.key);
  assert.ok(!keys.includes(TRIGGERS.CANCELLED));
  assert.ok(!keys.includes(TRIGGERS.DISRUPTION));
});

test('the container reads the departures on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const world = await createWorld({ timers: true, config: { refresh_interval: '30' } });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await create(world, 'Oslo S');
  const before = world.network.departureRequests().length;
  t.mock.timers.tick(30000);
  await world.service.inflight;
  t.mock.timers.tick(30000);
  await world.service.inflight;
  assert.equal(world.network.departureRequests().length, before + 2);
  // A poll right after a read does not read again.
  await world.fake.poll(discovered(world, 'Oslo S'));
  assert.equal(world.network.departureRequests().length, before + 2);
});

test('Entur down: one warning and the connection status, then back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await create(world, 'Oslo S');
  const logs = captureLogs(t);
  world.network.fail = new Error('connect ETIMEDOUT');
  await world.service.refresh();
  await world.service.refresh();
  assert.equal(logs.filter((line) => line.level === 'warn').length, 1);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Entur est injoignable/);
  assert.match(
    fr(await action(world, 'status')),
    /Dernière erreur : api\.entur\.io: connect ETIMEDOUT/,
  );
  world.network.fail = null;
  await world.service.refresh();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.ok(logs.some((line) => line.level === 'info' && /Entur reachable again/.test(line.text)));
});

test('a normal read writes nothing at info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await create(world, 'Oslo S');
  const logs = captureLogs(t);
  world.clock.advance(60000);
  await world.service.refresh();
  assert.deepEqual(logs, []);
});

test('/data lost: the stops come back from the Gladys devices', async (t) => {
  const first = await createWorld();
  await action(first, 'add_stop', { stop: JERNBANETORGET, lines: '30, 31', direction: 'Bygdøy' });
  await create(first, 'Jernbanetorget');
  await first.app.stop();
  const world = await createWorld({ devices: first.fake.devices });
  t.after(() => world.app.stop());
  assert.equal(world.service.watches.length, 1);
  assert.deepEqual(world.service.watches[0], {
    id: JERNBANETORGET,
    name: 'Jernbanetorget',
    lines: ['30', '31'],
    direction: 'Bygdøy',
    mode: '',
  });
  assert.equal(world.fake.discoveredDevices[0].external_id, first.fake.devices[0].external_id);
  assert.equal(world.network.departureRequests().length, 1);
});

test('remove a stop by its name or identifier', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await action(world, 'add_stop', { stop: OSLO_S, lines: 'L1' });
  assert.match(
    fr(await action(world, 'remove_stop', { name: 'Oslo S' })),
    /^Oslo S n'est plus suivi/,
  );
  assert.match(
    fr(await action(world, 'remove_stop', { name: 'oslo s (l1)' })),
    /^Oslo S \(L1\) n'est plus/,
  );
  assert.match(
    fr(await action(world, 'remove_stop', { name: 'Oslo S' })),
    /Aucun arrêt suivi ne correspond/,
  );
  assert.deepEqual(world.fake.discoveredDevices, []);
});

test('the status lists the stops and their devices', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  await action(world, 'add_stop', { stop: JERNBANETORGET });
  await create(world, 'Oslo S');
  world.clock.advance(12000);
  const status = fr(await action(world, 'status'));
  assert.match(status, /Arrêts suivis : 2/);
  assert.match(status, /• Oslo S \[NSR:StopPlace:337\] — appareil créé/);
  assert.match(status, /• Jernbanetorget \[NSR:StopPlace:58366\] — appareil pas encore créé/);
  assert.match(status, /il y a 12 s/);
});

test('the widget: board, cancelled and late rows, traffic caption', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { device } = await stageEverything(world);
  const ack = await world.fake.widgetGet('departures', {
    settings: { stop: device.external_id },
    language: 'en',
  });
  const [heading, caption, status] = ack.data.content.components;
  assert.equal(heading.text, 'Oslo S');
  assert.equal(caption.text, '⚠ Signal failure · Fewer carriages');
  assert.equal(status.items.length, 8);
  assert.deepEqual(status.items[1], {
    label: 'R21 → Moss',
    value: '07:52 · Cancelled',
    color: 'danger',
  });
  assert.deepEqual(status.items[3], {
    label: 'FLY2 → Oslo Lufthavn',
    value: '07:56 · 8 min · +7',
    color: 'warning',
  });
  const none = await world.fake.widgetGet('departures', { settings: {}, language: 'de' });
  assert.equal(
    none.data.content.components[0].text,
    'Wähle eine Haltestelle in den Widget-Einstellungen.',
  );
  const gone = await world.fake.widgetGet('departures', {
    settings: { stop: 'ext:x' },
    language: 'es',
  });
  assert.equal(gone.data.content.components[0].text, 'Esta parada ya no se sigue.');
});

test('the scene action: sentence, line filter, nothing found, unknown stop', async (t) => {
  const world = await createWorld({ config: { language: 'en' } });
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S });
  const device = await create(world, 'Oslo S');
  const all = await world.fake.sceneAction('get_next_departures', { stop: device.external_id });
  assert.equal(
    all.data.outputs.sentence,
    'Train L1 to Spikkestad at Oslo S: now (5 min late). Train R13 to Dal at Oslo S: now (2 min late). Train L2 to Stabekk at Oslo S: in 1 min',
  );
  const l2 = await world.fake.sceneAction('get_next_departures', {
    stop: device.external_id,
    line: 'l2',
  });
  assert.equal(l2.data.outputs.line, 'L2');
  assert.equal(l2.data.outputs.destination, 'Stabekk');
  assert.equal(l2.data.outputs.minutes, 1);
  assert.equal(l2.data.outputs.platform, '8');
  const none = await world.fake.sceneAction('get_next_departures', {
    stop: device.external_id,
    line: 'X9',
  });
  assert.equal(none.data.outputs.minutes, NO_DEPARTURE_MINUTES);
  assert.equal(none.data.outputs.sentence, 'No departure from Oslo S in the next 24 hours.');
  const unknown = await world.fake.sceneAction('get_next_departures', { stop: 'ext:x' });
  assert.equal(unknown.success, false);
});

test('a language change renames the devices, not their features', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_stop', { stop: OSLO_S, mode: 'rail' });
  await world.fake.configUpdated({ language: 'de' });
  assert.equal(world.fake.discoveredDevices[0].name, 'Entur · Oslo S (Zug)');
});
