import { compilePayload, exportGameData } from './vendor/fastsim-js/engine-core.mjs';
import { Game } from './vendor/fastsim-js/game.mjs';

export { Game, exportGameData };
export const MONSTERS = [
  ['shadow_archer','暗影弓手'], ['pyre_hunter','火焰猎手'], ['frost_sniper','霜冻狙击手'],
  ['siren','海妖'], ['salamander','火蜥蜴'], ['dryad','树精'], ['giant_scorpion','巨蝎'],
  ['giant_mantis','巨螳螂'], ['cyclops','独眼巨人'], ['mimic','宝箱怪'],
].map(([key,name])=>({key,name,hrid:`/monsters/${key}`}));

export function validateSettings({level, trials, seed=null}) {
  level=Number(level); trials=Number(trials);
  if (!Number.isSafeInteger(level)||level<1||level>10000) throw new Error('怪物等级必须是 1～10000 的整数');
  if (!Number.isSafeInteger(trials)||trials<1||trials>2000) throw new Error('模拟次数必须是 1～2000 的整数');
  if (seed!==null) {
    seed=Number(seed);
    if (!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff) throw new Error('种子必须是 0～4294967295 的整数');
  }
  return {level,trials,seed};
}

// These five definitions are the original shykai engine's labyrinthUpgradeDetailMap.
const UPGRADE_TYPES = {
  attack_speed:['attack_speed','ratioBoost'], cast_speed:['cast_speed','flatBoost'],
  combat_damage:['damage','ratioBoost'], critical_rate:['critical_rate','flatBoost'],
  experience:['wisdom','flatBoost'],
};

export function makeRustScenario(game, params) {
  const {level,trials,seed}=validateSettings({level:params.mazeDifficulty,trials:params.trials,seed:params.seed??0});
  const dto=structuredClone(params.playerDto);
  dto.food=[]; dto.drinks=[];
  const sc=compilePayload(game, {
    combatMode:'labyrinth', players:[dto], seed, simulationTimeLimit:120*trials*1e9,
    labyrinth:{labyrinthHrid:params.monsterHrid,roomLevel:level,crates:params.mazeCrateItemHrids||[]},
    extra:{},
  });
  for (const [suffix,[type,field]] of Object.entries(UPGRADE_TYPES)) {
    const hrid=`/buff_uniques/labyrinth_upgrade_${suffix}`;
    const n=Math.max(0,Number(dto.labyrinthUpgrades?.[hrid])||0);
    if (!n) continue;
    const buffs=sc.players[0].permanentBuffs;
    let buff=buffs.find(b=>b.typeHrid===`/buff_types/${type}`);
    if (!buff) {
      buff={uniqueHrid:hrid,typeHrid:`/buff_types/${type}`,flatBoost:0,ratioBoost:0,duration:0};
      buffs.push(buff);
    }
    buff[field]+=n*.01;
  }
  sc.labyrinthFixedMonsterCooldown=true;
  sc.labyrinthLegacyFury=true;
  return sc;
}

export function summarizeResult(raw) {
  const stats=raw.labyrinthStats;
  const successes=stats?stats.successes:raw.successes;
  // Original 1.5.14 counts actual player deaths even when thorns also kill the monster.
  // Preserve that denominator instead of silently changing the comparison's statistics.
  let failedByDeath=stats?stats.failedByDeath:(raw.failedByDeath||0);
  if(stats && raw.deaths) {
    const direct=Math.max(0,Math.floor(Number(raw.deaths.player1)||0));
    failedByDeath=direct>0?direct:Object.entries(raw.deaths).reduce((sum,[key,n])=>
      sum+(key.startsWith('player')?Math.max(0,Math.floor(Number(n)||0)):0),0);
  }
  const failedByTimeout=stats?Math.max(0,stats.completedTrials-successes-failedByDeath):(raw.failedByTimeout||0);
  const trials=stats?Math.max(1,successes+failedByDeath+failedByTimeout):raw.trials;
  const completedSpentSeconds=stats?stats.completedSpentNs/1e9:null;
  const totalSpentSeconds=stats
    ? (raw.lastEncounterFinishTime>0?raw.lastEncounterFinishTime/1e9:completedSpentSeconds)
    : raw.totalSpentSeconds;
  return {
    trials,successes,failures:Math.max(0,trials-successes),
    failedByDeath,failedByTimeout,completedTrials:stats?.completedTrials??null,
    clearChance:trials>0?Math.max(0,Math.min(1,successes/trials)):0,
    expectedSecondsPerClear:successes>0?totalSpentSeconds/successes:Infinity,
    totalSpentSeconds,
    simulatedSeconds:raw.simulatedTime?raw.simulatedTime/1e9:(raw.firstRunDebug?.simulatedTime||0)/1e9,
    completeExpectedSecondsPerClear:completedSpentSeconds===null?null:(successes>0?completedSpentSeconds/successes:Infinity),
  };
}

export function totalTimings(rows) {
  const result={legacyMs:0,rustMs:0,legacyCount:0,rustCount:0};
  for (const row of rows) for (const engine of ['legacy','rust']) {
    const ms=row[engine]?.elapsedMs;
    if (row[engine]?.attempted!==false && Number.isFinite(ms)) {result[`${engine}Ms`]+=ms;result[`${engine}Count`]++;}
  }
  return result;
}

// Pick only the fields the unmodified original DTO/loadout builders read. Avoid sockets/React
// instances and snapshot all ten inputs before either engine starts.
export function snapshotState(state) {
  const result={};
  for (const key of ['characterSetting','characterLoadoutDict','characterLabyrinth',
    'characterInfo','labyrinthRoomProgress','labyrinthBattleMonsters',
    'characterSkillMap','characterAbilityMap','characterHouseRoomDict','characterAchievementMap',
    'characterGuildBuffDict','characterItemMap','characterItemByLocationMap','abilityCombatTriggersDict',
    'abilitySlotsLevelRequirementList','itemDetailDict','abilityDetailDict']) {
    if (state[key]!==undefined) result[key]=structuredClone(state[key]);
  }
  if (state.combatUnit?.combatDetails) result.combatUnit={combatDetails:structuredClone(state.combatUnit.combatDetails)};
  return result;
}
