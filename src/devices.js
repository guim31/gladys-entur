// -----------------------------------------------------------------------------
// The Gladys device of a watched stop (one per stop and set of filters):
// minutes to the next departure and to the following one, delay of the next
// one, its line and destination, and whether a traffic message touches the
// departures kept by the filters.
//
// Read-only, no polling: the service refreshes everything on its own timer
// (src/service.js), Gladys never polls (`should_poll: false`). Countdowns and
// texts keep no history: a value re-read every minute whose past means nothing
// would write thousands of rows a day per stop.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { running, situationsOf } from './departures.js';
import { NAMES, TEXT, modeName, say } from './messages.js';

export const STOP_TYPE = 'stop';
// Published when nothing leaves in the next 24 hours (the countdown's max).
export const NO_DEPARTURE_MINUTES = 1440;
export const MAX_TEXT_STATE = 200;
export const FEATURE_KEYS = ['next', 'following', 'delay', 'line', 'disruption'];

/** Shortens a text to `max` characters, with an ellipsis. */
export function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

const slug = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The platform id of a watch: the stop place number, then its filters
 * ("337", "337-l1-l2-to-ski-rail"). Two watches of the same stop with other
 * filters are two devices.
 */
export function watchKey(watch) {
  const number = String(watch.id).split(':').pop();
  const parts = [
    ...(watch.lines ?? []).map(slug),
    ...(watch.direction ? ['to', slug(watch.direction)] : []),
    ...(watch.mode ? [slug(watch.mode)] : []),
  ].filter(Boolean);
  return [number, ...parts].join('-').slice(0, 80);
}

/** "Oslo S (L1, L2 · → Ski · Train)": the name of a watch. */
export function watchName(watch, language) {
  const filters = [
    ...(watch.lines?.length ? [watch.lines.join(', ')] : []),
    ...(watch.direction ? [`→ ${watch.direction}`] : []),
    ...(watch.mode ? [modeName(watch.mode, language)] : []),
  ];
  return filters.length > 0 ? `${watch.name} (${filters.join(' · ')})` : watch.name;
}

const countdown = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  min: 0,
  max: NO_DEPARTURE_MINUTES,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/**
 * The device of a watched stop.
 * @param {object} gladys
 * @param {{ id: string, name: string, lines: string[], direction: string, mode: string }} watch
 * @param {string} language
 */
export function buildStopDevice(gladys, watch, language) {
  const ids = gladys.externalIds(STOP_TYPE, watchKey(watch));
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: clip(`Entur · ${watchName(watch, language)}`, 80),
    external_id: ids.device,
    should_poll: false,
    // What is needed to watch the stop again when /data is lost.
    params: [
      { name: 'stop_id', value: watch.id },
      { name: 'stop_name', value: watch.name },
      { name: 'lines', value: (watch.lines ?? []).join(',') },
      { name: 'direction', value: watch.direction ?? '' },
      { name: 'mode', value: watch.mode ?? '' },
    ],
    features: [
      countdown(names.next, ids.feature('next')),
      countdown(names.following, ids.feature('following')),
      countdown(names.delay, ids.feature('delay')),
      {
        name: names.line,
        external_id: ids.feature('line'),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        // NOT NULL in the core, even for a text (422 on "Add to Gladys" without).
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: names.disruption,
        external_id: ids.feature('disruption'),
        // input/binary: a yes/no the dashboard labels (light-sensor/binary has none).
        category: DEVICE_FEATURE_CATEGORIES.INPUT,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

/** "L1 → Spikkestad", or "no departure in the next 24 hours". */
export function lineText(departure, language) {
  return departure
    ? clip(`${departure.line} → ${departure.destination}`, MAX_TEXT_STATE)
    : say(TEXT, language, 'noDeparture');
}

/**
 * The states of a watched stop.
 * @param {object} gladys
 * @param {object} watch
 * @param {object[]} departures the departures of the watch (applyFilters)
 * @param {string} language
 */
export function stopStates(gladys, watch, departures, language) {
  const ids = gladys.externalIds(STOP_TYPE, watchKey(watch));
  const [next, following] = running(departures);
  const minutes = (departure) =>
    departure ? Math.min(departure.minutes, NO_DEPARTURE_MINUTES) : NO_DEPARTURE_MINUTES;
  return [
    { device_feature_external_id: ids.feature('next'), state: minutes(next) },
    { device_feature_external_id: ids.feature('following'), state: minutes(following) },
    {
      device_feature_external_id: ids.feature('delay'),
      state: next ? Math.min(next.delay, NO_DEPARTURE_MINUTES) : 0,
    },
    { device_feature_external_id: ids.feature('line'), text: lineText(next, language) },
    {
      device_feature_external_id: ids.feature('disruption'),
      state: situationsOf(departures).length > 0 ? 1 : 0,
    },
  ];
}
