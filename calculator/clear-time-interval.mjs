// Approximate paired Fieller confidence interval for E[duration]/P(success).
// https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/ratimean.htm
// These are pointwise simulation intervals, not intervals for the PAVA fit.
const T95 = [0,12.706204736432095,4.302652729696142,3.182446305284263,2.776445105197799,
  2.570581835636314,2.446911848791681,2.364624251010299,2.306004135204166,2.262157162740992,
  2.228138851964939,2.200985160082949,2.178812829663418,2.160368656461013,2.144786687916927,
  2.131449545559323,2.119905299221011,2.109815577833181,2.10092204024096,2.093024054408263,
  2.085963447265836,2.079613844727662,2.073873067904015,2.068657610419041,2.063898561628021,
  2.059538552753294,2.055529438642871,2.051830516480283,2.048407141795244,2.045229642132703,
  2.042272456301238];
export function studentTCritical95(df) {
  if (!Number.isInteger(df) || df<1) throw new Error('Degrees of freedom must be positive');
  if (df<T95.length) return T95[df];
  // Inverse-t expansion through df^-4; df>=31, error below 1e-6.
  const z=1.959963984540054;
  return z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df**2)
    +(3*z**7+19*z**5+17*z**3-15*z)/(384*df**3)
    +(79*z**9+776*z**7+1482*z**5-1920*z**3-945*z)/(92160*df**4);
}
const base={confidenceLevel:.95,method:'fieller-t',approximate:true};
export function clearTimeInterval(stats={}) {
  const {trials:n,successes:k,totalSpentSeconds:total}=stats;
  const unavailable=status=>({...base,status,lower:null,upper:null});
  if (!Number.isSafeInteger(n) || n<1 || !Number.isSafeInteger(k) || k<0 || k>n ||
      !Number.isFinite(total) || total<0) return unavailable('invalid_statistics');
  if (k===0) return unavailable('no_success');
  if (n<2) return unavailable('insufficient');
  const mean=total/n,p=k/n,syy=n*p*(1-p);
  let m2=stats.durationM2SecondsSquared,co=stats.durationSuccessComomentSeconds;
  if (m2===undefined || co===undefined) {
    if (!Number.isFinite(stats.durationSquaredSeconds) || !Number.isFinite(stats.successSpentSeconds))
      return unavailable('missing_statistics');
    // Fallback for exported raw moments. Prefer Welford fields whenever available.
    m2=stats.durationSquaredSeconds-total*mean;
    co=stats.successSpentSeconds-total*p;
  }
  if (!Number.isFinite(m2) || !Number.isFinite(co) || m2<0 ||
      co*co>m2*syy+1e-8*Math.max(1,m2*syy)) return unavailable('invalid_statistics');
  if (k===n) {
    // Plug-in Fieller loses all uncertainty about P(success) at this boundary.
    // Use the strict [0,120] duration bound instead. Allocate alpha=.025 to
    // a two-sided Hoeffding mean interval and .025 to the exact one-sided
    // all-success binomial bound; the union bound needs no T/I independence.
    if (mean>120) return unavailable('invalid_statistics');
    const radius=120*Math.sqrt(Math.log(80)/(2*n));
    const pLower=Math.exp(Math.log(.025)/n);
    return {...base,method:'hoeffding-binomial',status:'bounded',
      lower:Math.max(0,mean-radius),upper:Math.min(120,mean+radius)/pLower};
  }
  const scale=n*(n-1),q=studentTCritical95(n-1)**2;
  const vx=m2/scale,vy=syy/scale,cv=co/scale;
  const a=p*p-q*vy,b=mean*p-q*cv,c=mean*mean-q*vx;
  // Expanded discriminant keeps small centered variation when mean^2 is large.
  let d=q*(p*p*vx+mean*mean*vy-2*mean*p*cv)+q*q*(cv*cv-vx*vy);
  const tolerance=1e-12*Math.max(1,b*b,Math.abs(a*c));
  if (!Number.isFinite(d) || d < -tolerance) return unavailable('invalid_statistics');
  d=Math.max(0,d);
  const root=Math.sqrt(d);
  // Stable quadratic roots avoid subtracting near-equal numbers.
  const v=b+(b>=0?root:-root);
  const roots=a===0 ? [] : v===0 ? [b/a,b/a] : [v/a,c/v];
  if (a>0) {
    const lower=Math.max(0,Math.min(...roots)),upper=Math.max(...roots);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper<lower)
      return unavailable('invalid_statistics');
    return {...base,status:'bounded',lower,upper};
  }
  // The denominator cannot be distinguished from zero. Intersect with nonnegative
  // time; for a disjoint Fieller set return its conservative nonnegative envelope.
  const lower=c>0 ? Math.max(0,a===0 ? (b>0?c/(2*b):0) : Math.max(...roots)) : 0;
  return {...base,status:'unbounded',lower:Number.isFinite(lower)?lower:0,upper:Infinity};
}
export function formatClearTimeInterval(interval,locale='en') {
  const zh=locale==='zh';
  if (interval?.status==='bounded' || interval?.status==='unbounded') {
    const value=n=>Number.isFinite(n)?n.toFixed(1):'∞';
    return `${value(interval.lower)}–${value(interval.upper)} ${zh?'秒':'s'}`;
  }
  if(interval?.status==='no_success')return zh?'无法估计（无成功对局）':'Unavailable (no successes)';
  if(interval?.status==='insufficient')return zh?'无法估计（样本不足）':'Insufficient samples';
  return zh?'无法估计（统计数据不足或无效）':'Unavailable (missing or invalid statistics)';
}
