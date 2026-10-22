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
// Departures read per stop: enough for the widget and the triggers; more when
// a filter (line, direction, mode) keeps only part of them.
export const DEPARTURES_UNFILTERED = 20;
export const DEPARTURES_FILTERED = 60;
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

  async graphql(query, variables = {}) {
    const body = await this.request(JOURNEY_PLANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      throw new EnturError(`Entur: ${String(body.errors[0]?.message ?? 'error').slice(0, 160)}`);
    }
    return body?.data ?? {};
  }

  /**
   * The upcoming calls of several stop places, in one request.
   * @param {{ id: string, filtered: boolean }[]} places
   * @returns {Promise<Map<string, { name: string, calls: object[] } | null>>} by stop place id
   */
  async departures(places) {
    const unique = [...new Map(places.map((place) => [place.id, place])).values()].filter((place) =>
      STOP_PLACE_ID.test(place.id),
    );
    const result = new Map();
    if (unique.length === 0) {
      return result;
    }
    // The ids are checked against STOP_PLACE_ID above: safe to inline.
    const aliases = unique.map(
      (place, index) => `s${index}: stopPlace(id: ${JSON.stringify(place.id)}) {
        id name
        estimatedCalls(numberOfDepartures: ${place.filtered ? DEPARTURES_FILTERED : DEPARTURES_UNFILTERED}, timeRange: ${TIME_RANGE_SECONDS}, includeCancelledTrips: true) { ${CALL_FIELDS} }
      }`,
    );
    const data = await this.graphql(`{ ${aliases.join('\n')} }`);
    unique.forEach((place, index) => {
      const stop = data[`s${index}`];
      result.set(place.id, stop ? { name: stop.name, calls: stop.estimatedCalls ?? [] } : null);
    });
    return result;
  }

  /**
   * A stop place and the lines it serves, or null when the id is unknown.
   * @returns {Promise<{ id: string, name: string, modes: string[], lines: { code: string, mode: string }[] } | null>}
   */
  async stopPlace(id) {
    const data = await this.graphql(
      `query ($id: String!) { stopPlace(id: $id) { id name transportMode quays { lines { publicCode transportMode } } } }`,
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
          lines.set(line.publicCode, { code: line.publicCode, mode: line.transportMode });
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
