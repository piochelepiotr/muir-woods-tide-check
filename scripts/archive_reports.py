"""Keep timestamped source reports, including explicit unknown state. Never infer open."""
import datetime as dt
import json
from pathlib import Path
import shutil
import sys
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
def main():
    archive=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'.history'
    snapshot=json.loads((ROOT/'public/data/snapshot.json').read_text())
    generated=dt.datetime.fromisoformat(snapshot['generatedAt'])
    day=generated.astimezone(ZoneInfo('America/Los_Angeles')).strftime('%Y-%m-%d')
    days=archive/'days';days.mkdir(parents=True,exist_ok=True)
    target=days/(day+'.json')
    records=json.loads(target.read_text()) if target.exists() else []
    sources=snapshot['sources']
    record={'checkedAt':snapshot['generatedAt'],'roadState':'unverified','sources':{k:sources[k] for k in ['incidents','road1','road101','alerts'] if k in sources},'note':'No report does not mean open. Disappearance of a report does not establish reopening.'}
    obs=sources.get('observations',{}).get('data',{}).get('data',[])
    record['latestGaugeObservation']=obs[-1] if obs else None
    record['gaugeObservations']=obs
    observation_times={p['t'] for p in obs}
    record['matchingAstronomicalPredictions']=[p for p in sources.get('predictions',{}).get('data',{}).get('predictions',[]) if p['t'] in observation_times]
    if not any(r['checkedAt']==record['checkedAt'] for r in records):records.append(record)
    target.write_text(json.dumps(records,separators=(',',':'))+'\n')
    index=[]
    for path in sorted(days.glob('*.json'),reverse=True):
        rows=json.loads(path.read_text())
        index.append({'date':path.stem,'checks':len(rows),'firstCheck':rows[0]['checkedAt'],'lastCheck':rows[-1]['checkedAt'],'file':'days/'+path.name})
    (archive/'index.json').write_text(json.dumps({'days':index,'note':'Observed feed snapshots, not a complete road closure log. No confirmed-open labels are inferred.'},separators=(',',':'))+'\n')
    cycles=archive/'forecast-cycles';cycles.mkdir(exist_ok=True)
    forecast_path=ROOT/'public/data/forecast.json'
    if forecast_path.exists():
        forecast=json.loads(forecast_path.read_text())
        if forecast.get('ok'):
            issued=dt.datetime.fromisoformat(forecast['data']['issuedAt'])
            cycle_path=cycles/(issued.strftime('%Y%m%dT%H%MZ')+'.json')
            # First-seen forecast is immutable, so later verification does not leak observations.
            if not cycle_path.exists():cycle_path.write_text(json.dumps(forecast,separators=(',',':'))+'\n')
    dest=ROOT/'public/data/history'
    dest.mkdir(parents=True,exist_ok=True)
    shutil.copy2(archive/'index.json',dest/'index.json')
    # Only recent days need to be copied into the deployment; the branch retains all records.
    for item in index[:90]:
        (dest/'days').mkdir(exist_ok=True)
        shutil.copy2(archive/item['file'],dest/item['file'])
    print(f'Archived {day}: {len(records)} checks. Road state remains unverified.')
if __name__=='__main__':main()
