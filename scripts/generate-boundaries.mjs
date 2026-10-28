/* eslint-disable no-undef -- Node build script; the shared config sets browser globals only. */
// Regenerates src/states.json: state and province boundaries for every
// country, so an inland view (Delhi, Madrid, Denver) is not a blank sheet of
// land. Run by hand when the data needs refreshing; the output is committed.
//
//   node scripts/generate-boundaries.mjs
//
// Source: Natural Earth 1:10m admin-1 boundary lines (public domain), the
// same family as the coastlines in src/world.svg.
//
// The lines are simplified to ~2 km (Ramer-Douglas-Peucker) and rounded to
// ~1 km, which is finer than a pixel at the app's tightest zoom, and cut into
// 10° tiles keyed "lng,lat" by each tile's south-west corner. The map only
// draws the tiles under its window, so a player renders a few dozen lines
// rather than the world's ten thousand.

import fs from 'fs'

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson'
const TOLERANCE = 0.02
const DIGITS = 2
const TILE = 10

/** Iterative Ramer-Douglas-Peucker. */
function simplify(points, epsilon) {
  if (points.length < 3) return points
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [x1, y1] = points[a]
    const [x2, y2] = points[b]
    const dx = x2 - x1
    const dy = y2 - y1
    const length2 = dx * dx + dy * dy
    let farthest = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const t =
        length2 === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length2),
            )
      const d = (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2
      if (d > farthest) {
        farthest = d
        index = i
      }
    }
    if (farthest > epsilon * epsilon) {
      keep[index] = true
      stack.push([a, index], [index, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** A number in as few characters as SVG allows: ".5", "-.25", "12". */
function short(value) {
  let s = value.toFixed(DIGITS).replace(/\.?0+$/, '')
  if (s === '-0' || s === '') s = '0'
  return s.replace(/^(-?)0\./, '$1.')
}

/** One line as an SVG path: absolute start, then relative steps (y = -lat). */
function path(points) {
  const scale = 10 ** DIGITS
  const q = points.map(([x, y]) => [
    Math.round(x * scale) / scale,
    Math.round(-y * scale) / scale,
  ])
  let d = `M${short(q[0][0])} ${short(q[0][1])}`
  let [px, py] = q[0]
  for (const [x, y] of q.slice(1)) {
    const rx = Math.round((x - px) * scale) / scale
    const ry = Math.round((y - py) * scale) / scale
    if (rx === 0 && ry === 0) continue
    const sy = short(ry)
    d += `l${short(rx)}${sy.startsWith('-') ? '' : ' '}${sy}`
    px = x
    py = y
  }
  return d
}

/** Every 10° tile a line's bounding box touches. */
function tilesOf(points) {
  const lngs = points.map(([x]) => x)
  const lats = points.map(([, y]) => y)
  const keys = []
  for (
    let lng = Math.floor(Math.min(...lngs) / TILE) * TILE;
    lng <= Math.max(...lngs);
    lng += TILE
  ) {
    for (
      let lat = Math.floor(Math.min(...lats) / TILE) * TILE;
      lat <= Math.max(...lats);
      lat += TILE
    ) {
      keys.push(`${lng},${lat}`)
    }
  }
  return keys
}

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`${SOURCE} returned ${response.status}`)
const { features } = await response.json()

const tiles = {}
let lines = 0
for (const feature of features) {
  const geometry = feature.geometry
  if (!geometry) continue
  const parts =
    geometry.type === 'MultiLineString'
      ? geometry.coordinates
      : [geometry.coordinates]
  for (const part of parts) {
    const points = simplify(part, TOLERANCE)
    if (points.length < 2) continue
    const d = path(points)
    for (const key of tilesOf(points)) tiles[key] = (tiles[key] ?? '') + d
    lines++
  }
}

fs.writeFileSync('src/states.json', JSON.stringify(tiles))
const bytes = fs.statSync('src/states.json').size
console.log(
  `boundaries: ${lines} lines in ${Object.keys(tiles).length} tiles, ${bytes} bytes`,
)
