# Changelog

User-facing release notes. Technical detail — refactors, dependency bumps, API
changes — belongs in the GitHub Release for the matching tag.

## Unreleased

- Air quality now comes from OpenWeather. Add a free OpenWeather API key in
  the app settings; without one the screen asks for it.
- The reading refreshes every thirty minutes.

## v26.10.0

The first release.

The air quality where your screen is: the index, what it means for people
outside, the pollutant driving it, and how it will change over the next 24
hours, on a map of the region coloured by the reading.

- Choose the US AQI or the European AQI.
- If the air quality service cannot be reached, the screen keeps showing the
  last reading it received rather than going blank.
- A screen with no location set says so, instead of guessing.
- Nothing moves and nothing animates. The reading refreshes every fifteen
  minutes.
