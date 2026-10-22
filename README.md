# Entur for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for public transport in
**Norway**: next departures of your stops (train, metro, tram, bus, coach, ferry), delays,
cancellations and traffic messages, in real time, from [Entur](https://entur.no) open data. No
account, no key.

## What it does

- **A device per watched stop**, optionally filtered by lines, direction or transport mode: next
  and following departure (minutes), delay of the next departure, its line and destination, and a
  disruption indicator.
- **A dashboard widget**: the next departures of a stop, with times, delays, cancellations and the
  traffic messages.
- **Scene triggers**: time to leave (1 to 20 minutes before a departure), departure delayed,
  departure cancelled, new disruption.
- **A scene action**: read the next departures of a stop, with a sentence ready to send.
- Texts in English, French, German and Spanish. Entur's traffic messages stay in Norwegian or
  English, as published.

The user documentation is in [`docs/en.md`](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
[es](docs/es.md)).

## Requirements

- Gladys Assistant 5.1.0 or later, with internet access.
- A stop in Norway (Entur covers every Norwegian operator: Vy, Ruter, Skyss, AtB, Kolumbus…).

## Installation

1. In Gladys, open **Integrations → Install from GitHub**.
2. Paste `https://github.com/guim31/gladys-entur` and install.
3. In the integration's **Configuration** tab, use **Find a stop** then **Add a stop**, and create
   the device in the **Discover** tab.

## How it works

The integration calls the Entur Journey Planner v3 GraphQL API with the `ET-Client-Name` header
Entur requires, reading every created device in a single request, every 30 seconds to 2 minutes
(1 minute by default). The stop search uses the Entur Geocoder. Only `/data/watch.json` is written:
the watched stops and the cancellations and messages already announced.

## Limits

- Developed outside Norway against the real Entur API, without daily use there: feedback welcome.
- Feature names are set when the device is created.
- Up to 20 stops; departures of the next 24 hours.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and real Entur answers recorded in
`test/fixtures/entur`; they never touch the network. See [`CLAUDE.md`](CLAUDE.md) for the
project rules.

## Credits

- Cover: the Entur logo from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:EnTur_logo.png) (public domain), shown in white on the Entur blue.
- Data: [Entur](https://developer.entur.org), under the Norwegian Licence for Open Government
  Data (NLOD).
- Inspired by the Home Assistant
  [`entur_public_transport`](https://www.home-assistant.io/integrations/entur_public_transport/)
  integration (Apache 2.0) and by the `gladys-tisseo` and `gladys-gtfs` integrations.

Not affiliated with Entur AS.

## License

Apache-2.0
