// -----------------------------------------------------------------------------
// A scenario staging every trigger on the real Oslo S departures: the first
// read is silent, then, three minutes later, a train is cancelled, another is
// 12 minutes late, a new traffic message appears, and the countdowns go on.
// The changes are made on the recorded calls, as Entur would send them.
// -----------------------------------------------------------------------------

import { OSLO_S, action, create } from './world.js';

const shift = (iso, minutes) => {
  const date = new Date(Date.parse(iso) + minutes * 60000);
  // Same offset as Entur (+02:00 in October).
  return new Date(date.getTime() + 2 * 3600000).toISOString().replace(/\.\d+Z$/, '+02:00');
};

/** Resolves with the scene events fired after the first read. */
export async function stageEverything(world) {
  await action(world, 'add_stop', { stop: OSLO_S });
  const device = await create(world, 'Oslo S');
  const before = world.fake.sceneEvents.length;
  const calls = world.network.stops[OSLO_S].estimatedCalls;
  // R21 to Moss: cancelled.
  calls[5].cancellation = true;
  // R22 to Rakkestad (08:00): 12 minutes late.
  calls[10].expectedDepartureTime = shift(calls[10].aimedDepartureTime, 12);
  // L1 to Lillestrøm: a new traffic message.
  calls[6].situations = [
    {
      id: 'U2l0dWF0aW9uOk5TQjp0ZXN0',
      summary: [
        { value: 'Signalfeil', language: 'no' },
        { value: 'Signal failure', language: 'en' },
      ],
      description: [
        { value: 'Signalfeil på Lillestrøm. Forsinkelser må påregnes.', language: 'no' },
      ],
    },
  ];
  world.clock.advance(3 * 60000);
  await world.service.refresh();
  return { device, events: world.fake.sceneEvents.slice(before) };
}
