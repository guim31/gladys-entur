// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+).
//
// - departures: the board of one watched stop — a status row per departure
//   ("L1 → Spikkestad" / "07:45 · 3 min · +4"), green when tracked in real
//   time, orange when late, red when cancelled, grey for a timetable time;
//   the heading is the stop, the caption its traffic message (or the legend).
//
// Budget of the core: 8 components, 2 texts, a status of 10 rows at most.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { clockTime, situationsOf } from './departures.js';
import { clip, watchName } from './devices.js';
import { TEXT, say } from './messages.js';

export const MAX_ROWS = 8;
const MAX_LABEL = 40;

const t = (language, key, params) => say(TEXT, language, key, params);

/** "07:45 · 3 min · +4", "07:45 · Cancelled". */
export function departureValue(departure, language) {
  const time = clockTime(departure.cancelled ? departure.aimed : departure.expected);
  if (departure.cancelled) {
    return clip(`${time} · ${t(language, 'cancelled')}`, 40);
  }
  const late = departure.delay > 0 ? ` · +${departure.delay}` : '';
  return `${time} · ${departure.minutes} min${late}`;
}

export function departureColor(departure) {
  if (departure.cancelled) {
    return WIDGET_COLORS.DANGER;
  }
  if (departure.delay >= 2) {
    return WIDGET_COLORS.WARNING;
  }
  return departure.realtime ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL;
}

async function departuresContent(service, { settings, language }) {
  const ttl = Math.max(30, service.config.refreshSeconds);
  if (!settings?.stop) {
    return { ttl_seconds: ttl, components: [{ type: 'text', text: t(language, 'pickStop') }] };
  }
  const found = await service.boardOf(settings.stop);
  if (!found) {
    return { ttl_seconds: ttl, components: [{ type: 'text', text: t(language, 'gone') }] };
  }
  const { watch, departures } = found;
  const components = [
    { type: 'text', variant: 'heading', text: clip(watchName(watch, language), 40) },
  ];
  if (!departures) {
    components.push({ type: 'text', variant: 'body', text: t(language, 'loading') });
    return { ttl_seconds: ttl, components };
  }
  const situations = situationsOf(departures);
  components.push({
    type: 'text',
    variant: 'caption',
    text:
      situations.length > 0
        ? clip(
            `⚠ ${[...new Set(situations.map((s) => s.summary || s.description))].join(' · ')}`,
            120,
          )
        : t(language, 'legend'),
  });
  const rows = departures.slice(0, MAX_ROWS);
  if (rows.length === 0) {
    components[1] = { type: 'text', variant: 'caption', text: t(language, 'noDeparture') };
    return { ttl_seconds: ttl, components };
  }
  components.push({
    type: 'status',
    items: rows.map((departure) => ({
      label: clip(`${departure.line} → ${departure.destination}`, MAX_LABEL),
      value: departureValue(departure, language),
      color: departureColor(departure),
    })),
  });
  return { ttl_seconds: ttl, components };
}

export const WIDGETS = {
  departures: { get: departuresContent },
};
