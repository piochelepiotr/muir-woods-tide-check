"""Public-source snapshot for GitHub Pages. No API keys or third-party packages."""
import concurrent.futures
import datetime as dt
import html
import json
from pathlib import Path
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'
COMMON = 'station=9414290&datum=MLLW&units=english&time_zone=gmt&format=json&application=MuirWoodsTideCheck'
START = (NOW - dt.timedelta(days=2)).strftime('%Y%m%d')
END = (NOW + dt.timedelta(days=32)).strftime('%Y%m%d')
URLS = {
    'predictions': BASE + COMMON + f'&product=predictions&interval=6&begin_date={START}&end_date={END}',
    'extremes': BASE + COMMON + f'&product=predictions&interval=hilo&begin_date={START}&end_date={END}',
    'observations': BASE + COMMON + '&product=water_level&' + urllib.parse.urlencode({'begin_date': (NOW-dt.timedelta(hours=3)).strftime('%Y%m%d %H:%M'), 'end_date': NOW.strftime('%Y%m%d %H:%M')}),
    'alerts': 'https://api.weather.gov/alerts/active?point=37.879,-122.516',
    'weather': 'https://api.weather.gov/gridpoints/MTR/82,110/forecast/hourly',
    'incidents': 'https://quickmap.dot.ca.gov/data/chp-only.kml',
    'road1': 'https://roads.dot.ca.gov/roadscell.php?roadnumber=1',
    'road101': 'https://roads.dot.ca.gov/roadscell.php?roadnumber=101',
}

def plain(value):
    value = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', '', value, flags=re.S | re.I)
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', value))).strip()

def fetch(item):
    key, url = item
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'MuirWoodsTideCheck (github.com/piochelepiotr/muir-woods-tide-check)'})
        with urllib.request.urlopen(req, timeout=35) as response:
            raw = response.read().decode('utf-8')
        value = json.loads(raw) if key not in ('incidents', 'road1', 'road101') else raw
        if isinstance(value, dict) and value.get('error'):
            raise ValueError(value['error'])
        if key in ('predictions', 'extremes'):
            if not value.get('predictions'):
                raise ValueError('Missing predictions')
        if key == 'observations' and not value.get('data'):
            raise ValueError('Missing water levels')
        if key == 'alerts' and 'features' not in value:
            raise ValueError('Missing alerts collection')
        if key == 'weather' and not value.get('properties', {}).get('periods'):
            raise ValueError('Missing hourly forecast')
        if key == 'incidents':
            root = ET.fromstring(raw)
            ns = {'k': 'http://www.opengis.net/kml/2.2'}
            value = []
            for p in root.findall('.//k:Placemark', ns):
                c = p.find('.//k:coordinates', ns)
                if c is None or not c.text:
                    continue
                lon, lat = map(float, c.text.strip().split(',')[:2])
                # Bounding box surrounding Manzanita and its approaches. No completeness claim.
                if 37.849 <= lat <= 37.909 and -122.556 <= lon <= -122.476:
                    desc = p.find('k:description', ns)
                    value.append({'lat': lat, 'lon': lon, 'text': plain(desc.text or '') if desc is not None else 'CHP incident'})
        if key in ('road1', 'road101'):
            if 'latest reported as of' not in raw.lower() or '<h3>' not in raw.lower():
                raise ValueError('Unrecognized Caltrans road report format')
            # Keep Marin references and section context, not unrelated statewide closures.
            paragraphs = re.split(r'</p>|<br\s*/?>|</div>', raw, flags=re.I)
            value = [plain(p) for p in paragraphs if re.search(r'Marin|Manzanita|Mill Valley|Tamalpais|Sausalito|Shoreline', plain(p), re.I)]
        return key, {'ok': True, 'fetchedAt': NOW.isoformat(), 'url': url, 'data': value}
    except Exception as exc:
        return key, {'ok': False, 'fetchedAt': NOW.isoformat(), 'url': url, 'error': str(exc)}

def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        sources = dict(pool.map(fetch, URLS.items()))
    # Each failed source remains explicitly unavailable; never silently reuse an old live report.
    result = {'generatedAt': NOW.isoformat(), 'sources': sources}
    target = ROOT / 'public/data/snapshot.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(result, separators=(',', ':')) + '\n')
    temp.replace(target)
    for key, source in sources.items():
        print(f'{key}: {"OK" if source["ok"] else source["error"]}')
    if not sources['predictions']['ok']:
        raise SystemExit('Tide predictions unavailable; snapshot explicitly records the failure.')

if __name__ == '__main__':
    main()
