"""Read operational NOAA P-ETSS station mean and exceedance bounds, in feet MLLW."""
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
BASE='https://nomads.ncep.noaa.gov/pub/data/nccf/com/petss/prod/'

def request(url):
    req=urllib.request.Request(url,headers={'User-Agent':'MuirWoodsTideCheck (github.com/piochelepiotr/muir-woods-tide-check)'})
    with urllib.request.urlopen(req,timeout=45) as response:return response.read()

def parse_station(raw,cycle):
    rows=[]
    for row in csv.DictReader(io.StringIO(raw),skipinitialspace=True):
        timestamp=dt.datetime.strptime(row['TIME'],'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
        if timestamp<cycle:continue # archived analysis is not a forecast issued in advance
        fields={'mean':'TWL','lower':'TWL90p','upper':'TWL10p','tide':'TIDE','surge':'SURGE','bias':'BIAS'}
        item={'t':timestamp.isoformat()}
        for name,col in fields.items():
            try:v=float(row[col])
            except (ValueError,KeyError):v=9999
            item[name]=v if -50<v<50 else None
        if all(item[k] is not None for k in ['mean','lower','upper','tide']) and item['lower']<=item['upper']:
            rows.append(item)
    if len(rows)<24:raise ValueError('Insufficient P-ETSS forecast coverage')
    return rows

def fetch():
    dates=sorted(set(re.findall(r'href="petss\.(\d{8})/',request(BASE).decode())),reverse=True)
    if not dates:raise ValueError('No operational P-ETSS cycles listed')
    errors=[]
    for day in dates[:2]:
        directory=BASE+'petss.'+day+'/'
        cycles=sorted(set(re.findall(r'href="petss\.t(\d{2})z\.csv\.tar\.gz"',request(directory).decode())),reverse=True)
        for hour in cycles[:2]:
            url=directory+f'petss.t{hour}z.csv.tar.gz'
            cycle=dt.datetime.strptime(day+hour,'%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
            try:
                with tarfile.open(fileobj=io.BytesIO(request(url)),mode='r:gz') as archive:
                    name=next(m for m in archive.getmembers() if m.name.endswith('/9414290.csv') and m.isfile())
                    raw=archive.extractfile(name).read().decode()
                rows=parse_station(raw,cycle)
                return {'station':'9414290','units':'feet','datum':'MLLW','issuedAt':cycle.isoformat(),'points':rows,'sourceMember':name.name,'definition':'lower = TWL90p (90% exceedance / 10th percentile); upper = TWL10p (10% exceedance / 90th percentile). Ensemble spread, not road-clearance probability.'},url
            except Exception as exc:errors.append(str(exc))
    raise ValueError('No usable P-ETSS station product: '+'; '.join(errors[-2:]))

def main():
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    path=ROOT/'public/data/forecast.json'
    try:
        data,url=fetch();source={'ok':True,'url':url,'fetchedAt':now,'data':data}
        print(f'P-ETSS: {data["issuedAt"]}, {len(data["points"])} hourly forecast points')
    except Exception as exc:
        source={'ok':False,'url':BASE,'fetchedAt':now,'error':str(exc)}
        print('P-ETSS unavailable:',str(exc))
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(source,separators=(',',':'))+'\n')
if __name__=='__main__':main()
