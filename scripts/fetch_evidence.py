"""Fetch NOAA data for independently documented tide-impact dates; no closure inference."""
import concurrent.futures
import datetime as dt
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://dot.ca.gov/caltrans-near-me/district-4/d4-news/2026-11-03-us101-sr1-connector'
EVENTS = [
    {'date':'2026-10-29','start':'2026-10-29T13:00:00-07:00','end':'2026-10-29T18:30:00-07:00','precision':'approximate interval','state':'reported tide impact','note':'Caltrans reports the ramp was affected during this approximate interval. Continuous full closure and exact reopening are not established by the notice.'},
    {'date':'2026-10-30','precision':'date only','state':'reported tide impact','note':'Caltrans reports another tide-affected day. No closure or reopening time is supplied.'},
    {'date':'2026-10-31','precision':'date only','state':'reported tide impact','note':'Caltrans reports another tide-affected day. No closure or reopening time is supplied.'},
]
BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9414290&datum=MLLW&units=english&time_zone=gmt&format=json&begin_date=20261027&end_date=20261102&application=MuirWoodsTideCheck'
URLS = {'predictions':BASE+'&product=predictions&interval=6','extremes':BASE+'&product=predictions&interval=hilo','observations':BASE+'&product=water_level'}
def fetch(item):
    k,u=item
    try:
        with urllib.request.urlopen(u,timeout=40) as r: data=json.load(r)
        if data.get('error'): raise ValueError('NOAA product unavailable')
        return k,{'ok':True,'url':u,'fetchedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'data':data}
    except Exception as e:
        return k,{'ok':False,'url':u,'error':str(e)}
def main():
    with concurrent.futures.ThreadPoolExecutor() as pool: sources=dict(pool.map(fetch,URLS.items()))
    data={'source':SOURCE,'publisher':'Caltrans District 4','published':'2026-11-03','events':EVENTS,'sources':sources,'limitations':'Positive tide-impact reports only. No verified open intervals, no complete closure/reopening log, no independent accuracy score. These observations are used for retrospective comparison, not to tune thresholds.'}
    target=ROOT/'public/data/evidence.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(data,separators=(',',':'))+'\n')
    print({k:v['ok'] for k,v in sources.items()})
if __name__=='__main__':main()
