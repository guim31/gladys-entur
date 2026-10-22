# Entur

Next departures of your public transport stops in Norway in Gladys: trains, metro, trams, buses,
coaches and ferries, with delays, cancellations and traffic messages, in real time.

The data comes from [Entur](https://entur.no), the national registry of all Norwegian public
transport operators (Vy, Ruter, Skyss, AtB, Kolumbus…), through its open APIs: **no account and
no key**. This integration is not affiliated with Entur.

## What you get

- **A device per watched stop** (optionally filtered by lines, direction or transport mode): next
  departure and following departure (minutes), delay of the next departure (minutes), its line and
  destination (text), and whether a traffic message touches its departures (yes/no).
- **A dashboard widget** with the next departures of a stop: time, minutes, delay, cancelled
  departures in red, traffic messages on top.
- **Four scene triggers**: time to leave, departure delayed, departure cancelled, new disruption.
- **A scene action** that reads the next departures of a stop, with a sentence ready to send by
  message or speaker.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Internet access from the Gladys host (the integration calls `api.entur.io`).
- A stop in Norway. Entur covers the whole country; it does not cover the other Nordic countries.

## Installation

1. In Gladys, open **Integrations → Install from GitHub**.
2. Paste `https://github.com/guim31/gladys-entur` and install.
3. Open the integration's **Configuration** tab.

## Configuration

### Settings

- **Language of the texts**: language of the feature names (set when a device is created), of the
  scene sentences and of the traffic messages when Entur publishes them in that language. Entur
  writes its messages in Norwegian and often in English: a message without the chosen language is
  shown in English, else in Norwegian. Norwegian is not offered as an interface language.
- **Refresh interval**: 30 seconds, 1 minute (default) or 2 minutes. All the created devices are
  read in a single request.

### Adding a stop

1. **Find a stop**: type a name (`Jernbanetorget`, `Bergen busstasjon`…). The answer lists the
   matching stops with their identifier, `NSR:StopPlace:58366` for example.
2. **Add a stop**: paste the identifier (or the number alone, or the exact name when it is unique).
   Optional filters:
   - **Lines**: `L1, R13` keeps only these lines (as written on the vehicle).
   - **Direction**: `Ski` keeps only the departures whose destination contains this text (accents
     and case ignored, `lillestrom` matches `Lillestrøm`).
   - **Mode**: train, metro, tram, bus, coach or ferry, for the large hubs.
3. Open the **Discover** tab and add the device to Gladys.

The same stop with other filters makes another device: add Oslo S towards Ski and Oslo S towards
Drammen to follow both directions. Up to 20 stops can be watched.

### Removing a stop, checking the state

- **Remove a stop**: type its name as shown by the status (`Oslo S (L1)`) or its identifier. Its
  device stays in Gladys until you delete it.
- **Show what is watched**: the stops, whether their device exists, the last read from Entur and
  the last error.

## Devices

| Feature              | Type            | Content                                                       |
| -------------------- | --------------- | ------------------------------------------------------------- |
| Next departure       | duration (min)  | minutes before the next departure that runs (0 = leaving now) |
| Following departure  | duration (min)  | minutes before the one after                                  |
| Delay                | duration (min)  | delay of the next departure (0 when on time or early)         |
| Line and destination | text            | `L1 → Spikkestad`                                             |
| Disruption           | binary (yes/no) | a traffic message touches the departures of the device        |

Cancelled departures are skipped by the countdowns. With no departure in the next 24 hours, the
countdowns show 1440 minutes. Only the departures kept by the filters count.

## Dashboard widget

**Next departures**: choose a stop. The widget shows its next eight departures (line, destination,
expected time, minutes, delay): green when the vehicle is tracked in real time, orange when two
minutes late or more, red when cancelled, grey for a timetable time. The caption shows the traffic
messages of the stop.

## Scene triggers

Each trigger can be limited to a stop and to a line (as written on the vehicle, upper case).

- **Time to leave**: a departure leaves in the chosen number of minutes (1 to 20). Fires once per
  departure, when its countdown reaches the number. A departure first seen inside the window does
  not fire.
- **Departure delayed**: a departure is late by the chosen number of minutes or more (1 to 60).
  Once per departure and threshold.
- **Departure cancelled**: a departure is cancelled. Once per departure.
- **New disruption**: a new traffic message touches the departures of a stop. Once per message.

Variables passed to the scene: stop, line, mode, destination, platform, scheduled and expected
times, minutes, delay; for a disruption, its summary and details. What is already there when the
integration starts is not announced; cancellations and messages already announced are not
announced again after a restart.

## Scene actions

**Read the next Entur departures**: choose a stop, optionally a line. Outputs: a sentence
(`Train L1 to Spikkestad at Oslo S: in 3 and 18 min`), the stop, line, destination, minutes to
wait, minutes to the following one, delay, expected time, platform, real time (1/0), disruption
(1/0). The sentence follows the language of the configuration.

## Scene examples

- **Leave for the train**: trigger "Time to leave", stop Oslo S (L1), 7 min → send "Your L1 leaves
  in {{minutes}} min from platform {{platform}}" and blink the hall light.
- **Morning briefing**: at 7:00 on weekdays, action "Read the next Entur departures" → send its
  sentence to the kitchen speaker.
- **Warn of a cancelled bus**: trigger "Departure cancelled", stop Jernbanetorget (31) → send a
  message with the destination and the scheduled time.

## Data, refresh and quotas

Entur's APIs are free and open (NLOD licence). Entur asks every client to identify itself: the
integration sends the `ET-Client-Name: guim31-gladys` header and reads all your stops in a single
request, every 30 seconds at the most, and only for the devices created in Gladys. The data is the
operators' real time when they publish it, else their timetable.

## Troubleshooting

- **No device in Discover**: add the stop first, with "Add a stop".
- **"Entur cannot be reached"**: the Gladys host has no internet access, or Entur is down. The
  integration retries at each refresh and says when it is back.
- **A line filter is refused**: the answer lists the lines that serve the stop; type the line as
  written there.
- **A trigger does not fire**: check the line (exact, upper case) and that the device exists in
  Gladys: only created devices are read.

## Limits

- Developed without living in Norway, against the real Entur API: feedback welcome.
- Feature names are set when the device is created.
- Traffic messages are in Norwegian and often English, never translated.
- Departures are read for the next 24 hours: 20 per stop, 60 when the stop is filtered.

## Credits

Data: [Entur](https://developer.entur.org), NLOD licence. Inspired by the Home Assistant
`entur_public_transport` integration (Apache 2.0) and by the `gladys-tisseo` and `gladys-gtfs`
integrations.
