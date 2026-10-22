// -----------------------------------------------------------------------------
// From the estimated calls of the Journey Planner to the departures of a
// watched stop: times in milliseconds, minutes to wait, delay, cancellation,
// traffic messages, and the filters of the watch (lines, direction, mode).
// Pure functions: the clock is a parameter.
// -----------------------------------------------------------------------------

/** Lower case, without accents, ø and æ spelled out: "Lillestrøm" matches "lillestrom". */
export function fold(text) {
  return String(text ?? '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Languages of the Entur messages, best first, for each Gladys language. The
// Norwegian text comes last: it is always there, but read by few.
const NORWEGIAN = ['no', 'nb', 'nob', 'nn', 'nno'];

/**
 * The text of a multi-language Entur value ([{ value, language }]) in the
 * user's language, else English, else Norwegian, else the first one.
 */
export function pickText(values, language) {
  const list = (Array.isArray(values) ? values : []).filter(
    (entry) => typeof entry?.value === 'string' && entry.value.trim() !== '',
  );
  for (const wanted of [language, 'en', ...NORWEGIAN]) {
    const found = list.find((entry) => String(entry.language ?? '').toLowerCase() === wanted);
    if (found) {
      return found.value.trim();
    }
  }
  return list[0]?.value.trim() ?? '';
}

/**
 * One departure per estimated call, soonest first; calls already gone (an
 * answer cached for a minute) are dropped.
 * @param {object[]} calls estimatedCalls of the Journey Planner
 * @param {number} now ms
 * @param {string} language for the traffic messages
 */
export function parseCalls(calls, now, language) {
  const departures = [];
  for (const call of calls ?? []) {
    const aimed = Date.parse(call?.aimedDepartureTime);
    const expected = Date.parse(call?.expectedDepartureTime ?? call?.aimedDepartureTime);
    if (!Number.isFinite(aimed) || !Number.isFinite(expected) || expected < now - 60000) {
      continue;
    }
    const line = call.serviceJourney?.line ?? {};
    departures.push({
      // A service journey runs every day under the same id: the aimed time
      // makes the key unique for a day.
      key: `${call.serviceJourney?.id ?? line.publicCode}|${call.aimedDepartureTime}`,
      line: String(line.publicCode ?? '').trim() || '?',
      mode: String(line.transportMode ?? ''),
      destination: String(call.destinationDisplay?.frontText ?? '').trim() || '?',
      platform: String(call.quay?.publicCode ?? ''),
      aimed,
      expected,
      minutes: Math.max(0, Math.floor((expected - now) / 60000)),
      // Early departures are not a delay: 0.
      delay: Math.max(0, Math.round((expected - aimed) / 60000)),
      cancelled: call.cancellation === true,
      realtime: call.realtime === true,
      situations: (call.situations ?? [])
        .filter((situation) => situation?.id)
        .map((situation) => ({
          id: situation.id,
          summary: pickText(situation.summary, language),
          description: pickText(situation.description, language),
        })),
    });
  }
  return departures.sort((a, b) => a.expected - b.expected);
}

/**
 * The departures a watch keeps: its lines (case ignored), its direction (part
 * of the destination, accents and case ignored), its transport mode.
 * @param {object[]} departures from parseCalls
 * @param {{ lines?: string[], direction?: string, mode?: string }} watch
 */
export function applyFilters(departures, watch) {
  const lines = new Set((watch.lines ?? []).map((line) => line.toUpperCase()));
  const direction = fold(watch.direction);
  return departures.filter(
    (departure) =>
      (lines.size === 0 || lines.has(departure.line.toUpperCase())) &&
      (!direction || fold(departure.destination).includes(direction)) &&
      (!watch.mode || departure.mode === watch.mode),
  );
}

/** The departures that will run: not cancelled. */
export const running = (departures) => departures.filter((departure) => !departure.cancelled);

/** The traffic messages of a list of departures, each once. */
export function situationsOf(departures) {
  const found = new Map();
  for (const departure of departures) {
    for (const situation of departure.situations) {
      if (!found.has(situation.id)) {
        found.set(situation.id, { ...situation, line: departure.line });
      }
    }
  }
  return [...found.values()];
}

const clockFormat = new Map();

/** "07:45" in the time zone of the container (TZ, set by Gladys). */
export function clockTime(ms) {
  const zone = process.env.TZ || undefined;
  if (!clockFormat.has(zone)) {
    clockFormat.set(
      zone,
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: zone,
      }),
    );
  }
  return clockFormat.get(zone).format(new Date(ms));
}
