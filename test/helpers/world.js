// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake `fetch` answering like
// Entur from the real responses of test/fixtures/entur (captured on
// 2026-10-22 at 07:45 in Oslo), a manual clock, a temporary /data, and the
// integration wired on top through registerHandlers. Nothing touches the
// network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { GEOCODER_URL, JOURNEY_PLANNER_URL } from '../../src/entur.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Oslo';

export const fixtureJson = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/entur/${name}`, import.meta.url), 'utf8'));

// 2026-10-22 07:45:32 in Oslo: when departures.json was captured.
export const FIXTURE_TIME = Date.parse('2026-10-22T05:45:32.254Z');

export const OSLO_S = 'NSR:StopPlace:337'; // trains only
export const JERNBANETORGET = 'NSR:StopPlace:58366'; // metro, tram, bus

/** The recorded calls of each stop place, a deep copy the test may change. */
export function recordedStops() {
  const data = fixtureJson('departures.json').data;
  return { [OSLO_S]: data.s0, [JERNBANETORGET]: data.s1 };
}

const GEOCODER = {
  'oslo s': 'geocoder-oslo-s.json',
  jernbanetorget: 'geocoder-jernbanetorget.json',
  oslo: 'geocoder-oslo-s.json',
};

/**
 * A fake `fetch` answering like Entur. `stops` holds the stop places served
 * by the departures query (change their calls to stage a delay, a
 * cancellation, a disruption); `fail` makes every request fail with an Error
 * or an HTTP status. Every call is recorded in `calls`.
 */
export function createFetch() {
  const network = { stops: recordedStops(), calls: [], fail: null };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  network.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    network.calls.push({ url, headers: init.headers ?? {}, body });
    if (network.fail instanceof Error) {
      throw network.fail;
    }
    if (typeof network.fail === 'number') {
      return new Response('error', { status: network.fail });
    }
    if (url.startsWith(GEOCODER_URL)) {
      const text = new URL(url).searchParams.get('text').toLowerCase();
      return json(fixtureJson(GEOCODER[text] ?? 'geocoder-none.json'));
    }
    if (url === JOURNEY_PLANNER_URL) {
      if (body.variables?.id) {
        const file = {
          [OSLO_S]: 'stopplace-337.json',
          [JERNBANETORGET]: 'stopplace-58366.json',
        }[body.variables.id];
        return json(fixtureJson(file ?? 'stopplace-unknown.json'));
      }
      const data = {};
      for (const [, alias, id] of body.query.matchAll(/(s\d+): stopPlace\(id: "([^"]+)"\)/g)) {
        data[alias] = structuredClone(network.stops[id] ?? null);
      }
      return json({ data });
    }
    return new Response('not found', { status: 404 });
  };
  network.departureRequests = () =>
    network.calls.filter((call) => call.body?.query?.includes('estimatedCalls'));
  return network;
}

/** A manual clock. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.network] from createFetch
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/watch.json before the start
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 */
export async function createWorld({
  config = {},
  network = createFetch(),
  devices = [],
  saved,
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-entur-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const app = registerHandlers(gladys, {
    store,
    fetch: network.fetch,
    timers,
    now: clock.now,
    dataDir,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    service: app.service,
    network,
    clock,
    store,
    dataDir,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return world;
}

/** Run a configuration action; resolves with its message (multi-language). */
export async function action(world, key, fields = {}) {
  const ack = await world.fake.action(key, fields);
  if (!ack.success) {
    throw new Error(`action ${key} failed: ${ack.error}`);
  }
  return ack.data.message;
}

/** The discovered device whose name contains `name`. */
export function discovered(world, name) {
  const device = world.fake.discoveredDevices.find((d) => d.name.includes(name));
  if (!device) {
    throw new Error(`no discovered device named ${name}`);
  }
  return device;
}

/** "Add to Gladys" on the discovered device named `name`; resolves with it. */
export async function create(world, name) {
  const device = discovered(world, name);
  await world.fake.deviceCreated(device);
  return device;
}

/** The last state published on a feature of a device. */
export const lastState = (world, device, key) =>
  world.fake.lastState(`${device.external_id}:${key}`);

/** Captures the log lines of the integration at `level` and above. */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
