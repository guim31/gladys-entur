// -----------------------------------------------------------------------------
// The Entur service: the watched stops (configuration actions, /data), their
// devices, the refresh timer (one GraphQL request for every created device),
// the states and the scene triggers.
//
// Triggers fire once per journey (and per threshold), never at the first read
// of a stop: what was already there when the integration started is not news.
// Cancellations and traffic messages already announced are kept in /data, so a
// restart does not announce them again; the "leave now" and delay thresholds
// are kept in memory only (a journey lives an hour or two, and /data is often
// an SD card).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { applyFilters, clockTime, fold, parseCalls, situationsOf } from './departures.js';
import { buildStopDevice, clip, stopStates, watchKey, watchName, STOP_TYPE } from './devices.js';
import { Entur, parseStopPlaceId } from './entur.js';
import { TEXT, modeName, say, sayAll } from './messages.js';

const logger = createLogger({ name: 'entur' });

export const TRIGGERS = {
  SOON: 'departure_soon',
  DELAYED: 'departure_delayed',
  CANCELLED: 'departure_cancelled',
  DISRUPTION: 'new_disruption',
};
// Options of the threshold filters of the triggers (manifest `scene_triggers`).
// Few values: every one reached is an event, and the core takes 300 a minute.
export const SOON_MINUTES = [1, 2, 3, 5, 7, 10, 12, 15, 20];
export const DELAY_MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 60];
export const TRAIN_MODES = ['rail', 'metro', 'tram', 'bus', 'coach', 'water'];

export const MAX_WATCHES = 20;
const SEARCH_RESULTS = 8;
// A value that does not change is published again this often, so that Gladys
// does not show it as stale ("no recent value" after 48 h).
const HEARTBEAT_MS = 6 * 3600 * 1000;
// Announced cancellations and messages are forgotten two days after they were
// last seen; their "last seen" is written at most hourly.
const MEMORY_MS = 48 * 3600 * 1000;
const SEEN_WRITE_MS = 3600 * 1000;

export class SceneError extends Error {}

/** "L1, l2 ; R13" → ["L1", "L2", "R13"]. */
export function parseLines(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\s,;]+/)
        .map((line) => line.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export class EnturService {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the fake one)
   * @param {object} options.store Store (src/store.js)
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {boolean} [options.timers] false in the tests: refresh by hand
   */
  constructor({ gladys, store, fetch, now = Date.now, timers = true }) {
    this.gladys = gladys;
    this.store = store;
    this.entur = new Entur({ fetch });
    this.now = now;
    this.timers = timers;
    this.config = { language: 'fr', refreshSeconds: 60 };
    this.watches = [];
    this.memory = { announced: {}, checked: [] };
    // watchKey → { departures, at }
    this.boards = new Map();
    // watchKey → Map(journey key → Set of thresholds handled), in memory only.
    this.soonDone = new Map();
    this.delayDone = new Map();
    this.checkedNow = new Set();
    this.refreshedAt = 0;
    this.lastError = null;
    this.inflight = null;
    this.timer = null;
  }

  // --- Lifecycle ---------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    this.watches = Array.isArray(saved.watches) ? saved.watches.filter((w) => w?.id) : [];
    this.memory = {
      announced: saved.announced && typeof saved.announced === 'object' ? saved.announced : {},
      checked: Array.isArray(saved.checked) ? saved.checked : [],
    };
    await this.restoreFromDevices();
    await this.publishDiscovered();
    await this.gladys.setConnectionStatus(true).catch(() => {});
    this.startTimer();
    await this.refresh();
  }

  async resync(config) {
    this.config = config;
    await this.publishDiscovered();
    await this.refresh({ republish: true });
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous.refreshSeconds !== config.refreshSeconds) {
      this.startTimer();
    }
    if (previous.language !== config.language) {
      // The device names follow the language; the feature names stay as they
      // were created (frozen by the core).
      await this.publishDiscovered();
      await this.refresh({ republish: true });
    }
  }

  startTimer() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.timers) {
      this.timer = setInterval(() => {
        this.refresh().catch((err) => logger.error('Refresh failed', err));
      }, this.config.refreshSeconds * 1000);
      this.timer.unref?.();
    }
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await this.inflight?.catch(() => {});
    await this.store.flush();
  }

  save() {
    return this.store.save({
      watches: this.watches,
      announced: this.memory.announced,
      checked: this.memory.checked,
    });
  }

  // --- Devices ----------------------------------------------------------------

  deviceId(watch) {
    return this.gladys.externalIds(STOP_TYPE, watchKey(watch)).device;
  }

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  watchOfDevice(externalId) {
    return this.watches.find((watch) => this.deviceId(watch) === externalId) ?? null;
  }

  createdWatches() {
    return this.watches.filter((watch) => this.isCreated(this.deviceId(watch)));
  }

  /** The watches of the devices created in Gladys but missing from /data. */
  async restoreFromDevices() {
    let devices;
    try {
      devices = await this.gladys.getDevices();
    } catch (err) {
      logger.warn(`Cannot read the devices of the integration: ${err.message}`);
      return;
    }
    const param = (device, name) => device.params?.find((p) => p.name === name)?.value ?? '';
    let changed = false;
    for (const device of devices ?? []) {
      const id = param(device, 'stop_id');
      if (!id) {
        continue;
      }
      const watch = {
        id,
        name: param(device, 'stop_name') || id,
        lines: parseLines(param(device, 'lines')),
        direction: param(device, 'direction'),
        mode: param(device, 'mode'),
      };
      if (!this.watches.some((known) => watchKey(known) === watchKey(watch))) {
        this.watches.push(watch);
        changed = true;
      }
    }
    if (changed) {
      logger.info(`${this.watches.length} stop(s) restored from the Gladys devices`);
      await this.save();
    }
  }

  async publishDiscovered() {
    try {
      await this.gladys.publishDiscoveredDevices(
        this.watches.map((watch) => buildStopDevice(this.gladys, watch, this.config.language)),
      );
    } catch (err) {
      logger.warn(`Cannot publish the discovered devices: ${err.message}`);
    }
  }

  async onDeviceCreated(device) {
    const watch = this.watchOfDevice(device?.external_id);
    if (!watch) {
      return;
    }
    // A state published before the device existed was dropped by the core:
    // everything again, then the widgets showing it.
    await this.refresh({ republish: true });
    this.gladys.requestWidgetRefresh?.('departures');
  }

  // --- Refresh ----------------------------------------------------------------

  /** Polling fallback: Gladys does not poll these devices, but if it did. */
  async poll() {
    if (this.now() - this.refreshedAt >= (this.config.refreshSeconds * 1000) / 2) {
      await this.refresh();
    }
  }

  refresh(options = {}) {
    if (this.inflight) {
      return this.inflight.then(() => (options.republish ? this.publishAll() : undefined));
    }
    this.inflight = this.doRefresh(options).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  async doRefresh({ republish = false } = {}) {
    const watches = this.createdWatches();
    if (watches.length === 0) {
      return;
    }
    let results;
    try {
      results = await this.entur.departures(
        watches.map((watch) => ({
          id: watch.id,
          filtered: Boolean(watch.lines?.length || watch.direction || watch.mode),
        })),
      );
    } catch (err) {
      if (!this.lastError) {
        logger.warn(`Cannot read the departures: ${err.message}`);
        await this.gladys
          .setConnectionStatus(false, sayAll(TEXT, 'serviceDown', { error: err.message }))
          .catch(() => {});
      } else {
        logger.debug(`Cannot read the departures: ${err.message}`);
      }
      this.lastError = err.message;
      return;
    }
    if (this.lastError) {
      logger.info('Entur reachable again');
      this.lastError = null;
      await this.gladys.setConnectionStatus(true).catch(() => {});
    }
    const now = this.now();
    this.refreshedAt = now;
    const events = [];
    let memoryChanged = false;
    for (const watch of watches) {
      const stop = results.get(watch.id);
      if (!stop) {
        logger.debug(`Entur knows no stop ${watch.id} any more`);
        continue;
      }
      const departures = applyFilters(parseCalls(stop.calls, now, this.config.language), watch);
      this.boards.set(watchKey(watch), { departures, at: now });
      const found = this.detect(watch, departures, now);
      events.push(...found.events);
      memoryChanged ||= found.memoryChanged;
    }
    memoryChanged = this.pruneMemory(now) || memoryChanged;
    if (memoryChanged) {
      await this.save();
    }
    await this.publishAll({ force: republish });
    for (const { key, data } of events) {
      await this.fire(key, data);
    }
  }

  async publishAll({ force = false } = {}) {
    const states = [];
    for (const watch of this.createdWatches()) {
      const board = this.boards.get(watchKey(watch));
      if (board) {
        states.push(...stopStates(this.gladys, watch, board.departures, this.config.language));
      }
    }
    if (states.length === 0) {
      return;
    }
    if (force) {
      this.gladys.forgetPublishedStates?.();
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      if (this.publishFailed) {
        this.publishFailed = false;
        logger.info('States published again');
      }
    } catch (err) {
      // Gladys restarting: said once, the next refresh sends them again.
      if (!this.publishFailed) {
        logger.warn(`Cannot publish ${states.length} state(s): ${err.message}`);
      }
      this.publishFailed = true;
    }
  }

  // --- Scene triggers ----------------------------------------------------------

  /** The scene events of a fresh read of a watch. */
  detect(watch, departures, now) {
    const key = watchKey(watch);
    const deviceId = this.deviceId(watch);
    const events = [];
    let memoryChanged = false;
    // First read in this process: what is there is not news (RAM memories).
    const firstNow = !this.checkedNow.has(key);
    this.checkedNow.add(key);
    // First read ever (persisted memories).
    const firstEver = !this.memory.checked.includes(key);
    if (firstEver) {
      this.memory.checked.push(key);
      memoryChanged = true;
    }
    const base = (departure) => ({
      stop: deviceId,
      stop_name: watch.name,
      line: departure.line,
      mode: departure.mode,
      destination: departure.destination,
      platform: departure.platform,
      scheduled_time: clockTime(departure.aimed),
      expected_time: clockTime(departure.expected),
      minutes: departure.minutes,
      delay_minutes: departure.delay,
    });

    const soon = this.soonDone.get(key) ?? new Map();
    const delays = this.delayDone.get(key) ?? new Map();
    const present = new Set();
    for (const departure of departures) {
      present.add(departure.key);
      if (departure.cancelled) {
        const memo = this.remember(`${key}|cancel|${departure.key}`, now);
        memoryChanged ||= memo.changed;
        if (memo.fresh && !firstEver) {
          events.push({ key: TRIGGERS.CANCELLED, data: base(departure) });
        }
        continue;
      }
      // Leave now: each threshold once, when the countdown reaches it. A
      // journey first seen inside a threshold does not fire it.
      let handled = soon.get(departure.key);
      if (!handled) {
        handled = new Set(SOON_MINUTES.filter((minutes) => departure.minutes <= minutes));
        soon.set(departure.key, handled);
      } else {
        for (const threshold of SOON_MINUTES) {
          if (departure.minutes <= threshold && !handled.has(threshold)) {
            handled.add(threshold);
            events.push({
              key: TRIGGERS.SOON,
              data: { ...base(departure), threshold: String(threshold) },
            });
          }
        }
      }
      // Delay: each threshold once per journey.
      const reached = delays.get(departure.key) ?? new Set();
      for (const threshold of DELAY_MINUTES) {
        if (departure.delay >= threshold && !reached.has(threshold)) {
          reached.add(threshold);
          if (!firstNow) {
            events.push({
              key: TRIGGERS.DELAYED,
              data: { ...base(departure), threshold: String(threshold) },
            });
          }
        }
      }
      delays.set(departure.key, reached);
    }
    for (const map of [soon, delays]) {
      for (const journey of map.keys()) {
        if (!present.has(journey)) {
          map.delete(journey);
        }
      }
    }
    this.soonDone.set(key, soon);
    this.delayDone.set(key, delays);

    for (const situation of situationsOf(departures)) {
      const memo = this.remember(`${key}|situation|${situation.id}`, now);
      memoryChanged ||= memo.changed;
      if (memo.fresh && !firstEver) {
        events.push({
          key: TRIGGERS.DISRUPTION,
          data: {
            stop: deviceId,
            stop_name: watch.name,
            line: situation.line,
            summary: clip(situation.summary || situation.description, 1000),
            description: clip(situation.description, 1000),
          },
        });
      }
    }
    return { events, memoryChanged };
  }

  /** Records a persisted memory key: `fresh` when new, `changed` when /data must be written. */
  remember(memoryKey, now) {
    const seen = this.memory.announced[memoryKey];
    if (seen === undefined || now - seen > SEEN_WRITE_MS) {
      this.memory.announced[memoryKey] = now;
      return { fresh: seen === undefined, changed: true };
    }
    return { fresh: false, changed: false };
  }

  pruneMemory(now) {
    let changed = false;
    for (const [memoryKey, seen] of Object.entries(this.memory.announced)) {
      if (now - seen > MEMORY_MS) {
        delete this.memory.announced[memoryKey];
        changed = true;
      }
    }
    return changed;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.fireFailed = false;
    } catch (err) {
      // A 429 or Gladys restarting: said once per streak.
      if (!this.fireFailed) {
        logger.warn(`Cannot fire the ${key} trigger: ${err.message}`);
      }
      this.fireFailed = true;
    }
  }

  // --- Readings for the widget and the scene action ----------------------------

  /**
   * The watch and departures of a device; read again when older than two
   * refresh intervals (a scene action right after the start).
   */
  async boardOf(externalId) {
    const watch = this.watchOfDevice(externalId);
    if (!watch) {
      return null;
    }
    let board = this.boards.get(watchKey(watch));
    if (
      this.isCreated(externalId) &&
      (!board || this.now() - board.at > this.config.refreshSeconds * 2000)
    ) {
      await this.refresh();
      board = this.boards.get(watchKey(watch));
    }
    return { watch, departures: board?.departures ?? null };
  }

  // --- Configuration actions -------------------------------------------------

  /** Answers an expected failure with a message in every language. */
  fail(key, params) {
    const err = new Error(key);
    err.messages = sayAll(TEXT, key, params);
    return err;
  }

  async call(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.messages) {
        throw err;
      }
      throw this.fail('serviceDown', { error: err.message });
    }
  }

  async searchStops({ query } = {}) {
    const text = String(query ?? '').trim();
    if (!text) {
      return sayAll(TEXT, 'searchNeedText');
    }
    const direct = parseStopPlaceId(text);
    const stops = direct
      ? await this.call(async () => {
          const stop = await this.entur.stopPlace(direct);
          return stop ? [{ id: stop.id, label: stop.name }] : [];
        })
      : await this.call(() => this.entur.searchStops(text, SEARCH_RESULTS));
    if (stops.length === 0) {
      return sayAll(TEXT, 'searchNone', { query: text });
    }
    const list = stops.map((stop) => `• ${stop.label} [${stop.id}]`).join('\n');
    return Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => [
        lang,
        `${say(TEXT, lang, 'searchFound', { count: stops.length })}\n${list}\n${say(TEXT, lang, 'searchHint')}`,
      ]),
    );
  }

  async addStop({ stop: query, lines: lineText, direction, mode } = {}) {
    const text = String(query ?? '').trim();
    let id = parseStopPlaceId(text);
    if (!id) {
      const found = await this.call(() => this.entur.searchStops(text, SEARCH_RESULTS));
      const exact = found.filter((stop) => fold(stop.name) === fold(text));
      const candidates = exact.length > 0 ? exact : found;
      if (candidates.length === 0) {
        throw this.fail('addUnknown', { query: text });
      }
      if (candidates.length > 1) {
        const list = candidates.map((stop) => `• ${stop.label} [${stop.id}]`).join('\n');
        const messages = sayAll(TEXT, 'addAmbiguous');
        for (const lang of Object.keys(messages)) {
          messages[lang] = `${messages[lang]}\n${list}`;
        }
        return messages;
      }
      id = candidates[0].id;
    }
    const place = await this.call(() => this.entur.stopPlace(id));
    if (!place) {
      throw this.fail('addUnknown', { query: text });
    }
    const lines = parseLines(lineText);
    const served = new Set(place.lines.map((line) => line.code.toUpperCase()));
    const missing = lines.filter((line) => !served.has(line));
    if (missing.length > 0) {
      throw this.fail('addUnknownLines', {
        lines: missing.join(', '),
        available: clip(place.lines.map((line) => line.code).join(', '), 120),
      });
    }
    const wantedMode = String(mode ?? '').trim();
    if (wantedMode && !place.modes.includes(wantedMode)) {
      const messages = Object.fromEntries(
        ['en', 'fr', 'de', 'es'].map((lang) => [
          lang,
          say(TEXT, lang, 'addUnknownMode', {
            mode: modeName(wantedMode, lang),
            available: place.modes.map((m) => modeName(m, lang)).join(', '),
          }),
        ]),
      );
      return messages;
    }
    const watch = {
      id: place.id,
      name: place.name,
      // As Entur writes them ("L1", "31E"), for the device name.
      lines: lines.map(
        (line) => place.lines.find((known) => known.code.toUpperCase() === line)?.code ?? line,
      ),
      direction: clip(String(direction ?? '').trim(), 40),
      mode: wantedMode,
    };
    const key = watchKey(watch);
    if (this.watches.some((known) => watchKey(known) === key)) {
      return sayAll(TEXT, 'alreadyWatched', { name: watchName(watch, 'en') });
    }
    if (this.watches.length >= MAX_WATCHES) {
      throw this.fail('tooMany', { max: MAX_WATCHES });
    }
    this.watches.push(watch);
    await this.save();
    await this.publishDiscovered();
    logger.info(`Stop added: ${watchName(watch, 'en')} (${place.id})`);
    return Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => [
        lang,
        say(TEXT, lang, 'added', { name: watchName(watch, lang) }),
      ]),
    );
  }

  async remove({ name } = {}) {
    const text = fold(name);
    const id = parseStopPlaceId(name);
    const matches = this.watches.filter(
      (watch) =>
        fold(watchName(watch, this.config.language)) === text ||
        fold(watchName(watch, 'en')) === text ||
        watchKey(watch) === text ||
        (id && watch.id === id),
    );
    const byName = matches.length > 0 ? matches : this.watches.filter((w) => fold(w.name) === text);
    if (byName.length === 0) {
      throw this.fail('removeUnknown', { query: String(name ?? '').trim() });
    }
    if (byName.length > 1) {
      throw this.fail('removeAmbiguous');
    }
    const [watch] = byName;
    this.watches = this.watches.filter((known) => known !== watch);
    this.boards.delete(watchKey(watch));
    await this.save();
    await this.publishDiscovered();
    logger.info(`Stop removed: ${watchName(watch, 'en')}`);
    return Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => [
        lang,
        say(TEXT, lang, 'removed', { name: watchName(watch, lang) }),
      ]),
    );
  }

  status() {
    return Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => {
        if (this.watches.length === 0) {
          return [lang, say(TEXT, lang, 'statusNone')];
        }
        const lines = [say(TEXT, lang, 'statusHeader', { count: this.watches.length })];
        for (const watch of this.watches) {
          const created = this.isCreated(this.deviceId(watch));
          lines.push(
            `• ${watchName(watch, lang)} [${watch.id}] — ${say(TEXT, lang, created ? 'statusCreated' : 'statusNotCreated')}`,
          );
        }
        lines.push(
          this.refreshedAt
            ? say(TEXT, lang, 'statusRefreshed', {
                age: Math.round((this.now() - this.refreshedAt) / 1000),
              })
            : say(TEXT, lang, 'statusNeverRefreshed'),
        );
        if (this.lastError) {
          lines.push(say(TEXT, lang, 'statusError', { error: this.lastError }));
        }
        return [lang, lines.join('\n')];
      }),
    );
  }

  /** "L1 to Spikkestad at Oslo S: in 3 and 7 min (4 min late)". */
  sentence(watch, group, language) {
    const [first, second] = group;
    let when;
    if (!second) {
      when = first.minutes === 0 ? say(TEXT, language, 'now') : say(TEXT, language, 'in', first);
    } else {
      when =
        first.minutes === 0
          ? say(TEXT, language, 'nowThen', { second: second.minutes })
          : say(TEXT, language, 'inTwo', { first: first.minutes, second: second.minutes });
    }
    const late = first.delay > 0 ? say(TEXT, language, 'delayedNote', first) : '';
    return (
      say(TEXT, language, 'sentence', {
        line: `${modeName(first.mode, language)} ${first.line}`.trim(),
        destination: first.destination,
        stop: watch.name,
        when,
      }) + late
    );
  }
}
