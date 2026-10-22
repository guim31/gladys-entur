// -----------------------------------------------------------------------------
// Entur open APIs (Norway, no key): the Journey Planner v3 GraphQL API for the
// departures of the watched stops, the Geocoder for the stop search.
//
// Every request carries the ET-Client-Name header Entur requires
// (https://developer.entur.org/pages-intro-authentication): without it the
// client is rate limited harder. One GraphQL request per refresh reads every
// watched stop at once (one alias per stop place).
// -----------------------------------------------------------------------------

export const JOURNEY_PLANNER_URL = 'https://api.entur.io/journey-planner/v3/graphql';
export const GEOCODER_URL = 'https://api.entur.io/geocoder/v1/autocomplete';
export const CLIENT_NAME = 'guim31-gladys';

const TIMEOUT_MS = 15000;
// Departures read per watched stop. The lines and the mode are filtered by
// Entur (whiteListed), the direction only here: a direction filter reads more.
export const DEPARTURES = 40;
export const DEPARTURES_DIRECTION = 100;
export const MODES = ['rail', 'metro', 'tram', 'bus', 'coach', 'water'];
const LINE_ID = /^[A-Za-z]+:Line:[\w.:-]+$/;
// 24 hours: a countdown at its maximum means "nothing in the next 24 hours".
const TIME_RANGE_SECONDS = 86400;

const STOP_PLACE_ID = /^NSR:StopPlace:\d+$/;

export class EnturError extends Error {}

const CALL_FIELDS = `
  aimedDepartureTime
  expectedDepartureTime
  cancellation
  realtime
  quay { publicCode }
  destinationDisplay { frontText }
  serviceJourney { id line { publicCode transportMode } }
  situations { id summary { value language } description { value language } }
`;

/** "337", "nsr:stopplace:337", "NSR:StopPlace:337" → "NSR:StopPlace:337"; else null. */
export function parseStopPlaceId(text) {
  const value = String(text ?? '').trim();
  if (/^\d+$/.test(value)) {
    return `NSR:StopPlace:${value}`;
  }
  const match = value.match(/^nsr:stopplace:(\d+)$/i);
  return match ? `NSR:StopPlace:${match[1]}` : null;
}

export class Entur {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   */
  constructor({ fetch: fetchImpl = globalThis.fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async request(url, init = {}) {
    const host = new URL(url).host;
    let response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers: { 'ET-Client-Name': CLIENT_NAME, Accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new EnturError(`${host}: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
    }
    if (!response.ok) {
      throw new EnturError(`${host}: HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new EnturError(`${host}: invalid JSON`);
    }
  }

  /** `partial`: an error on one alias keeps the others (data and errors together). */
  async graphql(query, variables = {}, { partial = false } = {}) {
    const body = await this.request(JOURNEY_PLANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const hasData = body?.data && Object.values(body.data).some((value) => value !== null);
    if (Array.isArray(body?.errors) && body.errors.length > 0 && !(partial && hasData)) {
      throw new EnturError(`Entur: ${String(body.errors[0]?.message ?? 'error').slice(0, 160)}`);
    }
    return body?.data ?? {};
  }

  /**
   * The upcoming calls of several watched stops, in one request: one alias
   * per watch, with its own line and mode filters.
   * @param {{ id: string, lineIds?: string[], mode?: string, direction?: string }[]} watches
   * @returns {Promise<({ name: string, calls: object[] } | null)[]>} in the order of `watches`
   */
  async departures(watches) {
    const aliases = [];
    watches.forEach((watch, index) => {
      // Every value inlined below is checked first: no injection possible.
      if (!STOP_PLACE_ID.test(watch.id)) {
        return;
      }
      const args = [
        `numberOfDepartures: ${watch.direction ? DEPARTURES_DIRECTION : DEPARTURES}`,
        `timeRange: ${TIME_RANGE_SECONDS}`,
        'includeCancelledTrips: true',
      ];
      const lineIds = (watch.lineIds ?? []).filter((id) => LINE_ID.test(id));
      if (lineIds.length > 0) {
        args.push(`whiteListed: { lines: ${JSON.stringify(lineIds)} }`);
      }
      if (MODES.includes(watch.mode)) {
        args.push(`whiteListedModes: [${watch.mode}]`);
      }
      aliases.push(`s${index}: stopPlace(id: ${JSON.stringify(watch.id)}) {
        id name
        estimatedCalls(${args.join(', ')}) { ${CALL_FIELDS} }
      }`);
    });
    if (aliases.length === 0) {
      return watches.map(() => null);
    }
    const data = await this.graphql(`{ ${aliases.join('\n')} }`, {}, { partial: true });
    return watches.map((watch, index) => {
      const stop = data[`s${index}`];
      return stop ? { name: stop.name, calls: stop.estimatedCalls ?? [] } : null;
    });
  }

  /**
   * A stop place and the lines it serves, or null when the id is unknown.
   * @returns {Promise<{ id: string, name: string, modes: string[], lines: { code: string, mode: string, ids: string[] }[] } | null>}
   */
  async stopPlace(id) {
    const data = await this.graphql(
      `query ($id: String!) { stopPlace(id: $id) { id name transportMode quays { lines { id publicCode transportMode } } } }`,
      { id },
    );
    const stop = data.stopPlace;
    if (!stop) {
      return null;
    }
    const lines = new Map();
    for (const quay of stop.quays ?? []) {
      for (const line of quay?.lines ?? []) {
        if (line?.publicCode) {
          // A public code can name lines of several operators: every id kept.
          const known = lines.get(line.publicCode) ?? {
            code: line.publicCode,
            mode: line.transportMode,
            ids: [],
          };
          if (line.id && !known.ids.includes(line.id)) {
            known.ids.push(line.id);
          }
          lines.set(line.publicCode, known);
        }
      }
    }
    return {
      id: stop.id,
      name: stop.name,
      modes: (stop.transportMode ?? []).filter(Boolean),
      lines: [...lines.values()].sort((a, b) =>
        a.code.localeCompare(b.code, 'nb', { numeric: true }),
      ),
    };
  }

  /**
   * Stop places matching a name.
   * @returns {Promise<{ id: string, name: string, label: string }[]>}
   */
  async searchStops(text, size = 8) {
    const url = new URL(GEOCODER_URL);
    url.searchParams.set('text', text);
    url.searchParams.set('layers', 'venue');
    url.searchParams.set('size', String(size));
    const body = await this.request(url.toString());
    const seen = new Set();
    const stops = [];
    for (const feature of body?.features ?? []) {
      const props = feature?.properties ?? {};
      if (!STOP_PLACE_ID.test(props.id ?? '') || seen.has(props.id)) {
        continue;
      }
      seen.add(props.id);
      stops.push({ id: props.id, name: props.name, label: props.label ?? props.name });
    }
    return stops;
  }
}
