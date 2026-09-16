# Frontend research and atlas redesign

Research date: September 14, 2026.

## What changed

The first pass was a generic chat dashboard: a marketing headline, empty chat,
three suggestion cards, and a small statistics sidebar. The user rejected it.
The replacement makes Ontario itself the interface: a full-window map, a
searchable city index, and one contextual detail tray. A comparison workspace
and the agent open from the same context.

## References actually reviewed

| Reference | What informed the implementation |
| --- | --- |
| [Rauno Freiberg — Craft](https://rauno.me/craft) | Inspected the live collection in a browser, including its spatial and agent-interface examples. A distinctive interaction should be the center of the product. |
| [Rauno — Designing Depth](https://rauno.me/craft/depth) | Layer the working surfaces: geography behind markers, contextual details above the map, a modal research panel above that. |
| [Benji Taylor — Family Values](https://benji.org/family-values) | Contextual trays and gradual disclosure. Detailed information appears when selecting a city; the agent does not consume the initial screen. |
| [Emil Kowalski — You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) | Short, purposeful motion. Direct map dragging has no easing delay. Detail changes and panel entry have short transitions and respect reduced motion. |
| [DD.NYC — Hawkridge, Webby case study](https://www.webbyawards.com/crafted-with-code/dd-nyc-hawkridge-luxury-real-estate-development-website/) | A real-estate map can be the primary exploration surface. This app maps city medians, never individual property locations. |

These are design references, not component source code copied into the project.
Some source essays date to 2024–2025; Rauno's live collection also includes 2026
work. The research does not establish that a particular visual style is a
universal 2026 trend.

## X research and access limits

Searched X-indexed material and attempted to open the creator's profile and
specific posts directly. X returned 403 / browser HTTP-response failures. The
linked posts below were discoverable through [this indexed feed](https://ppll.app/emil-kowalski),
but their original media could not be inspected. They are leads, not a claim
that the videos were watched:

- [Emil's September 9 post about positioning a toast alongside Linear's agent](https://x.com/emilkowalski/status/2097702945890377877).
- [Emil's August 27 post about interactive text-based graphs](https://x.com/emilkowalski/status/2092979832208425085).
- An [accessible X post quoting Emil's animation demonstration](https://x.com/Charlesvinette/status/1942571643919909116)
  provided context, but was not used as visual evidence.

The actual design decisions were grounded in the authors' accessible primary
sites above. No login, payment, anti-bot bypass, or social post was performed.

## Design decisions

- **Subject:** comparing asking prices across Ontario cities.
- **Job:** select a place, inspect its sample, and compare it with another place.
- **Palette:** off-white paper `#FBFBF8`, charcoal `#252D2A`, lake blue-gray
  `#DBE7E6`, land `#ECEEE5`, muted green `#537564`, and a small coral selection
  accent `#ED835E`.
- **Type:** locally hosted Instrument Sans for interface and headings, IBM Plex
  Mono for prices and cartographic labels. License files are in `public/fonts`.
- **Signature:** actual Great Lakes geography with city-price markers and a
  detail tray anchored to the working map.
- **Interaction:** map drag, zoom and fit; city search and sorting; a city-median
  ceiling slider; bedroom-price details; a shared-scale comparison chart;
  contextual agent questions; modal keyboard focus and Escape dismissal.
- **Mobile:** a map/city-index switch replaces a long page of stacked cards.

## Cartographic sources

Natural Earth is [public domain](https://www.naturalearthdata.com/about/terms-of-use/).
GeoNames is [attribution licensed](https://www.geonames.org/export/) and is linked
in the visible map attribution and dataset information.

Inputs downloaded for the offline basemap:

- [Natural Earth 50m provinces](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson)
- [Natural Earth 50m lakes](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson)
- [GeoNames Canada extract](https://download.geonames.org/export/dump/CA.zip)

`scripts/build_geography.py` produces `public/geography/ontario.json` from the
files in `output/research`. All 36 city reference points are matched to populated
places or administrative areas in Ontario; hydrological features are excluded.
The map uses a local equirectangular display projection. Positions are approximate
city reference points, not listing coordinates, city boundaries, or navigation
instructions. Housing data under `data/` is unchanged.

The map needs no external tile server, API key, paid map service, WebGL, or new
JavaScript dependency at runtime.
