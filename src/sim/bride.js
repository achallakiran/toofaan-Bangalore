/* sim: the Bangalore ride. Toofan on Bijli seen from above, riding the curved road through its stretches: fast and open, jammed,
   broken (potholes slow the bike), or both. Stick pushes her on (harder = faster), left/right steers, pull back or Block to brake.
   The traffic is not brainless: every vehicle watches the road ahead, brakes, honks and swerves round Toofan before it ever
   touches him. Touch one anyway and the bike slows, takes damage and the driver shouts; a hard enough hit throws him off.
   Plain data, seeded, fixed tick: no graphics, no DOM. */
'use strict';

var R = require('../data/ride');
var C = require('../data/course');
var roadMod = require('./road');
var rngMod = require('../core/rng');

var DT = 1 / 60;
function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

var KINDS = R.KINDS;
var WEIGHTS = [['scooter', 6], ['auto', 5], ['car', 4], ['sedan', 2], ['suv', 2], ['taxi', 2], ['tempo', 2], ['pickup', 2], ['bus', 1.5], ['truck', 1.5], ['tanker', 0.5]];
var TRAFFIC_MAX = 110, SPAWN_NEAR = 12, SPAWN_FAR = 130, DESPAWN = 160;
var HIT_DAMAGE = [0.5, 5, 12], HIT_SLOW = [0.85, 0.5, 0.2];

/* ---- traffic ---- */
function place(r, v) {
  var fr = roadMod.frame(r.road, v.s, v.l);
  v.x = fr.x; v.z = fr.z; v.h = v.dir > 0 ? fr.h : fr.h + Math.PI;
}
function laneLat(v) { return v.dir * C.LANES[v.lane]; }

function pickKind(rng) {
  var tot = 0, i, roll;
  for (i = 0; i < WEIGHTS.length; i++) tot += WEIGHTS[i][1];
  roll = rng.next() * tot;
  for (i = 0; i < WEIGHTS.length; i++) { roll -= WEIGHTS[i][1]; if (roll <= 0) return WEIGHTS[i][0]; }
  return WEIGHTS[0][0];
}

/* try to put a new vehicle at s; false when it would sit on another one or the road is already as busy as it should be there */
function trySpawn(r, s) {
  var rng = r.rng, road = r.road, i, kind = pickKind(rng), K = KINDS[kind], dir = rng.next() < 0.5 ? 1 : -1;
  var lane = rng.next() < (kind === 'bus' || kind === 'truck' || kind === 'tanker' ? 0.15 : 0.5) ? 0 : 1;
  var surf = roadMod.surfaceAt(road, s), near = 0;
  for (i = 0; i < r.traffic.length; i++) {
    var o = r.traffic[i], g = Math.abs(roadMod.gap(road, s, o.s)); if (g < 20) near++;
    if (o.dir === dir && o.lane === lane && g < (KINDS[o.kind].len + K.len) / 2 + 3.5) return false;
  }
  if (near >= Math.max(1, surf.dens * 0.4)) return false;                  /* as busy as this stretch gets, within 20 m each way */
  var lo = K.speed[0], hi = K.speed[1], base = lo + rng.next() * (hi - lo);
  var v = { id: r.nextId++, kind: kind, look: Math.floor(rng.next() * 4), dir: dir, lane: lane, s: s, l: 0, tl: 0, v: 0, base: base, wait: 0, hitCool: 0, honkCool: Math.floor(rng.next() * 120),
    react: 0, rt: 10 + Math.floor(rng.next() * 16), temper: rng.next(), x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, hd: 0, st: 0 };
  v.l = v.tl = laneLat(v); v.v = base * surf.tv * 0.8; place(r, v); v.px = v.x; v.pz = v.z; v.ph = v.h; v.hd = v.h;
  r.traffic.push(v); return true;
}

function honk(r, v, dist, why) {
  if (v.honkCool > 0 || r.honkGap > 0) return;
  v.honkCool = 70 + Math.floor(r.rng.next() * 110); r.honkGap = 10;
  r.bus.emit('ride:honk', { id: v.id, kind: v.kind, dist: dist, why: why });
}

/* a vehicle steers like a vehicle: a front-wheel angle (limited, and smaller at speed) turns the body about its wheelbase, so it can only
   move sideways by driving forward along a curve. It aims at a point ahead on the road at the lateral offset it wants (pure pursuit). */
function drive(r, v, K) {
  var road = r.road, L = road.length, wb = Math.max(1.0, K.len * 0.6);
  var look = Math.max(3.5, v.v * 0.25 + K.len * 0.8), sa = ((v.s + v.dir * look) % L + L) % L, tgt = roadMod.frame(road, sa, v.tl);
  var err = angDiff(Math.atan2(tgt.x - v.x, tgt.z - v.z), v.h), dmax = 0.65 / (1 + v.v * 0.07);
  var steer = clamp(err * 2.2, -dmax, dmax);
  v.st += clamp(steer - v.st, -2.2 * DT, 2.2 * DT);                          /* the wheel takes a moment to turn */
  v.h += v.v / wb * Math.tan(v.st) * DT;
  v.x += Math.sin(v.h) * v.v * DT; v.z += Math.cos(v.h) * v.v * DT;
  var pj = roadMod.project(road, v.x, v.z, v.s); v.s = pj.s; v.l = pj.lat;
}

function stepTraffic(r) {
  var list = r.traffic, road = r.road, b = r.bike, i, j;
  if (r.honkGap > 0) r.honkGap--;
  /* new vehicles appear out of sight ahead and behind, as busy as the stretch they appear in; far ones are dropped */
  if (!r.noSpawn && r.tick % 5 === 0 && list.length < TRAFFIC_MAX) {
    var side = r.rng.next() < 0.5 ? 1 : -1, d = SPAWN_FAR - (SPAWN_FAR - SPAWN_NEAR) * r.rng.next() * (r.filling ? 1 : 0.2);
    trySpawn(r, ((b.s + side * d) % road.length + road.length) % road.length);
  }
  for (i = list.length - 1; i >= 0; i--) if (Math.abs(roadMod.gap(road, b.s, list[i].s)) > DESPAWN) list.splice(i, 1);

  if (r.blat === undefined) { r.blat = b.lat; r.blv = 0; }
  r.blv += ((b.lat - r.blat) / DT - r.blv) * 0.15; r.blat = b.lat;      /* how fast he is moving across the road: drivers read where he is going, not just where he is */
  var bvx = Math.sin(b.h) * b.speed, bvz = Math.cos(b.h) * b.speed;
  for (i = 0; i < list.length; i++) {
    var v = list[i], K = KINDS[v.kind], surf = roadMod.surfaceAt(road, v.s);
    v.px = v.x; v.pz = v.z; v.ph = v.h;
    if (v.honkCool > 0) v.honkCool--; if (v.hitCool > 0) v.hitCool--;
    if (v.wait > 0) { v.wait--; v.v = 0; continue; }
    var want = v.base * surf.tv, fvx = Math.sin(v.h), fvz = Math.cos(v.h);

    /* keep a gap to whoever is in front, in the same direction and the same part of the road */
    for (j = 0; j < list.length; j++) {
      if (j === i) continue; var o = list[j]; if (o.dir !== v.dir) continue;
      var ahead = v.dir * roadMod.gap(road, v.s, o.s); if (ahead <= 0 || ahead > 40) continue;
      if (Math.abs(o.l - v.l) > (K.r + KINDS[o.kind].r) * 0.9) continue;
      var room = ahead - (K.len + KINDS[o.kind].len) / 2 - 1.2;
      if (room < 9) want = Math.min(want, Math.max(0, room) * 1.2);
    }

    /* Toofan ahead: watch him, then honk and swerve round; if there is no room to swerve, brake */
    var dx = b.x - v.x, dz = b.z - v.z, dist = Math.hypot(dx, dz);
    var fwd = v.dir * roadMod.gap(road, v.s, b.s), tt = Math.min(2, Math.max(0, fwd) / Math.max(1, v.v - (bvx * fvx + bvz * fvz))), lat = v.dir * (b.lat + clamp(r.blv, -6, 6) * tt - v.l);      /* where he is along and across the road (a straight line is wrong on a bend) */
    var closing = v.v - (bvx * fvx + bvz * fvz), look = 12 + Math.max(0, closing) * 2.4, clear = K.r + R.BIKE_R + 1.0;
    var threat = fwd > K.len / 2 - 0.6 && fwd < look && Math.abs(lat) < clear && closing > 0.4;
    if (threat) v.react++; else if (v.react > 0) v.react = Math.max(0, v.react - 2);
    if (v.react > v.rt * Math.min(1, 12 / Math.max(12, closing))) {      /* the faster he is coming, the quicker it reacts */
      honk(r, v, dist, 'ahead');
      /* swerve to whichever side gets it furthest from him (away from him if both are open), staying in its own half of the road */
      var need = clear - Math.abs(lat), hi = C.HALF - K.r - 0.3, lo = -hi, bestTl = v.l, bestSep = Math.abs(lat), away = lat > 0 ? -1 : 1, sgn;
      for (sgn = -1; sgn <= 1; sgn += 2) {
        var tlc = clamp(v.l + v.dir * sgn * (need + 0.4), lo, hi);
        if (v.dir > 0) tlc = Math.max(tlc, K.r * 0.3); else tlc = Math.min(tlc, -K.r * 0.3);
        var sep = Math.abs(lat - (tlc - v.l) * v.dir) - (sgn === away ? 0 : 0.15);       /* (a small lean toward the open side) */
        if (sep > bestSep) { bestSep = sep; bestTl = tlc; }
      }
      v.tl = bestTl;
      if (bestSep < clear * 0.6) want = Math.min(want, Math.max(0, fwd - K.len / 2 - R.BIKE_R - 1.5) * 0.9);     /* no room: brake */
      else want = Math.min(want, Math.max(v.base * 0.6, 3));
    } else if (!threat && v.react === 0 && !(Math.abs(fwd) < K.len / 2 + 2.5 && Math.abs(lat) < clear + 0.8)) v.tl = laneLat(v);      /* back into its lane only once it is clear of him */
    /* the jam talks: horns from the crawl, now and then */
    if ((surf.type === 'jam' || surf.type === 'combo') && dist < 45 && v.honkCool <= 0 && r.rng.next() < 0.0012 + 0.004 * v.temper * (v.v < 2 ? 1 : 0)) honk(r, v, dist, 'jam');

    v.v += clamp(want - v.v, -8 * DT, 3 * DT);
    if (v.v < 0) v.v = 0;
    drive(r, v, K);
  }
}

/* bike circle against a vehicle's body line; returns the push-out vector and how deep, or null */
function hitVehicle(v, x, z) {
  var K = KINDS[v.kind], fx = Math.sin(v.h), fz = Math.cos(v.h), half = Math.max(0, K.len / 2 - K.r);
  var dx = x - v.x, dz = z - v.z, t = clamp(dx * fx + dz * fz, -half, half);
  var cx = v.x + fx * t, cz = v.z + fz * t, ex = x - cx, ez = z - cz, d = Math.hypot(ex, ez), min = K.r + R.BIKE_R;
  if (d >= min) return null;
  if (d < 1e-4) { ex = Math.cos(v.h); ez = -Math.sin(v.h); d = 1; }
  return { x: ex / d * (min - d), z: ez / d * (min - d), depth: min - d };
}

/* ---- the ride ---- */
function createRide(seed, bus, opts) {
  var road = roadMod.build(seed), s0 = (opts && opts.s !== undefined) ? opts.s : C.START, fr = roadMod.frame(road, s0, C.LANES[1]);
  var r = {
    seed: seed, tick: 0, free: true, bus: bus || { emit: function () {} }, rng: rngMod.createRng((seed >>> 0) ^ 0x7a11), road: road,
    bike: { x: fr.x, z: fr.z, px: fr.x, pz: fr.z, h: fr.h, ph: fr.h, speed: 0, turn: 0, grace: 0, s: s0, lat: C.LANES[1], i: Math.round(s0 / road.ds) % road.N, hp: 100, rough: 0, jolt: 0, inHole: -1, wrecked: false },
    hero: { x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, face: 0, spin: 0 },
    state: 'ride', t: 0, traffic: [], nextId: 1, honkGap: 0, filling: false,
    crashes: 0, hits: 0, hearts: 3, enc: null, target: null, patrols: [], arrivals: 0, stretch: roadMod.surfaceAt(road, s0)
  };
  /* fill the road around the start, then let it settle */
  if (opts && opts.noTraffic) r.noSpawn = true; else fillAround(r, s0);
  return r;
}
function fillAround(r, s0) {
  var n, len = r.road.length; r.filling = true;
  for (n = 0; n < 900 && r.traffic.length < TRAFFIC_MAX; n++) trySpawn(r, ((s0 + (r.rng.next() * 2 - 1) * SPAWN_FAR) % len + len) % len);
  r.filling = false;
}

function step(r, input) {
  var s = input.state, b = r.bike, hero = r.hero, road = r.road, i;
  b.px = b.x; b.pz = b.z; b.ph = b.h; hero.px = hero.x; hero.pz = hero.z;
  r.t++;
  stepTraffic(r);
  var surf = roadMod.surfaceAt(road, b.s); r.stretch = surf;

  if (r.state === 'ride') {
    var mx = s.mx, my = s.my, mag = Math.min(1, Math.hypot(mx, my)), back = my < -0.35;
    var thr = back ? 0 : mag, brk = back ? -my : 0;
    if (s.held.block) { brk = 1; thr = 0; }
    var steer = Math.abs(mx) > 0.15 ? mx : 0, rate = R.TURN * DT * Math.min(1, 0.25 + Math.abs(b.speed) / 8);
    b.turn = steer ? -steer * rate : b.turn * 0.7;
    b.h += b.turn * (b.speed < 0 ? -1 : 1);
    if (!steer && Math.abs(b.speed) > 2) {                                  /* lane assist: settle along the road (either way) */
      var pr0 = roadMod.project(road, b.x, b.z, b.i), a1 = angDiff(pr0.h, b.h), a2 = angDiff(pr0.h + Math.PI, b.h), off = Math.abs(a1) < Math.abs(a2) ? a1 : a2;
      if (Math.abs(off) < 0.5) b.h += off * Math.min(1, 3.5 * DT);
    }
    var top = R.TOP * (b.wrecked ? 0.25 : 1) * surf.cap;                    /* broken roads cap the speed; a wrecked bike limps */
    if (thr > 0.15) { var tgt = top * thr; b.speed = b.speed < tgt ? Math.min(tgt, b.speed + R.ACCEL * thr * DT) : Math.max(tgt, b.speed - (b.speed > top ? 6 : R.COAST) * DT); }
    else if (brk > 0.15) b.speed = b.speed > 0 ? Math.max(0, b.speed - R.BRAKE * brk * DT) : Math.max(-R.REVERSE, b.speed - 2 * brk * DT);
    else b.speed = b.speed > 0 ? Math.max(0, b.speed - R.COAST * DT) : Math.min(0, b.speed + R.COAST * DT);
    if (b.speed > top && thr <= 0.15) b.speed = Math.max(top, b.speed - 6 * DT);
    if (b.grace > 0) b.grace--;
    /* move, sliding along the pavement's edge, poles and trees */
    var nx = b.x + Math.sin(b.h) * b.speed * DT, nz = b.z + Math.cos(b.h) * b.speed * DT;
    var free = function (px, pz) { var q = roadMod.project(road, px, pz, b.i); return Math.abs(q.lat) <= C.HALF + C.PAVE - R.BIKE_R && roadMod.clearOfProps(road, px, pz, R.BIKE_R); };
    if (free(nx, nz)) { b.x = nx; b.z = nz; }
    else if (free(nx, b.z)) { b.x = nx; b.speed *= 0.97; }
    else if (free(b.x, nz)) { b.z = nz; b.speed *= 0.97; }
    else { if (Math.abs(b.speed) > 4) r.bus.emit('ride:wall', { speed: b.speed }); b.speed *= 0.3; }
    var pr = roadMod.project(road, b.x, b.z, b.i); b.s = pr.s; b.lat = pr.lat; b.i = pr.i;

    /* potholes */
    var holes = roadMod.holesNear(road, b.s, 4), inAny = -1;
    for (i = 0; i < holes.length; i++) {
      var hl = holes[i], dh = Math.hypot(roadMod.gap(road, hl.s, b.s), b.lat - hl.l);
      if (dh < hl.r + 0.3) {
        inAny = hl.id;
        if (b.inHole !== hl.id && b.speed > 2.5) {
          var k = Math.max(0.35, b.speed / R.TOP + 0.3);
          b.speed *= hl.deep ? 0.3 : 0.65; hurt(r, (hl.deep ? 5 : 2) * k); b.jolt = hl.deep ? 1 : 0.6;
          r.bus.emit('ride:pothole', { deep: hl.deep, water: hl.water, x: b.x, z: b.z, speed: b.speed });
        }
      }
    }
    b.inHole = inAny;
    b.jolt *= 0.9;
    b.rough += (surf.rough * Math.min(1, Math.abs(b.speed) / 10) - b.rough) * 0.1;

    /* traffic */
    for (i = 0; i < r.traffic.length; i++) {
      var v = r.traffic[i]; if (Math.abs(v.s - b.s) > 12 && Math.abs(roadMod.gap(road, v.s, b.s)) > 12) continue;
      var push = hitVehicle(v, b.x, b.z); if (!push) continue;
      b.x += push.x; b.z += push.z;
      var rvx = Math.sin(b.h) * b.speed - Math.sin(v.h) * v.v, rvz = Math.cos(b.h) * b.speed - Math.cos(v.h) * v.v, rel = Math.hypot(rvx, rvz);
      if (v.hitCool > 0) { b.speed = Math.min(b.speed, Math.max(2, v.v)); continue; }          /* still touching: no second hit, but no going through */
      if (rel < 1) { b.speed = Math.min(b.speed, v.v + 0.5); continue; }       /* a nudge at a crawl: no harm, just no way through */
      var sev = rel < 3 ? 0 : rel < 8 ? 1 : 2, was = b.speed;
      v.hitCool = 50; if (sev > 0) v.wait = 30; b.speed *= HIT_SLOW[sev]; hurt(r, HIT_DAMAGE[sev]); r.hits++;
      r.bus.emit('ride:hit', { id: v.id, kind: v.kind, sev: sev, rel: rel, x: v.x, z: v.z });
      honk(r, v, 0, 'hit');
      if (sev === 2 && was > 9 && b.grace <= 0) {                              /* a hard hit throws him off */
        r.state = 'fly'; r.t = 0; r.crashes++;
        hero.x = b.x; hero.z = b.z; hero.px = hero.x; hero.pz = hero.z; hero.vx = Math.sin(b.h) * was * 0.55 + push.x * 4; hero.vz = Math.cos(b.h) * was * 0.55 + push.z * 4; hero.face = b.h; hero.spin = 0;
        b.slide = was * 0.5; b.speed = 0; r.bus.emit('ride:crash', { x: b.x, z: b.z, kind: v.kind });
        break;
      }
    }
  } else if (r.state === 'fly') {                                     /* thrown off: he tumbles along the road, the bike skids to a stop */
    hero.x += hero.vx * DT; hero.z += hero.vz * DT; hero.vx *= 0.94; hero.vz *= 0.94; hero.spin += 0.25 * Math.max(0, 1 - r.t / R.FLY_TICKS);
    var hp2 = roadMod.project(road, hero.x, hero.z, b.i); if (Math.abs(hp2.lat) > C.HALF + C.PAVE - 0.3) { hero.x = hero.px; hero.z = hero.pz; hero.vx = hero.vz = 0; }
    if (b.slide > 0) { var sx = b.x + Math.sin(b.h) * b.slide * DT, sz = b.z + Math.cos(b.h) * b.slide * DT, q2 = roadMod.project(road, sx, sz, b.i); if (Math.abs(q2.lat) <= C.HALF + C.PAVE - R.BIKE_R) { b.x = sx; b.z = sz; } b.slide = Math.max(0, b.slide - 18 * DT); }
    var pq = roadMod.project(road, b.x, b.z, b.i); b.s = pq.s; b.lat = pq.lat; b.i = pq.i;
    if (r.t >= R.FLY_TICKS) { r.state = 'run'; r.t = 0; r.bus.emit('ride:getup', {}); }
  } else if (r.state === 'run') {                                     /* back on his feet, he runs to Bijli */
    var ex = b.x - hero.x, ez = b.z - hero.z, d = Math.hypot(ex, ez);
    if (d < 0.6) { r.state = 'ride'; r.t = 0; b.speed = 0; b.grace = R.GRACE_TICKS; r.bus.emit('ride:remount', {}); }
    else { var st = Math.min(d, R.RUN_SPEED * DT); hero.x += ex / d * st; hero.z += ez / d * st; hero.face = Math.atan2(ex, ez); }
  }
  r.tick++;
}

function hurt(r, n) {
  var b = r.bike; if (b.hp <= 0) return;
  b.hp = Math.max(0, b.hp - n);
  if (b.hp <= 0 && !b.wrecked) { b.wrecked = true; r.bus.emit('ride:wrecked', {}); }
}

function hash(r) {
  var h = 2166136261 >>> 0;
  function mix(n) { h ^= (Math.round(n * 1000) | 0); h = Math.imul(h, 16777619) >>> 0; }
  mix(r.bike.x); mix(r.bike.z); mix(r.bike.h); mix(r.bike.speed); mix(r.bike.hp); mix(r.hero.x); mix(r.tick); mix(r.crashes); mix(r.hits); mix(r.traffic.length);
  r.traffic.forEach(function (v) { mix(v.x); mix(v.z); mix(v.v); mix(v.l); });
  return h >>> 0;
}

/* (for tests and tools) put one vehicle on the road */
function addVehicle(r, o) {
  var K = KINDS[o.kind || 'car'], v = { id: r.nextId++, kind: o.kind || 'car', look: 0, dir: o.dir || 1, lane: o.lane === undefined ? 1 : o.lane, s: o.s, l: 0, tl: 0, v: o.v || 0, base: o.base !== undefined ? o.base : (o.v !== undefined ? o.v : 8), wait: 0, hitCool: 0, honkCool: 0, st: 0,
    react: 0, rt: o.rt || 20, temper: 0.5, x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, hd: 0, st: 0 };
  v.l = v.tl = laneLat(v); place(r, v); v.px = v.x; v.pz = v.z; v.ph = v.h; v.hd = v.h; r.traffic.push(v); return v;
}

/* put the bike on the road at s (for the test tools and for coming back from the garage) */
function teleport(r, s) {
  var fr = roadMod.frame(r.road, s, C.LANES[1]), b = r.bike;
  b.x = b.px = fr.x; b.z = b.pz = fr.z; b.h = b.ph = fr.h; b.s = s; b.lat = C.LANES[1]; b.speed = 0; b.i = Math.round(s / r.road.ds) % r.road.N; r.state = 'ride';
  r.traffic = []; if (!r.noSpawn) fillAround(r, s);
}

module.exports = { teleport: teleport, addVehicle: addVehicle, createRide: createRide, step: step, hash: hash, hitVehicle: hitVehicle, KINDS: KINDS };
