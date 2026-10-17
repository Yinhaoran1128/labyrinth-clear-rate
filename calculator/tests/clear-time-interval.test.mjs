import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../clear-time-interval.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function interval(stats) {assert.equal(typeof api.clearTimeInterval,'function');return api.clearTimeInterval(stats);}
function moments(rows) {
  const n=rows.length,total=rows.reduce((s,[d])=>s+d,0),wins=rows.reduce((s,[,w])=>s+w,0),mean=total/n,p=wins/n;
  return {trials:n,successes:wins,totalSpentSeconds:total,
    durationSquaredSeconds:rows.reduce((s,[d])=>s+d*d,0),successSpentSeconds:rows.reduce((s,[d,w])=>s+d*w,0),
    durationMeanSeconds:mean,durationM2SecondsSquared:rows.reduce((s,[d])=>s+(d-mean)**2,0),
    durationSuccessComomentSeconds:rows.reduce((s,[d,w])=>s+(d-mean)*(w-p),0)};
}
const mixed=()=>moments(Array.from({length:100},(_,i)=>[[10,1],[20,1],[30,0],[40,0]][i%4]));
test('Fieller interval uses paired covariance and agrees with an independent quadratic reference',()=>{
  const stats=mixed(),out=interval(stats),t=1.9842169515086827;
  const a=.25-t*t*25/9900,b=12.5-t*t*(-500)/9900,c=625-t*t*12500/9900;
  const d=Math.sqrt(b*b-a*c);
  assert.equal(out.status,'bounded');assert.equal(out.confidenceLevel,.95);
  assert.ok(Math.abs(out.lower-(b-d)/a)<1e-5);
  assert.ok(Math.abs(out.upper-(b+d)/a)<1e-5);
  assert.ok(out.lower<50 && out.upper>50);
  assert.notEqual(interval({...stats,durationSuccessComomentSeconds:0}).upper,out.upper);
});
test('all-success samples retain uncertainty in unobserved failures, even for constant durations',()=>{
  const out=interval(moments(Array.from({length:300},()=>[20,1])));
  const radius=120*Math.sqrt(Math.log(80)/600),pLower=Math.pow(.025,1/300);
  assert.equal(out.method,'hoeffding-binomial');
  assert.equal(out.status,'bounded');
  assert.ok(Math.abs(out.lower-(20-radius))<1e-10);
  assert.ok(Math.abs(out.upper-(20+radius)/pLower)<1e-10);
  // A population with rare, long failures must not be excluded just because
  // this sample contains only identical wins (about 74% likely here).
  const trueTime=(.999*20+.001*120)/.999;
  assert.ok(out.lower<trueTime && out.upper>trueTime);
  const atCap=interval(moments([[120,1],[120,1]]));
  assert.ok(atCap.upper>=120 && atCap.lower>=0);
  assert.equal(interval(moments([[121,1],[121,1]])).status,'invalid_statistics');
});
test('rare successes allow an infinite upper bound; zero successes and n=1 have explicit unavailable states',()=>{
  const out=interval(moments(Array.from({length:100},(_,i)=>[i===0?10:120,i===0?1:0])));
  assert.equal(out.status,'unbounded');assert.equal(out.upper,Infinity);assert.ok(out.lower>=0);
  assert.equal(interval(moments([[120,0],[120,0]])).status,'no_success');
  assert.equal(interval(moments([[20,1]])).status,'insufficient');
});
test('raw duration moments give the same result; stable centered moments take precedence',()=>{
  const s=mixed(),expected=interval(s),{durationM2SecondsSquared,durationSuccessComomentSeconds,...raw}=s;
  assert.ok(Math.abs(interval(raw).upper-expected.upper)<1e-8);
  const high=moments(Array.from({length:100},(_,i)=>[1e9+(i%2),i%2]));
  const out=interval({...high,durationSquaredSeconds:0,successSpentSeconds:0});
  assert.equal(out.status,'bounded');assert.ok(out.lower<2e9+1 && out.upper>2e9+1);
});
test('missing, invalid and inconsistent moments never produce a misleading finite interval',()=>{
  assert.equal(interval({trials:100,successes:50,totalSpentSeconds:1000}).status,'missing_statistics');
  for(const patch of [{successes:101},{trials:1.5},{durationM2SecondsSquared:-10},
    {durationSuccessComomentSeconds:1e10},{totalSpentSeconds:NaN}]) {
    assert.equal(interval({...mixed(),...patch}).status,'invalid_statistics');
  }
});
test('critical values and localized formatting cover bounded, unbounded and unavailable results',()=>{
  assert.ok(Math.abs(api.studentTCritical95(1)-12.706204736432095)<1e-10);
  assert.ok(Math.abs(api.studentTCritical95(99)-1.9842169515086827)<1e-6);
  assert.match(api.formatClearTimeInterval(interval(mixed()),'zh'),/秒/);
  assert.match(api.formatClearTimeInterval({status:'unbounded',lower:10,upper:Infinity},'en'),/∞/);
  assert.match(api.formatClearTimeInterval({status:'no_success'},'zh'),/无成功/);
  assert.match(api.formatClearTimeInterval({status:'insufficient'},'en'),/Insufficient/);
});
