// Retain the original functions verbatim; only replace its automatic UI bootstrap.
export function legacyFactorySource(source) {
  const start=source.indexOf('    const ROOM_DURATION_SECONDS =');
  const end=source.lastIndexOf('    migrateLegacySimulatorBridgeUrl();');
  if(start<0||end<start) throw new Error('Unsupported original script layout');
  return `function createOriginalApi() {\n${source.slice(start,end)}\nreturn {
    getGameState,getInitClientData,buildMaxEnhancementByItem,resolveLabyrinthUpgradeLevels,
    buildCombatPlayerDtoForRoom,getCombatCrateBuffs,listCombatLoadouts,
    computeCombatRoomClearChanceFullFlow,buildCombatSimulatorWorkerSource,
    ensureCombatSimulatorWorker,
    peekWorker() { return combatSimulatorWorker; },
    setWorkerSource(source) { combatWorkerScriptPromise=Promise.resolve(source); },
    resetWorker() { resetCombatSimulatorWorker(new Error('测试已停止')); },
  };\n}`;
}

// Applied outside the original worker: stock simulation and aggregation remain unchanged.
export function legacyWorkerBridgeSource() {
  return `\n(function(){
    var originalHandler=self.onmessage, originalRandom=Math.random, comparisonSeed=null;
    function seeded(seed) {
      var state=Number(seed)>>>0;
      return function(){
        state+=1831565813;var t=state>>>0;
        t=Math.imul(t^(t>>>15),t|1);
        t^=t+Math.imul(t^(t>>>7),t|61);
        return ((t^(t>>>14))>>>0)/4294967296;
      };
    }
    self.onmessage=async function(event){
      var data=event.data||{};
      if(data.type==='comparison_init') {
        var maps={};
        ['abilityDetailMap','achievementDetailMap','achievementTierDetailMap','actionDetailMap',
         'combatMonsterDetailMap','combatStyleDetailMap','combatTriggerDependencyDetailMap',
         'enhancementLevelTotalBonusMultiplierTable','guildBuffDetailMap','houseRoomDetailMap',
         'itemDetailMap','labyrinthCrateDetailMap'].forEach(function(name){
          maps[name]=__webpack_require__('./src/combatsimulator/data/'+name+'.json');
        });
        self.postMessage({type:'comparison_ready',maps:maps});return;
      }
      if(data.type==='comparison_seed') { comparisonSeed=data.seed; return; }
      if(data.type==='simulate_room') {
        Math.random=comparisonSeed===null?originalRandom:seeded(comparisonSeed);
        try { await originalHandler(event); } finally { Math.random=originalRandom; }
      }
    };
  })();`;
}
