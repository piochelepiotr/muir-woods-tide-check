import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR,parseNOAA,pacificTime,dateKey,points,valueAt,residual,assess,windows} from '../public/model.js';
const now=Date.parse('2026-11-12T18:00:00Z');
function fixture(height=3){
  const predictions=Array.from({length:1001},(_,i)=>({t:now-25*HOUR+i*6*60000,v:height}));
  const source={ok:true,fetchedAt:new Date(now).toISOString(),data:[]};
  const sources=Object.fromEntries(['incidents','road1','road101','alerts','weather'].map(k=>[k,{...source}]));
  sources.alerts.data={features:[]};
  sources.weather.data={properties:{periods:[{startTime:new Date(now-30*HOUR).toISOString(),endTime:new Date(now+70*HOUR).toISOString(),shortForecast:'Sunny',probabilityOfPrecipitation:{value:0}}]}};
  return {predictions,sources,now,excess:{v:.2,t:now,count:8},margin:.5,drain:2};
}
test('NOAA times are interpreted as UTC independently of the machine timezone',()=>assert.equal(parseNOAA('2026-11-12 18:00'),now));
test('Pacific winter and summer clock conversion and date boundaries',()=>{
 assert.equal(pacificTime('2026-11-12','10:00'),now);
 assert.equal(pacificTime('2026-07-12','10:00'),Date.parse('2026-07-12T17:00:00Z'));
 assert.equal(dateKey(Date.parse('2026-11-13T03:00:00Z')),'2026-11-12');
 assert.equal(pacificTime('2026-11-02')-pacificTime('2026-11-01'),25*HOUR);
 assert.equal(pacificTime('2026-03-09')-pacificTime('2026-03-08'),23*HOUR);
});
test('unavailable and nonnumeric NOAA data do not become zero water',()=>{
 assert.deepEqual(points({ok:false,data:{predictions:[{t:'2026-11-12 18:00',v:'3'}]}}),[]);
 assert.deepEqual(points({ok:true,data:{predictions:[{t:'2026-11-12 18:00',v:'bad'}]}}),[]);
 assert.deepEqual(points({ok:true,data:{predictions:[{t:'2026-11-12 18:00',v:''},{t:'2026-11-12 18:06',v:null}]}}),[]);
});
test('interpolation refuses large gaps and out-of-range timestamps',()=>{
 const series=[{t:now,v:1},{t:now+6*60000,v:3}];
 assert.equal(valueAt(series,now+3*60000),2);
 assert.equal(valueAt(series,now-1),null);
 assert.equal(valueAt([{t:now,v:1},{t:now+HOUR,v:3}],now+60000),null);
});
test('risk markers include the planning allowance and never mean road clearance',()=>{
 assert.equal(assess(now,fixture(3)).level,1);
 assert.equal(assess(now,fixture(5.1)).level,2);
 assert.equal(assess(now,fixture(6)).level,3);
 assert.match(assess(now,fixture(3)).reason,/Confirm the connector is open/);
});
test('large positive observed excess raises near-term exposure; negative excess cannot lower margin',()=>{
 const ctx=fixture(5);ctx.excess.v=1.6;
 assert.equal(assess(now,ctx).level,3);
 ctx.excess.v=-2;
 assert.equal(assess(now,ctx).adjustment,.5);
 assert.equal(assess(now+7*HOUR,ctx).adjustment,.5);
});
test('clearance buffer retains caution after falling water',()=>{
 const ctx=fixture();ctx.predictions.find(p=>p.t===now-HOUR).v=6;
 assert.match(assess(now,ctx).title,/clearance/);
 ctx.drain=.1;assert.equal(assess(now,ctx).level,1);
});
test('current flood alert, rainfall and local closure wording prevent lower exposure',()=>{
 const a=fixture();a.sources.alerts.data.features=[{properties:{event:'Coastal Flood Advisory',onset:new Date(now-HOUR).toISOString(),expires:new Date(now+HOUR).toISOString()}}];assert.equal(assess(now,a).level,2);
 const b=fixture();b.sources.weather.data.properties.periods[0].shortForecast='Rain Showers';assert.equal(assess(now,b).level,2);
 const c=fixture();c.sources.incidents.data=[{text:'Flooding on connector ramp, closed'}];assert.equal(assess(now,c).level,2);
});
test('expired alerts do not affect a later crossing',()=>{
 const ctx=fixture();ctx.sources.alerts.data.features=[{properties:{event:'Flood Warning',onset:new Date(now-3*HOUR).toISOString(),expires:new Date(now-2*HOUR).toISOString()}}];assert.equal(assess(now,ctx).level,1);
});
test('stale or missing feeds, missing observations and out-of-range weather fail cautiously',()=>{
 const stale=fixture();stale.sources.road1.fetchedAt=new Date(now-2*HOUR).toISOString();assert.equal(assess(now,stale).level,2);
 const missing=fixture();delete missing.sources.alerts;assert.equal(assess(now,missing).level,2);
 const obs=fixture();obs.excess=null;assert.equal(assess(now,obs).level,2);
 const weather=fixture();weather.sources.weather.data.properties.periods=[];assert.equal(assess(now,weather).level,2);
 assert.equal(assess(now+200*HOUR,fixture()).level,2);
});
test('quality flags and stale observations are excluded from residual',()=>{
 const predictions=fixture().predictions;
 const observations=[0,1,2,3].map(i=>({t:now-i*6*60000,v:4,flags:'0,0,0,0'})).reverse();
 assert.equal(residual(predictions,observations,now).v,1);
 assert.equal(residual(predictions,observations.map(p=>({...p,flags:'1,0,0,0'})),now),null);
 assert.equal(residual(predictions,observations,now+2*HOUR),null);
});
test('planning windows disappear when required feeds are stale',()=>{
 const ctx=fixture();assert.ok(windows('2026-11-12',ctx).length);
 ctx.sources.incidents.ok=false;assert.deepEqual(windows('2026-11-12',ctx),[]);
});
test('historical checks never reuse current road or weather reports as historical evidence',()=>{
 const ctx=fixture();ctx.sources.incidents.data=[{text:'Road closed due to flooding now'}];
 const result=assess(now-12*HOUR,ctx);
 assert.equal(result.title,'Historical tide only');
 assert.match(result.reason,/Archived road clearance/);
});
test('a missing interval inside the clearance history prevents a lower-exposure result',()=>{
 const ctx=fixture();ctx.predictions=ctx.predictions.filter(p=>p.t<now-1.5*HOUR||p.t>now-HOUR);
 assert.equal(assess(now,ctx).title,'Tide data incomplete');
});
