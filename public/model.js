export const TZ = 'America/Los_Angeles';
export const HOUR = 3600000;
export const SHOULDER = 5.6;
export const LANES = 6.5;
export const parseNOAA = t => Date.parse(t.replace(' ', 'T') + 'Z');
export const dateKey = t => new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
export const timeLabel = t => new Intl.DateTimeFormat('en-US', {timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(t);
export const dateLabel = t => new Intl.DateTimeFormat('en-US', {timeZone:TZ,weekday:'short',month:'short',day:'numeric'}).format(t);
export function pacificTime(day, clock='00:00') {
  const target = Date.parse(`${day}T${clock}:00Z`);
  let candidate = target;
  for (let i=0; i<4; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(candidate).map(p=>[p.type,p.value]));
    const actual = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    const diff = target-actual;
    if (!diff) break;
    candidate += diff;
  }
  return candidate;
}
export function addDays(day, n) { return new Date(Date.parse(day+'T12:00:00Z')+n*24*HOUR).toISOString().slice(0,10); }
export function points(source, field='predictions') {
  return (source?.ok ? source.data?.[field] || [] : []).filter(p=>p.v!==null&&p.v!==undefined&&String(p.v).trim()!=='').map(p=>({t:parseNOAA(p.t),v:Number(p.v),type:p.type,flags:p.f})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.v)&&p.v>-20&&p.v<30).sort((a,b)=>a.t-b.t);
}
export function valueAt(series,t) {
  if (!series.length || t<series[0].t || t>series.at(-1).t) return null;
  let lo=0,hi=series.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(series[m].t<=t)lo=m;else hi=m;}
  const a=series[lo],b=series[hi];
  if(b.t-a.t>12*60000) return null;
  return a.v+(b.v-a.v)*(t-a.t)/(b.t-a.t || 1);
}
export function fresh(source, now, maxHours=1.5) {
  const age=now-Date.parse(source?.fetchedAt);
  return !!source?.ok && Number.isFinite(age) && age>=-5*60000 && age<=maxHours*HOUR;
}
export function residual(predictions, observations, now) {
  const matches=observations.filter(p=>p.t<=now+5*60000&&p.t>=now-HOUR&&!p.flags?.split(',').some(f=>f==='1')).map(p=>({t:p.t,d:p.v-(valueAt(predictions,p.t)??NaN)})).filter(p=>Number.isFinite(p.d));
  if(matches.length<3 || now-matches.at(-1).t>30*60000) return null;
  const sorted=matches.map(p=>p.d).sort((a,b)=>a-b);
  return {v: sorted[Math.floor(sorted.length/2)],t:matches.at(-1).t,count:matches.length};
}
export function forecastPoints(source){
  if(!source?.ok||source.data?.datum!=='MLLW'||source.data?.units!=='feet'||source.data?.station!=='9414290')return [];
  return (source.data.points||[]).map(p=>({...p,t:Date.parse(p.t)})).filter(p=>Number.isFinite(p.t)&&['lower','mean','upper'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<50)&&p.lower<=p.upper).sort((a,b)=>a.t-b.t);
}
export function forecastAt(series,t,key='upper'){
  if(!series?.length||t<series[0].t||t>series.at(-1).t)return null;
  let lo=0,hi=series.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(series[m].t<=t)lo=m;else hi=m;}
  const a=series[lo],b=series[hi];
  if(a.t===t)return a[key];
  if(b.t===t)return b[key];
  if(b.t-a.t>1.1*HOUR)return null;
  return a[key]+(b[key]-a[key])*(t-a.t)/(b.t-a.t||1);
}
export function forecastFresh(ctx){
  const issue=Date.parse(ctx.sources.forecast?.data?.issuedAt),age=ctx.now-issue;
  return fresh(ctx.sources.forecast,ctx.now)&&Number.isFinite(age)&&age>=-5*60000&&age<=18*HOUR;
}
export function assess(t,ctx) {
  const {predictions, sources, now, margin=.5, drain=2}=ctx;
  // An observation-based excess is a near-term scenario, never a surge forecast.
  const near=t>=now-HOUR && t<=now+6*HOUR;
  const adjustment=Math.max(margin,near&&ctx.excess?Math.max(0,ctx.excess.v):0);
  const start=t-.5*HOUR,end=t+.5*HOUR;
  const sample=predictions.filter(p=>p.t>=start&&p.t<=end);
  for(const endpoint of [start,end]){const v=valueAt(predictions,endpoint);if(v!==null)sample.push({t:endpoint,v});}
  const useForecast=t>=now-.5*HOUR&&forecastFresh(ctx);
  const water=p=>Math.max(p.v+adjustment,useForecast?(forecastAt(ctx.forecast,p.t)??-Infinity):-Infinity);
  const peak=sample.length?Math.max(...sample.map(water)):null;
  if(valueAt(predictions,start)===null||valueAt(predictions,end)===null||peak===null) return {level:2,title:'Tide data unavailable',reason:'This crossing is outside the available prediction coverage.',peak:null,adjustment};
  if(peak>=LANES) return {level:3,title:'Avoid this tide window',reason:useForecast?'The higher of NOAA’s upper forecast bound and your tide scenario reaches the historical traffic-lane marker.':'The planning water level reaches the historical traffic-lane flooding marker.',peak,adjustment};
  if(peak>=SHOULDER) return {level:2,title:'Elevated tide exposure',reason:useForecast?'The higher of NOAA’s upper forecast bound and your tide scenario reaches the historical shoulder marker.':'The planning water level reaches the historical shoulder flooding marker.',peak,adjustment};
  const historyStart=start-drain*HOUR;
  const coverage=predictions.filter(p=>p.t>=historyStart&&p.t<=end);
  if(valueAt(predictions,historyStart)===null||coverage.some((p,i)=>i&&p.t-coverage[i-1].t>12*60000))return {level:2,title:'Tide data incomplete',reason:'A gap in the prediction or clearance-buffer history prevents a lower-exposure result.',peak,adjustment};
  const recent=predictions.some(p=>p.t>=start-drain*HOUR&&p.t<start&&water(p)>=SHOULDER);
  if(recent) return {level:2,title:'Allow more clearance time',reason:`Water was above the shoulder marker within your ${drain}-hour clearance buffer. Drainage and reopening are unverified.`,peak,adjustment};
  if(t<now-.5*HOUR)return {level:2,title:'Historical tide only',reason:'The tide scenario is below the historical markers. Archived road clearance, weather and drainage have not been verified for this time.',peak,adjustment};
  if(!useForecast||forecastAt(ctx.forecast,historyStart)===null||forecastAt(ctx.forecast,end)===null||coverage.some(p=>forecastAt(ctx.forecast,p.t)===null))return {level:2,title:'Total-water forecast unavailable',reason:'No fresh official uncertainty range covers this entire crossing and clearance buffer. Astronomical tide alone cannot verify this window.',peak,adjustment};
  // Official flood alerts are applied only during their stated validity period.
  const alerts=fresh(sources.alerts,now)?(sources.alerts.data?.features||[]).map(f=>f.properties).filter(p=>/flood|tsunami/i.test(p.event)&&Date.parse(p.onset||p.effective)<=end&&Date.parse(p.ends||p.expires)>=start):[];
  if(alerts.length) return {level:2,title:'Flood alert in effect',reason:alerts.map(a=>a.event).join(' · ')+'. A low astronomical tide does not resolve this alert.',peak,adjustment};
  const weather=fresh(sources.weather,now)?sources.weather.data?.properties?.periods?.filter(p=>Date.parse(p.startTime)<=end&&Date.parse(p.endTime)>=start)||[]:[];
  if(weather.some(p=>/rain|shower|thunder/i.test(p.shortForecast)||Number(p.probabilityOfPrecipitation?.value)>=50))return {level:2,title:'Rain may slow drainage',reason:'Rain or a high precipitation chance is forecast around this crossing. Tide alone is insufficient.',peak,adjustment};
  const roadSources=['incidents','road1','road101'];
  const reports=roadSources.filter(k=>fresh(sources[k],now)).flatMap(k=>sources[k].data||[]).map(p=>typeof p==='string'?p:p.text);
  if(near&&reports.some(p=>/flood|closed|closure|blocked/i.test(p))) return {level:2,title:'Review current road reports',reason:'A nearby road or incident report mentions flooding, closure, or a blockage. Check its location in QuickMap.',peak,adjustment};
  const missing=['alerts','weather',...roadSources].filter(k=>!fresh(sources[k],now));
  if(missing.length || !weather.length || (near&&!ctx.excess))return {level:2,title:'Conditions need checking',reason:missing.length?'Some current weather or road feeds are missing or stale.':!weather.length?'Hourly weather does not cover this crossing yet.':'A recent, quality-screened observed tide comparison is unavailable.',peak,adjustment};
  return {level:1,title:'Lower tide exposure',reason:'Tide and weather checks show no modeled trigger in this crossing window. Confirm the connector is open before leaving.',peak,adjustment};
}
export function windows(day,ctx) {
  const start=pacificTime(day,'06:00'),end=pacificTime(day,'21:00'),step=15*60000,out=[];
  let active=null;
  for(let t=start;t<=end;t+=step){
    const a=assess(t,ctx);
    if(a.level===1){if(!active)active={start:t,end:t};else active.end=t;}
    else if(active){if(active.end-active.start>=30*60000)out.push(active);active=null;}
  }
  if(active&&active.end-active.start>=30*60000)out.push(active);
  return out;
}
