/* sim: a street brawl, in place. The fight itself is Toofan's own (sim/combat and sim/fightworld, unchanged: walk, lock, blows, guard,
   timed-block counters, rage, the finisher, knockdowns, Maa ka Thappad). Only the ground differs: the road. The fight is simulated at the
   brawler's own scale (one fight unit is SCALE metres of road, so Toofan and the drivers are the same size here as in a brawl at a place)
   around an anchor point on the road; the view draws it scaled back up. A driver who is touched, and whose temper says so, steps out and
   fights; whoever is knocked into another vehicle, or hits one, brings its driver in too (up to MAX at once). A long fight brings the police.
   Plain data, seeded; no graphics, no DOM. */
'use strict';

var R = require('../data/ride');
var C = require('../data/course');
var rngMod = require('../core/rng');
var combatMod = require('./combat');
var fightworld = require('./fightworld');
var roadMod = require('./road');

var K = R.SCALE, MAX = 8, POLICE_AT = 60 * 55, CLEAR_HOLD = 150, POLICE_HOLD = 200;
var BIG = 1e5;

/* what steps out of each vehicle */
var KIND_OF = { scooter: 'thug', auto: 'thug', car: 'thug', sedan: 'thug', taxi: 'thug', tempo: 'stick', pickup: 'stick', suv: 'stick', bus: 'heavy', truck: 'heavy', tanker: 'heavy' };

function toWorld(fw, x, z) { return { x: fw.anchor.x + x * K, z: fw.anchor.z + z * K }; }
function toFight(fw, x, z) { return { x: (x - fw.anchor.x) / K, z: (z - fw.anchor.z) / K }; }

/* a driver decides, from his temper and how hard he was hit, whether to get out (decided once, by the seeded roll) */
function wants(r, v, sev) {
  var p = Math.max(0, Math.min(0.95, 0.12 + v.temper * 0.62 + sev * 0.14));
  return r.rng.next() < p;
}

function begin(r, v) {
  if (r.brawl) return join(r, v);
  var b = r.bike, h = r.hero, seed = (r.seed ^ Math.imul(r.tick + 1, 2654435761)) >>> 0, fr;
  /* he steps off where he is: from the bike, or where he came to rest after a fall */
  if (r.state === 'ride') { h.x = b.x + Math.cos(b.h) * 1.3; h.z = b.z - Math.sin(b.h) * 1.3; h.face = b.h; b.speed = 0; }
  h.px = h.x; h.pz = h.z;
  var fw = {
    seed: seed, tick: 0, rng: rngMod.createRng(seed), bus: r.bus, type: 'street', name: 'Street fight', anchor: { x: h.x, z: h.z },
    arena: { solids: [], ox: 0, oz: 0 }, bounds: { x0: -BIG, x1: BIG, z0: -BIG, z1: BIG },
    player: { x: 0, z: 0, px: 0, pz: 0, face: Math.atan2(v.x - h.x, v.z - h.z), moving: false, rage: 0, hp: 100, maxHp: 100, stun: 0, guard: false, down: false, invuln: false },
    combat: combatMod.createCombat(), pendingStrikes: [], counters: { attacks: 0, blocks: 0, finishers: 0 },
    attackLock: false, invuln: false, graceT: 0, state: 'fight', owner: {}, joined: 0, endT: 0, policeAt: POLICE_AT
  };
  var c = fw.combat; c.enabled = true; c.wave = 2; c.auto = false; c.lineup = null; c.banner = ''; c.bannerT = 0;
  r.brawl = fw; r.state = 'brawl'; r.pendingBrawl = null; b.speed = 0; b.slide = 0; fw.hadMen = false;
  r.bus.emit('ride:brawl', { x: h.x, z: h.z });
  join(r, v);
}

/* a driver steps out of his vehicle, onto the road beside it */
function join(r, v) {
  var fw = r.brawl; if (!fw || v.out || fw.joined >= MAX) return false;
  var K0 = R.KINDS[v.kind], side = v.dir > 0 ? 1 : -1, door = toFight(fw, v.x + Math.cos(v.h) * side * (K0.r + 0.6), v.z - Math.sin(v.h) * side * (K0.r + 0.6));
  v.out = true; v.v = 0; v.wait = 1e9; v.hitCool = 1e9;
  var kind = KIND_OF[v.kind] || 'thug'; if (kind === 'thug' && v.temper > 0.8) kind = 'stick';
  combatMod.spawn(fw, kind, door.x, door.z); var e = fw.combat.enemies[fw.combat.enemies.length - 1];
  e.face = Math.atan2(fw.player.x - e.x, fw.player.z - e.z); fw.owner[e.id] = v.id; fw.joined++; fw.hadMen = true;
  r.bus.emit('ride:join', { id: v.id, enemy: e.id, kind: v.kind });
  return true;
}

function vehicleOf(r, id) { for (var i = 0; i < r.traffic.length; i++) if (r.traffic[i].id === id) return r.traffic[i]; return null; }

/* people stay on the road and its pavements, and walk round the vehicles; knocking into a stranger's vehicle brings its driver out */
function ground(r, fw) {
  var c = fw.combat, actors = [fw.player].concat(c.enemies.filter(function (e) { return !e.dead && e.st !== 'dead'; })), i, j, lim = C.HALF + C.PAVE - 0.5;
  for (i = 0; i < actors.length; i++) {
    var a = actors[i], w = toWorld(fw, a.x, a.z), moved = false;
    var q = roadMod.project(r.road, w.x, w.z, r.bike.i);
    if (Math.abs(q.lat) > lim) { var f = roadMod.frame(r.road, q.s, Math.max(-lim, Math.min(lim, q.lat))); w.x = f.x; w.z = f.z; moved = true; }
    for (j = 0; j < r.traffic.length; j++) {
      var v = r.traffic[j]; if (Math.abs(v.x - w.x) > 8 || Math.abs(v.z - w.z) > 8) continue;
      var K0 = R.KINDS[v.kind], fx = Math.sin(v.h), fz = Math.cos(v.h), half = Math.max(0, K0.len / 2 - K0.r);
      var t = Math.max(-half, Math.min(half, (w.x - v.x) * fx + (w.z - v.z) * fz)), cx = v.x + fx * t, cz = v.z + fz * t, dx = w.x - cx, dz = w.z - cz, d = Math.hypot(dx, dz), min = K0.r + 0.45;
      if (d >= min) continue;
      if (d < 1e-4) { dx = Math.cos(v.h); dz = -Math.sin(v.h); d = 1; }
      w.x = cx + dx / d * min; w.z = cz + dz / d * min; moved = true;
      /* a stranger's vehicle: he is flung or lunging into it, or the hero is swinging at it, and its driver comes out */
      var flung = a === fw.player ? !!fw.attackLock : (a.st === 'hurt' || a.st === 'down' || Math.hypot(a.kx || 0, a.kz || 0) > 0.02);
      if (!v.out && flung && fw.joined < MAX && v.temper > 0.2 && v.v < 4) { join(r, v); r.bus.emit('ride:smash', { id: v.id, x: v.x, z: v.z }); }
    }
    if (moved) { var nf = toFight(fw, w.x, w.z); a.x = nf.x; a.z = nf.z; }
  }
}

function step(r, input) {
  var fw = r.brawl, h = r.hero, c = fw.combat, b = r.bike;
  h.px = h.x; h.pz = h.z;
  if (fw.state === 'fight' || fw.state === 'rise' || fw.state === 'thappad' || fw.state === 'intro') {
    fightworld.step(fw, input);
    if (fw.state === 'fight' || fw.state === 'rise') ground(r, fw);
    /* a fight that drags on brings the police: the fighters scatter */
    if (fw.state === 'fight' && fw.tick > fw.policeAt && c.enemies.some(function (e) { return !e.dead && e.st !== 'dead'; })) {
      fw.state = 'police'; fw.endT = 0; c.enemies.forEach(function (e) { if (!e.dead && e.st !== 'down') { e.st = 'scatter'; } }); r.bus.emit('ride:police', {});
    }
  } else if (fw.state === 'cleared' || fw.state === 'police') {
    fw.tick++; fw.endT++;
    if (fw.state === 'police') c.enemies.forEach(function (e) { if (e.st === 'scatter') { e.px = e.x; e.pz = e.z; var d = Math.hypot(e.x - fw.player.x, e.z - fw.player.z) || 1; e.x += (e.x - fw.player.x) / d * 0.09; e.z += (e.z - fw.player.z) / d * 0.09; e.face = Math.atan2(e.x - fw.player.x, e.z - fw.player.z); } });
    if (fw.endT > (fw.state === 'police' ? POLICE_HOLD : CLEAR_HOLD)) { end(r); return; }
  }
  var w = toWorld(fw, fw.player.x, fw.player.z); h.x = w.x; h.z = w.z; h.face = fw.player.face;
  var pr = roadMod.project(r.road, h.x, h.z, b.i);
}

/* the street goes back to normal: the drivers get in and drive off, and he is back on Bijli */
function end(r) {
  var fw = r.brawl, b = r.bike, h = r.hero, i;
  for (i = 0; i < r.traffic.length; i++) { var v = r.traffic[i]; if (v.out) { v.out = false; v.wait = 0; v.hitCool = 40; v.react = 0; } }
  r.brawl = null; r.state = 'ride'; r.t = 0; b.speed = 0; b.grace = R.GRACE_TICKS; h.x = h.px = b.x; h.z = h.pz = b.z;
  r.bus.emit('ride:brawlEnd', { cleared: fw.state === 'cleared', police: fw.state === 'police', kills: fw.combat.kills });
}

module.exports = { begin: begin, join: join, step: step, end: end, wants: wants, toWorld: toWorld, toFight: toFight, MAX: MAX };
