# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Watch public transport stops anywhere in Norway, from Entur open data (no
  account, no key), optionally filtered by lines, direction or transport mode.
- A device per watched stop: next and following departure (minutes), delay of
  the next departure, its line and destination, and a disruption indicator.
- Configuration actions: find a stop, add a stop, remove a stop, show what is
  watched.
- A "Next departures" dashboard widget: times, minutes, delays, cancellations
  and traffic messages.
- Scene triggers: time to leave (1 to 20 minutes), departure delayed,
  departure cancelled, new disruption.
- Scene action "Read the next Entur departures", with a sentence ready to send.
- Texts and documentation in English, French, German and Spanish.
