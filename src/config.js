// -----------------------------------------------------------------------------
// Integration configuration: the defaults (they mirror the `default` values of
// the manifest `config_schema`, test/manifest.test.js checks it) and the
// normalization of what Gladys sends (strings from the form).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the departures. 30 s is the floor: Entur asks
// its users not to poll faster, and a countdown in minutes gains nothing.
export const REFRESH_INTERVALS = [30, 60, 120];

export const DEFAULT_CONFIG = {
  language: 'fr',
  refresh_interval: '60',
};

/**
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 * @returns {{ language: string, refreshSeconds: number }}
 */
export function normalizeConfig(raw = {}) {
  const language = LANGUAGES.includes(raw?.language) ? raw.language : DEFAULT_CONFIG.language;
  const seconds = Number(raw?.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  return {
    language,
    refreshSeconds: REFRESH_INTERVALS.includes(seconds)
      ? seconds
      : Number(DEFAULT_CONFIG.refresh_interval),
  };
}
