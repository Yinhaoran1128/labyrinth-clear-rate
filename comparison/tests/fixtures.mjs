import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Game } from '../vendor/fastsim-js/game.mjs';

export function fixtureGame() {
  return new Game(JSON.parse(gunzipSync(fs.readFileSync(new URL('./gamedata.json.gz', import.meta.url)))));
}
export function fixturePlayer(level=100) {
  const dto = {hrid:'player1', equipment:{'/equipment_types/two_hand':{hrid:'/items/wooden_bow',enhancementLevel:5}},
    food:[],drinks:[],abilities:[null,null,null,null,null],houseRooms:{},achievements:{},guildBuffs:{},
    labyrinthUpgrades:{},debuffOnLevelGap:0};
  for (const s of ['stamina','intelligence','attack','melee','defense','ranged','magic']) dto[`${s}Level`]=level;
  return dto;
}
