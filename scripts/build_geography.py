"""Build an offline display basemap from Natural Earth and GeoNames.

Inputs downloaded to output/research (URLs in docs/FRONTEND-RESEARCH.md).
This is cartographic context only; it does not modify listing data.
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
research = ROOT / 'output/research'

def project(lon, lat):
    return [round((lon + 85) * 110, 2), round((49 - lat) * 155, 2)]

def path(geometry):
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    parts = []
    for polygon in polygons:
        for ring in polygon:
            points = [project(*coord[:2]) for coord in ring]
            parts.append('M' + 'L'.join(f'{x},{y}' for x, y in points) + 'Z')
    return ''.join(parts)

provinces = json.loads((research / 'provinces.geojson').read_text())['features']
regions = []
for feature in provinces:
    props = feature['properties']
    if props['name'] in ['Ontario', 'Québec', 'Manitoba', 'Michigan', 'New York', 'Ohio', 'Pennsylvania', 'Wisconsin', 'Minnesota', 'Indiana']:
        regions.append({'name': props['name'], 'path': path(feature['geometry'])})
lakes = []
for feature in json.loads((research / 'lakes.geojson').read_text())['features']:
    if feature['properties']['name'] in ['Lake Ontario', 'Lake Erie', 'Lake Huron', 'Lake Michigan', 'Lake Superior', 'Lake Simcoe', 'Lake Nipissing']:
        lakes.append({'name': feature['properties']['name'], 'path': path(feature['geometry'])})

with zipfile.ZipFile(research / 'CA.zip') as archive:
    rows = [line.split('\t') for line in archive.read('CA.txt').decode().splitlines()]
rows = [r for r in rows if r[10] == '08' and r[6] in ('P', 'A')]
normalize = lambda value: value.lower().replace('.', '').replace('-', ' ').strip()
cities = {}
for slug in json.loads((ROOT / 'data/market_summary.json').read_text())['cities']:
    matches = [r for r in rows if normalize(slug) in [normalize(name) for name in [r[1], r[2]] + r[3].split(',')] ]
    # Prefer a populated place, then the named administrative municipality.
    matches.sort(key=lambda r: (r[6] != 'P', -int(r[14] or 0)))
    if not matches:
        raise ValueError(f'No city coordinate for {slug}')
    row = matches[0]
    lon, lat = float(row[5]), float(row[4])
    cities[slug] = {'lon': lon, 'lat': lat, 'point': project(lon, lat), 'geonameId': row[0]}

output = ROOT / 'public/geography/ontario.json'
output.write_text(json.dumps({'regions': regions, 'lakes': lakes, 'cities': cities}, separators=(',', ':')) + '\n')
print(f'{len(cities)} city reference points, {len(regions)} regions, {len(lakes)} lakes; {output.stat().st_size:,} bytes')
