// The upstream result exposes the latest monster spawn time but no timeout count.
// Replay the SAME seeded event stream at each spawn boundary, walking backwards.
// This preserves native continuous-battle rules instead of inventing independent trials.
export function collectUpstreamStats(run,scenario,full,onProgress=()=>{}) {
  const monster=scenario.labyrinth.monsterHrid;
  const spawn=result=>{
    const entry=result.timeSpentAlive?.find(x=>x.name===monster);
    if(!entry || !Number.isFinite(entry.spawnedAt))throw new Error('上游引擎结果缺少怪物出生时间，无法统计胜率');
    return entry.spawnedAt;
  };
  const lastStart=spawn(full);
  const end=full.simulatedTime;
  if(!Number.isFinite(end)||lastStart<0||lastStart>end)throw new Error('上游引擎返回了无效战斗时间');
  // If the final event ended a room, the queued next room starts at that same time.
  const nextStart=spawn(run(end+1));
  const finalComplete=nextStart>lastStart && nextStart<=end;
  const successes=Math.max(0,Math.floor(full.encounters||0));
  const deaths=Math.max(0,Math.floor(full.deaths?.player1||0));
  const completedSpentNs=finalComplete?end:lastStart;
  const alive=full.timeSpentAlive.find(x=>x.name===monster);
  // Successful monster deaths record their complete alive durations. If these
  // cover all completed time, there is no positive-duration failed room to find.
  // This makes thousands of easy wins a constant number of replay calls.
  const tolerance=Math.max(1,completedSpentNs*Number.EPSILON*128);
  if(successes>0 && alive.count===successes &&
      Math.abs(alive.timeSpentAlive-completedSpentNs)<=tolerance) {
    onProgress(1);
    return {completedTrials:successes,successes,failedByDeath:deaths,failedByTimeout:0,
      completedSpentNs,minElapsedSeconds:0,maxElapsedSeconds:0,reconstructionProbes:1};
  }
  let completed=finalComplete?1:0;
  let minNs=finalComplete?end-lastStart:Infinity;
  let maxNs=finalComplete?end-lastStart:0;
  let current=lastStart;
  let probes=1;
  while(current>0) {
    if(++probes>10000)throw new Error('远程引擎场次统计超过 10000 次重放，请减少模拟次数');
    const previous=spawn(run(current));
    if(!(previous>=0 && previous<current))throw new Error('上游引擎出生时间无法回溯，请检查引擎版本');
    const duration=current-previous;
    minNs=Math.min(minNs,duration);maxNs=Math.max(maxNs,duration);
    completed++;current=previous;
    if(probes%16===0)onProgress(1-current/Math.max(1,lastStart));
  }
  if(successes>completed)throw new Error('上游引擎胜利计数超过已完成场次');
  onProgress(1);
  return {completedTrials:completed,successes,failedByDeath:deaths,
    failedByTimeout:Math.max(0,completed-successes-deaths),
    completedSpentNs,
    minElapsedSeconds:Number.isFinite(minNs)?minNs/1e9:0,maxElapsedSeconds:maxNs/1e9,
    reconstructionProbes:probes};
}
