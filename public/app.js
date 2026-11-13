import {TZ,HOUR,SHOULDER,LANES,parseNOAA,dateKey,dateLabel,timeLabel,pacificTime,addDays,points,valueAt,fresh,residual,forecastPoints,forecastAt,forecastFresh,assess,windows} from './model.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(v)?v.toFixed(2):'—';
const feet=v=>`${num(v)} <span>ft</span>`;
const stamp=t=>`${dateLabel(t)}, ${timeLabel(t)} PT`;
let sources={}, predictions=[],extremes=[],observations=[],ctx={},loading=false,chartState=null,evidence=null;
const historicalCache=new Map(),historicalPending=new Set();
let today=dateKey(Date.now());
$('trip-date').value=today;
$('trip-date').max=addDays(today,30);
function combine(arrays){return [...new Map(arrays.flat().map(p=>[p.t,p])).values()].sort((a,b)=>a.t-b.t);}
function sourcePoints(){
  const saved=[...historicalCache.values(),...(evidence?[evidence.sources]:[])];
  predictions=combine([points(sources.predictions),...saved.map(s=>points(s.predictions))]);
  extremes=combine([points(sources.extremes),...saved.map(s=>points(s.extremes))]);
  observations=combine([points(sources.observations,'data'),...saved.map(s=>points(s.observations,'data'))]);
}
function context(){const now=Date.now();return {predictions,sources,forecast:forecastPoints(sources.forecast),now,excess:residual(predictions,observations,now),margin:Number($('margin').value),drain:Number($('drain').value)};}
function metric(id,note,point){$(id).innerHTML=point?feet(point.v):'—';$(note).textContent=point?stamp(point.t):'No prediction available';}
function renderNow(){
  const now=ctx.now, risk=assess(now,ctx);
  $('now-time').textContent=timeLabel(now)+' PT';
  $('local-clock').textContent=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(now)+' · PACIFIC';
  $('now-title').textContent=risk.title;
  $('now-reason').textContent=risk.reason;
  $('now-pill').textContent=risk.level===3?'HIGH TIDE EXPOSURE':risk.level===1?'LOWER TIDE EXPOSURE':'CAUTION · VERIFY THE ROAD';
  const observed=observations.filter(p=>p.t<=now+5*60000&&!p.flags?.split(',').some(f=>f==='1')).at(-1);
  const usable=observed&&now-observed.t<=HOUR;
  $('observed').innerHTML=usable?feet(observed.v):'Unavailable';
  $('observed-note').textContent=observed?(usable?'Preliminary · ':'Stale · ')+stamp(observed.t):'NOAA gauge · not a road sensor';
  metric('next-high','high-note',extremes.find(p=>p.type==='H'&&p.t>now));
  metric('next-low','low-note',extremes.find(p=>p.type==='L'&&p.t>now));
  $('excess').innerHTML=ctx.excess?`${ctx.excess.v>=0?'+':''}${feet(ctx.excess.v)}`:'Unavailable';
  $('excess-note').textContent=ctx.excess?`Past-hour median · ${ctx.excess.count} quality-screened samples`:'No fresh quality-screened comparison';
}
function renderDays(){
  const selected=$('trip-date').value;
  $('day-tabs').innerHTML=Array.from({length:7},(_,i)=>{
    const day=addDays(today,i),t=pacificTime(day,'12:00');
    const peak=extremes.filter(p=>p.type==='H'&&dateKey(p.t)===day).sort((a,b)=>b.v-a.v)[0];
    return `<button type="button" class="day-tab ${selected===day?'active':''}" data-day="${day}" aria-pressed="${selected===day}"><span class="day-name">${i===0?'Today':i===1?'Tomorrow':new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short'}).format(t)}</span><strong>${new Intl.DateTimeFormat('en-US',{timeZone:TZ,month:'short',day:'numeric'}).format(t)}</strong><small>${peak?'High '+peak.v.toFixed(1)+' ft':'No tide data'}</small></button>`;
  }).join('');
  $('day-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('trip-date').value=b.dataset.day;selectDay();});
}
function renderTrip(){
  const day=$('trip-date').value;
  if(!day||!$('outbound').value||!$('return').value)return;
  const times=[$('outbound').value,$('return').value].map(t=>pacificTime(day,t));
  ['outbound','return'].forEach((id,i)=>{
    const risk=assess(times[i],ctx),el=$(id+'-result');
    el.className='crossing-result level-'+risk.level;
    const range=times[i]>=ctx.now&&forecastFresh(ctx)&&forecastAt(ctx.forecast,times[i])!==null;
    el.innerHTML=`<div class="mini-label">${i===0?'OUTBOUND · TOWARD MUIR WOODS':'RETURN · TOWARD SAN FRANCISCO'} · ${esc(timeLabel(times[i]))}</div><h3>${esc(risk.title)}</h3><p>${esc(risk.reason)}</p>${range?`<div class="result-height">NOAA ensemble at crossing: ${num(forecastAt(ctx.forecast,times[i],'lower'))}–${num(forecastAt(ctx.forecast,times[i],'upper'))} ft · mean ${num(forecastAt(ctx.forecast,times[i],'mean'))} ft</div>`:''}${risk.peak!==null?`<div class="result-height">Planning maximum in ±30 min: ${num(risk.peak)} ft MLLW · tide allowance ${num(risk.adjustment)} ft</div>`:''}`;
    if(i===1&&times[1]<=times[0]){el.className='crossing-result level-2';el.innerHTML='<div class="mini-label">RETURN CROSSING</div><h3>Choose a later return time</h3><p>This planner checks an outbound and return crossing on the same Pacific calendar day.</p>';}
  });
  const past=day<today;
  $('history-mode').hidden=!past;
  $('history-mode').textContent='HISTORICAL VIEW · Tide predictions and available gauge observations only. Today’s weather and road feeds are not used to verify past road conditions.';
  const available=past?[]:windows(day,ctx).filter(w=>w.end>=ctx.now);
  $('windows').innerHTML=past?'Historical road opening and drainage cannot be reconstructed from tide data alone.':available.length?available.map(w=>`<span class="window-chip">${esc(timeLabel(Math.max(w.start,Math.ceil(ctx.now/(15*60000))*15*60000)))} – ${esc(timeLabel(w.end))}</span>`).join(''):'No upcoming lower-exposure window passes all checks for this day.';
}
function renderChart(){
  const day=$('trip-date').value;
  if(!day)return;
  const start=pacificTime(day),end=pacificTime(addDays(day,1)),series=predictions.filter(p=>p.t>=start&&p.t<=end),svg=$('tide-chart');
  const usableForecast=forecastFresh(ctx),forecast=usableForecast?ctx.forecast.filter(p=>p.t>=start&&p.t<=end&&p.t>=ctx.now):[];
  const forecastPeak=forecast.toSorted((a,b)=>b.mean-a.mean)[0];
  $('uncertainty-status').textContent=forecastPeak?`NOAA total water at the modeled daily high: ${num(forecastPeak.lower)}–${num(forecastPeak.upper)} ft MLLW, mean ${num(forecastPeak.mean)} ft at ${timeLabel(forecastPeak.t)}. Shading is the 10th–90th percentile ensemble spread, not a road-open probability. Cycle ${stamp(Date.parse(sources.forecast.data.issuedAt))}.`:day<today?'Historical view: today’s ensemble is not an archived forecast for this date. The orange curve shows available observed water levels.':'No fresh official uncertainty band covers this date. A tide-plus-margin scenario is shown; lower-exposure windows remain unverified.';
  $('chart-title').textContent=dateLabel(pacificTime(day,'12:00'))+' · tide at San Francisco';
  if(!series.length){svg.innerHTML='<text x="500" y="140" text-anchor="middle" class="no-chart">No tide predictions available for this date</text>';svg.setAttribute('aria-label','No tide predictions available for this date');chartState=null;return;}
  const W=1000,H=285,L=42,R=18,T=15,B=36,plotW=W-L-R,plotH=H-T-B;
  const allowance=p=>Math.max(ctx.margin,p.t>=ctx.now-HOUR&&p.t<=ctx.now+6*HOUR&&ctx.excess?Math.max(0,ctx.excess.v):0);
  const maxY=Math.max(8,Math.ceil(Math.max(...series.map(p=>p.v+allowance(p)),...forecast.map(p=>p.upper))+1));
  const minY=Math.min(-1,Math.floor(Math.min(...series.map(p=>p.v)))-1);
  const x=t=>L+(t-start)/(end-start)*plotW,y=v=>T+(maxY-v)/(maxY-minY)*plotH;
  const line=(arr,adjust=false)=>arr.map((p,i)=>`${i&&p.t-arr[i-1].t<=12*60000?'L':'M'}${x(p.t).toFixed(2)},${y(p.v+(adjust?allowance(p):0)).toFixed(2)}`).join(' ');
  const base=line(series),adjusted=line(series,true),obs=observations.filter(p=>p.t>=start&&p.t<=end&&!p.flags?.split(',').some(f=>f==='1'));
  let out=`<defs><linearGradient id="tide-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#bad9d9" stop-opacity=".6"/><stop offset="1" stop-color="#edf3eb" stop-opacity=".3"/></linearGradient><clipPath id="plot-clip"><rect x="${L}" y="${T}" width="${plotW}" height="${plotH}"/></clipPath></defs>`;
  out+=`<rect x="${L}" y="${T}" width="${plotW}" height="${y(LANES)-T}" fill="#f6e9df"/><rect x="${L}" y="${y(LANES)}" width="${plotW}" height="${y(SHOULDER)-y(LANES)}" fill="#f8f0df"/>`;
  for(let v=Math.ceil(minY);v<=maxY;v+=1){out+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e8de" stroke-width="1"/><text x="${L-12}" y="${y(v)+4}" text-anchor="end" font-size="10" fill="#7a8b80">${v}</text>`;}
  for(let h=0;h<=24;h+=3){const t=h===24?end:pacificTime(day,String(h).padStart(2,'0')+':00');out+=`<text x="${x(t)}" y="${H-10}" text-anchor="middle" font-size="10" fill="#7a8b80">${h===0||h===24?'12 AM':h===12?'12 PM':h>12?(h-12)+' PM':h+' AM'}</text>`;}
  [SHOULDER,LANES].forEach((v,i)=>{out+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="${i?'#b67652':'#c5ac79'}" stroke-dasharray="4 5" stroke-width="1"/><text x="${W-R-8}" y="${y(v)-5}" text-anchor="end" font-size="9" fill="#9d6d44">${v.toFixed(1)} ft · ${i?'lanes':'shoulder'}</text>`;});
  const event=evidence?.events.find(e=>e.date===day&&e.start&&e.end);
  if(event){const a=Date.parse(event.start),b=Date.parse(event.end);out+=`<rect x="${x(a)}" y="${T}" width="${x(b)-x(a)}" height="${plotH}" fill="#ad5939" opacity=".1"/><text x="${(x(a)+x(b))/2}" y="${H-B-9}" text-anchor="middle" font-size="9" fill="#a05c3d">CALTRANS: APPROX. TIDE-IMPACT WINDOW</text>`;}
  const forecastLine=key=>forecast.map((p,i)=>`${i&&p.t-forecast[i-1].t<=1.1*HOUR?'L':'M'}${x(p.t).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ');
  const groups=[];for(const p of forecast){if(!groups.length||p.t-groups.at(-1).at(-1).t>1.1*HOUR)groups.push([]);groups.at(-1).push(p);}
  const band=groups.map(g=>g.map((p,i)=>`${i?'L':'M'}${x(p.t)},${y(p.upper)}`).join(' ')+g.toReversed().map(p=>`L${x(p.t)},${y(p.lower)}`).join(' ')+' Z').join(' ');
  out+=`<g clip-path="url(#plot-clip)"><path d="${base} L${x(series.at(-1).t)},${y(minY)} L${x(series[0].t)},${y(minY)} Z" fill="url(#tide-fill)"/><path d="${band}" fill="#749181" fill-opacity=".3"/><path d="${forecastLine('mean')}" fill="none" stroke="#476d55" stroke-width="2.5"/><path d="${forecastLine('upper')}" fill="none" stroke="#476d55" stroke-opacity=".55" stroke-width="1"/><path d="${adjusted}" fill="none" stroke="#8ba39b" stroke-width="1.8" stroke-dasharray="5 5"/><path d="${base}" fill="none" stroke="#2b6a72" stroke-width="2.5"/>${obs.length?`<path d="${line(obs)}" fill="none" stroke="#b96b42" stroke-width="2"/>`:''}</g>`;
  for(const [id,label] of [['outbound','OUT'],['return','BACK']]){const t=pacificTime(day,$(id).value||'12:00');const v=valueAt(predictions,t);if(v!==null){out+=`<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H-B}" stroke="#7f9483" stroke-dasharray="2 4"/><circle cx="${x(t)}" cy="${y(v)}" r="4" fill="#fffef8" stroke="#2b6a72" stroke-width="2"/><text x="${x(t)+6}" y="${T+12}" font-size="8" fill="#647d69">${label}</text>`;}}
  if(ctx.now>=start&&ctx.now<=end)out+=`<line x1="${x(ctx.now)}" x2="${x(ctx.now)}" y1="${T}" y2="${H-B}" stroke="#b96b42" opacity=".5"/><text x="${x(ctx.now)-5}" y="${H-B-6}" font-size="8" text-anchor="end" fill="#a25e3c">NOW</text>`;
  out+='<line id="hover-line" stroke="#173f44" stroke-opacity=".4" y1="15" y2="249" visibility="hidden"/>';
  svg.innerHTML=out;
  svg.setAttribute('aria-label',`NOAA San Francisco tide predictions for ${dateLabel(start)}, from ${Math.min(...series.map(p=>p.v)).toFixed(2)} to ${Math.max(...series.map(p=>p.v)).toFixed(2)} feet MLLW. Approximate historical shoulder flooding marker 5.6 feet, traffic lane marker 6.5 feet. Full high and low table below.`);
  chartState={start,end,L,plotW,W};
}
$('tide-chart').addEventListener('pointermove',e=>{
  if(!chartState)return;
  const {start,end,L,plotW,W}=chartState,rect=e.currentTarget.getBoundingClientRect();
  const px=(e.clientX-rect.left)/rect.width*W;
  const t=start+Math.max(0,Math.min(1,(px-L)/plotW))*(end-start),v=valueAt(predictions,t);
  if(v===null)return;
  const line=$('hover-line');line.setAttribute('x1',px);line.setAttribute('x2',px);line.setAttribute('visibility','visible');
  const upper=forecastFresh(ctx)&&t>=ctx.now?forecastAt(ctx.forecast,t):null;
  $('chart-tooltip').hidden=false;$('chart-tooltip').textContent=`${timeLabel(t)} · ${num(v)} ft tide${upper!==null?` · NOAA range ${num(forecastAt(ctx.forecast,t,'lower'))}–${num(upper)} ft`:''}`;
});
$('tide-chart').addEventListener('pointerleave',()=>{$('chart-tooltip').hidden=true;$('hover-line')?.setAttribute('visibility','hidden');});
function renderTable(){
  const day=$('trip-date').value;
  const events=extremes.filter(p=>dateKey(p.t)===day);
  $('tide-table-body').innerHTML=events.length?events.map(p=>{const i=extremes.indexOf(p),prior=extremes[i-1];return `<tr><td>${p.type==='H'?'↗ High tide':'↘ Low tide'}</td><td>${esc(timeLabel(p.t))} PT</td><td>${num(p.v)} ft</td><td>${prior?num(Math.abs(p.v-prior.v))+' ft '+(p.v>prior.v?'rise':'fall'):'—'}</td></tr>`;}).join(''):'<tr><td colspan="4">No high/low predictions available for this date.</td></tr>';
}
function renderConditions(){
  const now=ctx.now,alertSource=sources.alerts;
  const alerts=fresh(alertSource,now)?(alertSource.data?.features||[]).map(f=>f.properties).filter(p=>Date.parse(p.expires)>now):[];
  $('weather-title').textContent=!fresh(alertSource,now)?'Alert feed unavailable or stale':alerts.length?`${alerts.length} current weather ${alerts.length===1?'notice':'notices'}`:'No active alerts reported';
  $('weather-detail').innerHTML=alerts.map(p=>`<div class="report"><strong>${esc(p.event)}</strong><p>${esc(p.headline||p.description?.slice(0,450))}</p><time>Hazard: ${esc(stamp(Date.parse(p.onset||p.effective)))} – ${esc(stamp(Date.parse(p.ends||p.expires)))} · Bulletin expires ${esc(stamp(Date.parse(p.expires)))}</time><details><summary>Alert details ＋</summary><p>${esc(p.description)}</p><p>${esc(p.instruction)}</p></details></div>`).join('');
  if(!fresh(alertSource,now))$('weather-detail').innerHTML='<p>Current alerts could not be verified. Follow the NWS link for an official update.</p>';
  const periods=fresh(sources.weather,now)?sources.weather.data?.properties?.periods||[]:[];
  const nearest=periods.find(p=>Date.parse(p.endTime)>now);
  $('weather-detail').innerHTML+=nearest?`<p>Next hour: ${esc(nearest.shortForecast)} · rain chance ${nearest.probabilityOfPrecipitation?.value??'unknown'}${nearest.probabilityOfPrecipitation?.value!=null?'%':''} · wind ${esc(nearest.windSpeed)} ${esc(nearest.windDirection)}. Rain chance is not a runoff or drainage model.</p>`:'<p>Hourly weather is unavailable or stale.</p>';
  const incidentSource=sources.incidents,incidents=fresh(incidentSource,now)?incidentSource.data||[]:[];
  const roadGood=['incidents','road1','road101'].every(k=>fresh(sources[k],now));
  $('road-title').textContent=!roadGood?'Road status needs verification':incidents.length?`${incidents.length} nearby CHP ${incidents.length===1?'report':'reports'}`:'No nearby CHP incidents in this feed';
  const roadReports=['road1','road101'].flatMap(k=>fresh(sources[k],now)?(sources[k].data||[]).map(text=>({text,k})):[]);
  $('road-detail').innerHTML=incidents.map(p=>`<div class="report"><p>${esc(p.text)}</p></div>`).join('')+roadReports.map(p=>`<div class="report"><strong>${p.k==='road1'?'SR‑1':'US‑101'} · Marin report</strong><p>${esc(p.text)}</p></div>`).join('');
  $('road-detail').innerHTML+=`<p>${!roadGood?'Some feeds are missing or older than 90 minutes. ':''}A missing incident is not confirmation that the ramp is open. Temporary traffic controls may not appear in these feeds. Check QuickMap immediately before departure.</p>`;
  const names={predictions:'NOAA 6-minute predictions',extremes:'NOAA high / low tides',observations:'NOAA observed levels',forecast:'NOAA P-ETSS ensemble',alerts:'NWS active alerts',weather:'NWS hourly forecast',incidents:'QuickMap / CHP incidents',road1:'Caltrans SR‑1 reports',road101:'Caltrans US‑101 reports'};
  $('source-health').innerHTML='<div class="table-scroll"><table class="health-table"><caption>Data retrieval timestamps · Pacific time</caption><thead><tr><th>Source</th><th>State</th><th>Retrieved</th></tr></thead><tbody>'+Object.entries(names).map(([k,label])=>{const s=sources[k],valid=k==='predictions'||k==='extremes'?s?.ok:k==='forecast'?forecastFresh(ctx):fresh(s,now);return `<tr><td>${s?.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener">${label} ↗</a>`:label}</td><td class="${valid?'health-good':'health-bad'}">${valid?(k==='predictions'||k==='extremes'?'Date-based prediction':'Fresh retrieval'):(s?.ok?'Stale':'Unavailable')}${s?.error?' · '+esc(s.error):''}</td><td>${s?.fetchedAt?esc(stamp(Date.parse(s.fetchedAt))):'—'}</td></tr>`;}).join('')+'</tbody></table></div>';
}
function render(){ctx=context();renderNow();renderDays();renderTrip();renderChart();renderTable();renderConditions();renderEvidence();}
async function json(url){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.error)throw new Error(data.error.message||'NOAA data unavailable');return data;}
async function load(){
  if(loading)return;loading=true;$('refresh').disabled=true;$('refresh').textContent='↻ Refreshing';
  try{
    const snapshot=await json('./data/snapshot.json?t='+Date.now());
    const priorForecast=sources.forecast;sources=snapshot.sources||{};if(priorForecast)sources.forecast=priorForecast;sourcePoints();render();
  }catch(e){$('load-state').textContent='Stored road reports could not be loaded. Fetching NOAA and weather directly…';}
  try{sources.forecast=await json('./data/forecast.json?t='+Date.now());}catch(e){sources.forecast={ok:false,error:'Probabilistic forecast could not be loaded'};}
  const base='https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?',common='station=9414290&datum=MLLW&units=english&time_zone=gmt&format=json&application=MuirWoodsTideCheck';
  const start=addDays(today,-2).replaceAll('-',''),end=addDays(today,32).replaceAll('-','');
  const utcQuery=t=>new Date(t).toISOString().slice(0,16).replaceAll('-','').replace('T',' ');
  const observationRange=new URLSearchParams({begin_date:utcQuery(Date.now()-3*HOUR),end_date:utcQuery(Date.now())});
  const urls={predictions:base+common+`&product=predictions&interval=6&begin_date=${start}&end_date=${end}`,extremes:base+common+`&product=predictions&interval=hilo&begin_date=${start}&end_date=${end}`,observations:base+common+'&product=water_level&'+observationRange,alerts:'https://api.weather.gov/alerts/active?zone=CAZ505,CAZ506',weather:'https://api.weather.gov/gridpoints/MTR/82,110/forecast/hourly'};
  await Promise.allSettled(Object.entries(urls).map(async([k,url])=>{try{const data=await json(url);if(['predictions','extremes'].includes(k)&&!data.predictions?.length)throw new Error('Missing predictions');if(k==='observations'&&!data.data?.length)throw new Error('Missing observations');if(k==='alerts'&&!Array.isArray(data.features))throw new Error('Missing alerts');if(k==='weather'&&!data.properties?.periods?.length)throw new Error('Missing forecast');sources[k]={ok:true,url,fetchedAt:new Date().toISOString(),data};}catch(e){if(!sources[k]?.ok)sources[k]={ok:false,url,error:e.message};}}));
  sourcePoints();render();
  const stale=['observations','forecast','alerts','weather','incidents','road1','road101'].filter(k=>!fresh(sources[k],Date.now()));
  $('load-state').textContent=!predictions.length?'Tide predictions are unavailable. Use the NOAA and Caltrans links directly.':stale.length?'Some current feeds are unavailable or stale. Planning checks remain cautious; inspect source freshness below.':'NOAA & weather refreshed · Road reports from the scheduled snapshot · All times Pacific';
  loading=false;$('refresh').disabled=false;$('refresh').textContent='↻ Refresh data';
}
async function selectDay(){
  render();
  const day=$('trip-date').value;
  if(!day||historicalPending.has(day))return;
  const start=pacificTime(day),end=pacificTime(addDays(day,1));
  const hasPrediction=valueAt(predictions,start-5*HOUR)!==null&&valueAt(predictions,end)!==null;
  if(hasPrediction&&(day>=today||observations.some(p=>p.t>=start&&p.t<end)))return;
  historicalPending.add(day);
  $('history-mode').hidden=false;$('history-mode').textContent=`Fetching NOAA tide records for ${day}…`;
  const base='https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9414290&datum=MLLW&units=english&time_zone=gmt&format=json&application=MuirWoodsTideCheck';
  const range=`&begin_date=${addDays(day,-2).replaceAll('-','')}&end_date=${addDays(day,2).replaceAll('-','')}`;
  const products={predictions:'predictions&interval=6',extremes:'predictions&interval=hilo',...(day<today?{observations:'water_level'}:{})};
  const cached={};
  await Promise.allSettled(Object.entries(products).map(async([k,product])=>{
    const url=base+range+'&product='+product;
    try{const data=await json(url);cached[k]={ok:true,data,url,fetchedAt:new Date().toISOString()};}catch(e){cached[k]={ok:false,error:e.message,url};}
  }));
  historicalCache.set(day,cached);historicalPending.delete(day);sourcePoints();render();
  if($('trip-date').value===day&&!cached.predictions?.ok){$('history-mode').hidden=false;$('history-mode').textContent='NOAA predictions could not be retrieved for this historical date. No road-condition conclusion can be drawn.';}
}
function renderEvidence(){
  if(!evidence){$('evidence-body').textContent='Loading documented tide-impact dates…';return;}
  const pred=points(evidence.sources.predictions),obs=points(evidence.sources.observations,'data').filter(p=>!p.flags?.split(',').some(f=>f==='1'));
  $('evidence-body').innerHTML='<div class="table-scroll"><table><caption>Independently documented impacts · NOAA gauge is about 7 miles from the connector</caption><thead><tr><th>Date</th><th>Caltrans report</th><th>Predicted daily high</th><th>Observed daily high</th><th>Inspect</th></tr></thead><tbody>'+evidence.events.map(e=>{
    const p=pred.filter(p=>dateKey(p.t)===e.date),o=obs.filter(p=>dateKey(p.t)===e.date);
    return `<tr><td>${esc(e.date)}</td><td>${e.start?'Approx. 1–6:30 PM tide impact':'Tide impact · time unspecified'}</td><td>${p.length?num(Math.max(...p.map(v=>v.v)))+' ft':'Unavailable'}</td><td>${o.length?num(Math.max(...o.map(v=>v.v)))+' ft':'Unavailable'}</td><td><button type="button" class="quiet-button evidence-day" data-day="${e.date}">View tides ↗</button></td></tr>`;
  }).join('')+'</tbody></table></div><p class="evidence-limit"><strong>Why tide alone is insufficient:</strong> on these days, observed gauge highs were about 1.5 ft above astronomical predictions. The default +0.5 ft scenario would understate that excess. Neither a fixed margin nor these three cases validates road clearance.</p><p class="evidence-limit">Three reported tide-affected days are useful case checks, but do not establish exact closure/reopening times or known-open periods. No accuracy percentage or calibrated drainage time is claimed. Observed highs use available quality-screened gauge samples and may miss the true peak.</p>';
  $('evidence-body').querySelectorAll('.evidence-day').forEach(b=>b.onclick=()=>{$('trip-date').value=b.dataset.day;selectDay();$('planner').scrollIntoView({behavior:'smooth'});});
}
for(const id of ['trip-date','outbound','return','margin','drain'])$(id).addEventListener('change',()=>{
  if(!$('trip-date').validity.valid||!$('outbound').validity.valid||!$('return').validity.valid)return;
  if(id==='trip-date')selectDay();else render();
});
$('refresh').onclick=load;
$('download').onclick=()=>{
  const day=$('trip-date').value;
  const rows=predictions.filter(p=>dateKey(p.t)===day).map(p=>`${new Date(p.t).toISOString()},${dateKey(p.t)} ${timeLabel(p.t)} PT,${p.v}`);
  const blob=new Blob(['UTC,Pacific time,Predicted feet MLLW (NOAA 9414290)\n'+rows.join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='manzanita-noaa-tides-'+day+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
load();
json('./data/evidence.json').then(data=>{evidence=data;sourcePoints();render();}).catch(()=>{$('evidence-body').textContent='Historical evidence could not be loaded. No validation score is available.';});
json('./data/history/index.json').then(data=>{const count=data.days.reduce((n,d)=>n+d.checks,0);$('archive-status').textContent=`${count} timestamped feed ${count===1?'check':'checks'} saved across ${data.days.length} ${data.days.length===1?'day':'days'}. These are reports, not confirmed-open observations.`;}).catch(()=>{$('archive-status').textContent='The archive will start with the first scheduled deployment. No confirmed-open observations are available.';});
setInterval(()=>{const nextDay=dateKey(Date.now());if(nextDay!==today){today=nextDay;$('trip-date').max=addDays(today,30);}load();},5*60000);
setInterval(()=>{if(predictions.length)render();},60000);
