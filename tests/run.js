#!/usr/bin/env node
/* Headless tests: the simulation and core run in plain Node with no browser. */
'use strict';
var path = require('path'), assert = require('assert');
var S = path.join(__dirname, '..', 'src');
function req(p) { return require(path.join(S, p)); }

var rngMod = req('core/rng'), busMod = req('core/events'), inputMod = req('core/input'), loopMod = req('core/loop');
var saveMod = req('core/save'), scopeMod = req('core/scope'), modesMod = req('core/modes');
var fwMod = req('sim/fightworld'), boxmesh = req('view/boxmesh'), CONFIG = req('data/config');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('core');
test('rng: same seed gives same sequence, different seed differs', function () {
  var a = rngMod.createRng(5), b = rngMod.createRng(5), c = rngMod.createRng(6), i, same = true, diff = false;
  for (i = 0; i < 50; i++) { var x = a.next(); if (x !== b.next()) same = false; if (x !== c.next()) diff = true; }
  assert(same && diff);
});
test('rng: fork is independent of later draws on the parent', function () {
  var a = rngMod.createRng(9), f1 = a.fork(1), v1 = f1.next();
  var b = rngMod.createRng(9), f2 = b.fork(1); b.next(); b.next();
  assert.strictEqual(v1, f2.next());
});
test('rng: state can be saved and restored', function () {
  var a = rngMod.createRng(3); a.next(); var st = a.getState(), n1 = a.next();
  a.setState(st); assert.strictEqual(a.next(), n1);
});
test('events: on, emit order, off', function () {
  var bus = busMod.createBus(), log = [];
  var off = bus.on('x', function (p) { log.push('a' + p); }); bus.on('x', function (p) { log.push('b' + p); });
  bus.emit('x', 1); off(); bus.emit('x', 2);
  assert.deepStrictEqual(log, ['a1', 'b1', 'b2']);
});
test('scope: disposes in reverse order and survives a throwing cleanup', function () {
  var s = scopeMod.createScope(), log = [];
  s.add(function () { log.push(1); }); s.add(function () { throw new Error('x'); }); s.add(function () { log.push(3); });
  s.dispose(); assert.deepStrictEqual(log, [3, 1]); assert.strictEqual(s.size(), 0);
});
test('loop: fixed steps from uneven frame times', function () {
  var steps = 0, l = loopMod.createLoop({ hz: 60, step: function () { steps++; }, render: function () {} });
  var total = 0, dts = [7, 30, 16.7, 1, 45, 16, 16, 16.7, 5]; dts.forEach(function (d) { l.advance(d); total += d; });
  assert(Math.abs(steps - Math.floor(total / (1000 / 60))) <= 1, 'steps ' + steps);
});
test('loop: a long stall is clamped, not replayed', function () {
  var steps = 0, l = loopMod.createLoop({ hz: 60, maxSteps: 5, step: function () { steps++; } });
  l.advance(5000); assert.strictEqual(steps, 5); assert(l.getDropped() > 0);
});
test('loop: time scale slows the simulation', function () {
  var a = 0, b = 0, l1 = loopMod.createLoop({ hz: 60, step: function () { a++; } }), l2 = loopMod.createLoop({ hz: 60, step: function () { b++; } });
  l2.setTimeScale(0.5); for (var i = 0; i < 60; i++) { l1.advance(1000 / 60 + 0.001); l2.advance(1000 / 60 + 0.001); }
  assert(a >= 59 && b >= 29 && b <= 31);
});
test('input: press and release edges, held ticks', function () {
  var inp = inputMod.createInput(), s = inp.state;
  inp.tick(0); assert(!s.pressed.attack);
  inp.setButton('attack', true); inp.tick(1); assert(s.pressed.attack && s.held.attack && s.heldTicks.attack === 1);
  inp.tick(2); assert(!s.pressed.attack && s.heldTicks.attack === 2);
  inp.setButton('attack', false); inp.tick(3); assert(s.released.attack && !s.held.attack);
});
test('input: buffered press is consumed once inside the window', function () {
  var inp = inputMod.createInput();
  inp.setButton('block', true); inp.tick(10); inp.setButton('block', false); inp.tick(14);
  assert(inp.consume('block')); assert(!inp.consume('block'));
  inp.setButton('block', true); inp.tick(20); inp.setButton('block', false); inp.tick(30);
  assert(!inp.consume('block'), 'too old');
});
test('input: stick is clamped to the unit circle', function () {
  var inp = inputMod.createInput(); inp.setAxis(1, 1); inp.tick(0);
  var m = Math.hypot(inp.state.mx, inp.state.my); assert(Math.abs(m - 1) < 1e-9);
});
test('save: falls back to memory when storage throws', function () {
  var bad = { getItem: function () { throw new Error('no'); }, setItem: function () { throw new Error('no'); } };
  var s = saveMod.createSave(bad); s.set('a', 5); assert.strictEqual(s.get('a'), 5); assert(!s.persistent());
  var s2 = saveMod.createSave(null); assert.strictEqual(s2.get('zz', 7), 7);
});
test('modes: exit disposes the previous scope before the next enter', function () {
  var log = [], ctx = { bus: busMod.createBus() }, m = modesMod.createModes(ctx);
  m.register({ name: 'a', enter: function (c, sc) { log.push('enter a'); sc.add(function () { log.push('free a'); }); }, step: function () {}, exit: function () { log.push('exit a'); } });
  m.register({ name: 'b', enter: function () { log.push('enter b'); }, step: function () {}, exit: function () {} });
  m.switchTo('a'); m.switchTo('b');
  assert.deepStrictEqual(log, ['enter a', 'exit a', 'free a', 'enter b']);
});

console.log('sim');
/* a recorded fight at five places (scripted stick, blows and blocks): every one of these was checked tick by tick against the old street
   brawler before it was removed (same blows, same knockdowns, same health), so a change here means the fighting itself has changed */
function replay(type, ti, atkP) {
  var lineupMod = req('sim/lineup'), G = req('data/gangs');
  var lu = lineupMod.lineup(3, rngMod.createRng(99 + ti), G.GANGS[G.gangOf(type)].mix), fw = fwMod.create({ seed: 12345 + ti, bus: { emit: function () {} }, type: type, lineup: lu });
  var r = rngMod.createRng(7 + ti), I = inputMod.createInput(), sched = [], lock = -1, ci = 0, MV = ['jab', 'cross', 'hook', 'kick', 'uppercut'], t, q;
  for (t = 0; t < 2400 && fw.state === 'fight'; t++) {
    var a = r.next(), mx = Math.sin(t / 37) * (a < 0.5 ? 1 : 0), my = Math.cos(t / 53) * (a < 0.5 ? 1 : 0), atk = r.next() < atkP, blk = r.next() < 0.08;
    I.setAxis(mx, my); I.setButton('attack', atk); I.setButton('block', blk); I.tick(t);
    if (I.state.pressed.attack && !(lock > t)) { lock = t + 22; sched.push({ at: t + 9, move: MV[ci % 5], last: ci % 5 === 4 }); ci++; }
    for (q = sched.length - 1; q >= 0; q--) if (sched[q].at === t) { fw.pendingStrikes.push({ move: sched[q].move, last: sched[q].last }); sched.splice(q, 1); }
    fw.attackLock = lock > t; fwMod.step(fw, I);
  }
  return [fw.state, fw.combat.kills, fw.player.hp, fwMod.hash(fw)];
}
test('fight replay: recorded fights play out exactly as recorded (won, knocked out and still going)', function () {
  /* re-recorded for build 73 after checking that, with the old get-up length (30 ticks) and the old loss delay, these same replays still
     give the old values exactly: the only changes are the goons' longer get-up and Maa ka Thappad instead of a lost fight */
  /* re-recorded again for build 80 (the guitar counter no longer spends rage): with rage left out of the hash, old and new code give
     identical fingerprints for every replay, and the outcomes, kills and health are unchanged. Market re-recorded once more in build 80:
     its lane now has baskets along both sides that the men walk round (the other recorded places' props did not move) */
  /* re-recorded for build 94 (ordinary knockdowns): with the knockdown switched off (KD_GAP huge) every replay gives the old values
     exactly; the only changes come from the stick and heavy blows now flooring him for a moment untouchable */
  var GOLD = { market: [['cleared', 6, 74, 3440018290], ['thappad', 0, 0, 3086184449]], temple: [['cleared', 6, 47, 2381917211], ['fight', 2, 29, 1480076574]],
    toll: [['cleared', 6, 35, 2010628159], ['thappad', 2, 0, 1515159462]], railway: [['cleared', 6, 100, 3945096846], ['thappad', 2, 0, 2022374063]], warehouse: [['cleared', 6, 61, 2598942102], ['thappad', 1, 0, 2910714258]] };
  if (process.env.PRINT_GOLD) Object.keys(GOLD).forEach(function (type, i) { console.log(type, JSON.stringify([replay(type, i, 0.3), replay(type, i, 0.03)]), JSON.stringify(GOLD[type])); });
  Object.keys(GOLD).forEach(function (type, i) { assert.deepStrictEqual([replay(type, i, 0.3), replay(type, i, 0.03)], GOLD[type], type); });
});
test('fight: identical inputs from the same seed give identical hashes; different input changes it', function () {
  function run(seed, k) {
    var fw = fwMod.create({ seed: seed, type: 'temple' }), inp = inputMod.createInput();
    for (var t = 0; t < 900; t++) { inp.setAxis(Math.sin(t / 50) * k, Math.cos(t / 37)); inp.setButton('attack', t % 40 === 5); inp.setButton('block', t % 90 === 30); inp.tick(t); fwMod.step(fw, inp); }
    return fwMod.hash(fw);
  }
  assert.strictEqual(run(11, 1), run(11, 1)); assert.notStrictEqual(run(11, 1), run(12, 1)); assert.notStrictEqual(run(11, 1), run(11, 0.5));
});
test('brawl entrance: with intro the men wait (no one moves, nothing lands) until begin(); then the fight runs as ever', function () {
  var fwm = req('sim/fightworld'), inputMod3 = req('core/input'), ev = [];
  var fw = fwm.create({ seed: 11, type: 'market', intro: true, bus: { emit: function (n) { ev.push(n); } } }), inp = inputMod3.createInput(), t;
  assert.strictEqual(fw.state, 'intro');
  var before = JSON.stringify(fw.combat.enemies.map(function (e) { return [e.x, e.z, e.st]; }));
  for (t = 0; t < 600; t++) { inp.tick(fw.tick); fwm.step(fw, inp); }
  assert.strictEqual(JSON.stringify(fw.combat.enemies.map(function (e) { return [e.x, e.z, e.st]; })), before, 'a man moved during the entrance');
  assert.strictEqual(fw.player.hp, fw.player.maxHp); assert(ev.indexOf('playerHurt') < 0);
  assert(fwm.begin(fw)); assert.strictEqual(fw.state, 'fight'); assert(ev.indexOf('fight:go') >= 0); assert(!fwm.begin(fw), 'begin twice');
  for (t = 0; t < 600; t++) { inp.tick(fw.tick); fwm.step(fw, inp); }
  assert.notStrictEqual(JSON.stringify(fw.combat.enemies.map(function (e) { return [e.x, e.z, e.st]; })), before, 'the fight never started');
});
test('rage: the guitar counter costs nothing; only the finisher spends the bar', function () {
  var f = fightWorld(), p = f.w.player; p.rage = 80; req('sim/combat').spawn(f.w, 'thug', 0, 1.2); var e = f.w.combat.enemies[0];
  e.st = 'windup'; e.t = Math.ceil(req('data/enemies').KINDS.thug.windup * 60 * 0.6); e.cd = 9999;
  f.inp.setButton('block', true); f.tick(1); f.inp.setButton('block', false); f.tick(1);
  var c = f.ev.filter(function (q) { return q[0] === 'counter'; });
  assert.strictEqual(c.length, 1); assert.strictEqual(c[0][1].kind, 'special'); assert(p.rage >= 80, 'rage went down: ' + p.rage);
});
test('rage gate: the finisher only fires at full rage, then resets', function () {
  var f = fightWorld(), p = f.w.player;
  function press(name) { f.inp.setButton(name, true); f.tick(1); f.inp.setButton(name, false); f.tick(1); }
  p.rage = 99; press('finisher'); assert.strictEqual(f.w.counters.finishers, 0);
  p.rage = 100; press('finisher'); assert.strictEqual(f.w.counters.finishers, 1); assert.strictEqual(p.rage, 0);
});


console.log('fight');
/* a bare fight: open ground round the origin, no men yet, Toofan at the centre facing +z (each test brings its own men) */
function fightWorld() {
  var bus = busMod.createBus(), w = fwMod.create({ seed: 7, bus: bus, type: 'market' }), inp = inputMod.createInput(), t = 0, ev = [];
  w.combat.enemies.length = 0; w.hadMen = false; w.arena = { solids: [], ox: 0, oz: 0 }; w.bounds = { x0: -60, z0: -60, x1: 60, z1: 60 };
  var p = w.player; p.x = p.px = 0; p.z = p.pz = 0; p.face = 0;
  ['hit', 'enemyBlock', 'block', 'counter', 'guardbreak', 'playerHurt', 'heroFloored', 'heroUp', 'ko', 'wave', 'heroDown', 'fight:clear', 'fight:lost', 'fight:thappad', 'fight:rise', 'fight:spark', 'fight:resume'].forEach(function (n) { bus.on(n, function (e) { ev.push([n, e]); }); });
  return { w: w, inp: inp, ev: ev, tick: function (n) { for (var i = 0; i < (n || 1); i++) { inp.tick(t++); fwMod.step(w, inp); } },
    count: function (n) { return ev.filter(function (e) { return e[0] === n; }).length; } };
}
var combatMod = req('sim/combat');
var _spawn = combatMod.spawn; combatMod.spawn = function (w, k, x, z) { _spawn(w, k, x, z); w.combat.enemies[w.combat.enemies.length - 1].canBlock = false; };       /* tests opt in to guarding */
test('fight: a jab that lands damages the thug, builds rage and the combo counter', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.2); var e = f.w.combat.enemies[0]; e.cd = 9999;
  f.w.player.face = 0; f.w.pendingStrikes.push('jab'); f.tick(1);
  assert.ok(e.hp < 8.8, 'hp ' + e.hp); assert.ok(f.w.player.rage > 0); assert.strictEqual(f.w.combat.combo, 1); assert.strictEqual(f.count('hit'), 1);
});
test('fight: a strike behind the hero misses', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, -1.2); var e = f.w.combat.enemies[0]; e.cd = 9999;
  f.w.player.face = 0; f.w.pendingStrikes.push('jab'); f.tick(1); assert.strictEqual(e.hp, 8.8);
});
test('fight: thug telegraphs, then strikes; undefended hit costs health', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.0); var e = f.w.combat.enemies[0]; e.cd = 0; f.tick(1);
  assert.strictEqual(e.st, 'windup'); var hp0 = f.w.player.hp; f.tick(70); assert.ok(f.w.player.hp < hp0); assert.strictEqual(f.count('playerHurt'), 1);
});
test('fight: walking out of reach during the telegraph dodges the swing', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.0); var e = f.w.combat.enemies[0]; e.cd = 0; f.tick(1);
  f.w.player.z -= 2.5; f.tick(70); assert.strictEqual(f.w.player.hp, 100);
});
test('fight: held block absorbs the first hit, the second breaks the guard', function () {
  var f = fightWorld(); f.inp.setButton('block', true); f.tick(30);                  /* block held long enough that it is not a timed block */
  for (var k = 0; k < 2; k++) { combatMod.spawn(f.w, 'thug', 0, 1.0); var e = f.w.combat.enemies[k]; e.cd = 0; e.st = 'windup'; e.t = 0; f.tick(60); e.st = 'dead'; e.dead = true; }
  assert.strictEqual(f.count('block'), 1); assert.strictEqual(f.count('guardbreak'), 1);
});
test('fight: pressing Block once the alert is yellow counters at once, no damage', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.0); var e = f.w.combat.enemies[0]; e.cd = 0; f.tick(1);
  assert.strictEqual(e.st, 'windup'); f.tick(8); f.inp.setButton('block', true); f.tick(1);
  assert.strictEqual(f.count('counter'), 0, 'the white phase is too early');
  f.inp.setButton('block', false); f.tick(2); f.tick(8); f.inp.setButton('block', true); f.tick(2);
  assert.strictEqual(f.count('counter'), 1, 'yellow phase counters'); assert.strictEqual(e.st, 'hurt'); f.tick(60); assert.strictEqual(f.w.player.hp, 100); assert.ok(f.w.player.rage >= 16);
});
test('fight: two attackers alerting together make the counter a double takedown; one man gets a direct hit and the hero turns to him', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.0); combatMod.spawn(f.w, 'thug', 0.6, 1.2); f.w.combat.enemies.forEach(function (e) { e.st = 'windup'; e.t = 22; });
  var got = null; f.w.bus.on('counter', function (e) { got = e; }); f.inp.setButton('block', true); f.tick(1);
  assert.ok(got && got.kind === 'double', 'double takedown');
  var g = fightWorld(); combatMod.spawn(g.w, 'thug', 0, -1.0); var e2 = g.w.combat.enemies[0]; e2.st = 'windup'; e2.t = 22; g.w.player.face = 0; var got2 = null; g.w.bus.on('counter', function (e) { got2 = e; });
  g.inp.setButton('block', true); g.tick(1); assert.ok(got2 && got2.kind === 'direct', 'single man: a direct hit'); assert.ok(Math.abs(Math.abs(g.w.player.face) - Math.PI) < 0.01, 'the hero turns to face him');
});
test('fight: a stick swing cannot be blocked', function () {
  var f = fightWorld(); f.inp.setButton('block', true); f.tick(30);
  combatMod.spawn(f.w, 'stick', 0, 1.2); var e = f.w.combat.enemies[0]; e.cd = 0; f.tick(1); f.tick(80);
  assert.strictEqual(f.count('playerHurt'), 1);
});
test('fight: the finisher whirl clears everybody around; the place is cleared and no new wave comes', function () {
  var f = fightWorld(); [[1.5, 0], [-1.5, 0.4], [0, -2], [2.5, 2]].forEach(function (p) { combatMod.spawn(f.w, 'thug', p[0], p[1]); });
  f.w.combat.enemies.forEach(function (e) { e.cd = 9999; });
  for (var h = 0; h < 6; h++) f.w.pendingStrikes.push('finisherWhirl'); f.tick(1);
  assert.strictEqual(f.count('ko'), 4); f.tick(400); assert.strictEqual(f.count('fight:clear'), 1); assert.strictEqual(f.count('wave'), 0); assert.strictEqual(f.w.state, 'cleared');
});
test('fight: knocked out, Maa ka Thappad: the fight holds (never back to the ride) until revive', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.0); combatMod.spawn(f.w, 'thug', 5, 5); var e = f.w.combat.enemies[0]; e.cd = 0; f.w.player.hp = 1;
  f.tick(200); assert.strictEqual(f.w.state, 'thappad'); assert.strictEqual(f.count('fight:thappad'), 1); assert.strictEqual(f.count('fight:lost'), 0);
  var snap = JSON.stringify(f.w.combat.enemies.map(function (q) { return [q.x, q.z, q.st, q.hp]; })); f.tick(600);
  assert.strictEqual(JSON.stringify(f.w.combat.enemies.map(function (q) { return [q.x, q.z, q.st, q.hp]; })), snap, 'nobody moves while Maa is there');
});
test('fight: revive: full health, the rock stand and the spark, the goons step back amazed, then the fight goes on and can be won', function () {
  var f = fightWorld(), RISE = fwMod.RISE; combatMod.spawn(f.w, 'thug', 0, 0.9); combatMod.spawn(f.w, 'thug', -0.8, -0.6); var c = f.w.combat;
  c.enemies.forEach(function (q) { q.cd = 0; }); f.w.player.hp = 1; f.tick(200); assert.strictEqual(f.w.state, 'thappad');
  var d0 = c.enemies.map(function (q) { return Math.hypot(q.x - f.w.player.x, q.z - f.w.player.z); });
  assert(fwMod.revive(f.w)); assert.strictEqual(f.w.state, 'rise'); assert.strictEqual(f.w.player.hp, 100); assert(!f.w.player.down);
  f.tick(fwMod.SPARK + 2); assert.strictEqual(f.count('fight:spark'), 1); assert(c.enemies.every(function (q) { return q.st === 'awe'; }), 'everyone amazed');
  f.tick(40); c.enemies.forEach(function (q, i) { assert(Math.hypot(q.x - f.w.player.x, q.z - f.w.player.z) > d0[i] + 0.8, 'stepped back'); });
  var guard = 0; while (f.w.state === 'rise' && guard++ < RISE) f.tick(1); assert.strictEqual(f.w.state, 'fight'); assert.strictEqual(f.count('fight:resume'), 1); assert.strictEqual(c.enemies.length, 2, 'the same men');
  var hp = f.w.player.hp; c.enemies.forEach(function (q) { q.x = f.w.player.x; q.z = f.w.player.z + 1; q.st = 'windup'; q.t = 999; }); f.tick(3); assert.strictEqual(f.w.player.hp, hp, 'a moment where he cannot be hurt');
  c.enemies.forEach(function (q) { q.dead = true; q.st = 'dead'; q.t = 0; }); f.tick(2); assert.strictEqual(f.w.state, 'cleared');
});
test('fight: a knocked-down goon takes a proper get-up (1.2 s) before he fights again', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 2); var e = f.w.combat.enemies[0]; e.st = 'down'; e.t = 78; e.hp = 5; f.w.player.hp = 1e6;
  f.tick(1); assert.strictEqual(e.st, 'getup'); f.tick(60); assert.strictEqual(e.st, 'getup'); f.tick(14); assert.strictEqual(e.st, 'approach');
});
test('fight: an unguarded thug takes six blows of the string before he falls, and stays where he stands', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.1); var e = f.w.combat.enemies[0]; e.cd = 9999; f.w.player.face = 0;
  var seq = req('data/moves').makeString(function () { return 0; }), k;
  for (k = 0; k < 5; k++) { f.w.pendingStrikes.push({ move: seq[k], last: false }); f.tick(1); assert.ok(e.hp > 0 && e.st === 'hurt', 'hit ' + k + ' hp ' + e.hp + ' ' + e.st); assert.ok(Math.hypot(e.x, e.z - 1.1) < 0.05, 'did not get pushed away'); }
  f.w.pendingStrikes.push({ move: seq[5], last: false }); f.tick(1); assert.strictEqual(e.st, 'down'); assert.ok(e.dead);
});
test('fight: a guarding enemy blocks the first two blows, then his cover breaks and the third lands', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.1); var e = f.w.combat.enemies[0]; e.cd = 9999; e.canBlock = true; f.w.player.face = 0;
  f.tick(2); assert.ok(e.guarding, 'guard is up'); var hp = e.hp;
  f.w.pendingStrikes.push('jab'); f.tick(1); assert.strictEqual(e.hp, hp); assert.ok(e.guarding);
  f.w.pendingStrikes.push('cross'); f.tick(1); assert.strictEqual(e.hp, hp); assert.strictEqual(e.st, 'guardbreak');
  f.w.pendingStrikes.push('jab'); f.tick(1); assert.ok(e.hp < hp, 'the third blow lands');
  assert.strictEqual(f.ev.filter(function (x) { return x[0] === 'enemyBlock'; }).length, 2);
});
test('fight: guitar counters and the finisher go straight through a guard', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.1); var e = f.w.combat.enemies[0]; e.cd = 9999; e.canBlock = true; f.w.player.face = 0; f.tick(2);
  assert.ok(e.guarding); f.w.pendingStrikes.push('counterSmash'); f.tick(1); assert.ok(e.hp < 8.8);
});
test('fight: a heavy\'s unblockable punch floors Toofan; he is untouchable until he is up in his rock stand; a second within the gap only staggers', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'heavy', 0, 1.2); var e = f.w.combat.enemies[0], p = f.w.player; p.face = Math.PI;   /* (facing away: no guard) */
  var i; for (i = 0; i < 600 && !f.count('heroFloored'); i++) f.tick(1);
  assert.strictEqual(f.count('heroFloored'), 1, 'the heavy\'s punch floors him'); assert.ok(p.kd > 0 && p.hp > 0 && !p.down);
  var hp = p.hp; f.tick(combatMod.KD - 5); assert.strictEqual(p.hp, hp, 'nobody hurts him while he is down and getting up'); assert.ok(p.kd > 0);
  f.tick(10); assert.strictEqual(p.kd, 0); assert.strictEqual(f.count('heroUp'), 1, 'up again');
  for (i = 0; i < 300 && f.count('playerHurt') < 2; i++) f.tick(1);
  assert.strictEqual(f.count('playerHurt'), 2, 'the heavy lands again'); assert.strictEqual(f.count('heroFloored'), 1, 'but within the gap it only staggers him');
  f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.2); f.w.player.face = Math.PI;
  for (i = 0; i < 600 && !f.count('playerHurt'); i++) f.tick(1);
  assert.strictEqual(f.count('playerHurt'), 1); assert.strictEqual(f.count('heroFloored'), 0, 'an ordinary punch never floors him');
});
test('fight: a normal blow hits only one man', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0.2, 1.1); combatMod.spawn(f.w, 'thug', -0.2, 1.3);
  f.w.combat.enemies.forEach(function (e) { e.cd = 9999; }); f.w.player.face = 0; f.w.pendingStrikes.push('roundhouse'); f.tick(1);
  assert.strictEqual(f.count('hit'), 1);
});
test('fight: enemies queue up - two or three fight at once, the rest hold a ring', function () {
  var f = fightWorld(), pts = [], c = f.w.combat, k; for (k = 0; k < 7; k++) pts.push({ x: Math.cos(k * 0.9) * 9, z: Math.sin(k * 0.9) * 9 }); c.wave = 2; c.lineup = ['thug', 'thug', 'thug', 'thug', 'thug', 'thug', 'stick']; combatMod.startLocation(f.w, 'test', pts, 7, 1); var maxAtt = 0, maxClose = 0;
  for (var i = 0; i < 900; i++) {
    f.w.player.hp = 100; f.tick(1);
    var att = 0, close = 0; c.enemies.forEach(function (e) { if (e.st === 'windup' || e.st === 'strike') att++; if (Math.hypot(e.x - f.w.player.x, e.z - f.w.player.z) < 2.3) close++; });
    if (att > maxAtt) maxAtt = att; if (close > maxClose) maxClose = close;
  }
  assert.ok(maxAtt <= 3, 'attackers ' + maxAtt); assert.ok(maxClose <= 3, 'close ' + maxClose);
});
test('lock-on: the stick picks the target, the lock holds, blows go to him, and the hero closes the gap', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 2.0, 0); combatMod.spawn(f.w, 'thug', -2.0, 0.2); f.w.combat.enemies.forEach(function (e) { e.cd = 9999; });
  f.inp.setAxis(1, 0); f.inp.setButton('attack', true); f.tick(1); f.inp.setButton('attack', false); f.inp.setAxis(0, 0);
  var east = f.w.combat.enemies[0]; assert.strictEqual(f.w.combat.target, east.id, 'stick right locks the east man');
  f.tick(5); assert.strictEqual(f.w.combat.target, east.id, 'the lock holds with the stick released');
  f.w.attackLock = true; var d0 = Math.hypot(east.x - f.w.player.x, east.z - f.w.player.z); f.tick(30); var d1 = Math.hypot(east.x - f.w.player.x, east.z - f.w.player.z);
  assert.ok(d1 < d0 - 0.5 && d1 > 0.9, 'closed the gap ' + d0.toFixed(2) + ' -> ' + d1.toFixed(2)); f.w.attackLock = false;
  f.inp.setAxis(-1, 0); f.inp.setButton('attack', true); f.tick(1); f.inp.setButton('attack', false);
  assert.strictEqual(f.w.combat.target, f.w.combat.enemies[1].id, 'stick left switches to the west man');
  east.st = 'down'; f.tick(1); f.inp.setAxis(0, 0);
});
test('fight: same seed and inputs give the same fight', function () {
  function run() { var f = fightWorld(), pts = [{ x: 6, z: 0 }, { x: -6, z: 1 }, { x: 0, z: 7 }, { x: 1, z: -6 }]; combatMod.startLocation(f.w, 'test', pts, 4, 1); f.tick(300); return fwMod.hash(f.w) + ':' + f.w.combat.enemies.map(function (e) { return e.x.toFixed(3) + e.st; }).join(); }
  assert.strictEqual(run(), run());
});

console.log('arenas and memory budget');
test('mesh: every arena stays under the triangle budget', function () {
  var ag = req('sim/arenagen'), LOCD = req('data/locations'), worst = 0;
  LOCD.ORDER.forEach(function (type) {
    var a = ag.build(21, type, 0, 0), tris = boxmesh.boxesToArrays(a.boxes, CONFIG.PALETTE).triangles;
    a.tall.forEach(function (g) { tris += boxmesh.boxesToArrays(g.boxes, CONFIG.PALETTE).triangles; }); worst = Math.max(worst, tris);
    assert(tris <= CONFIG.BUDGET.maxTriangles, type + ' triangles ' + tris);
  });
  console.log('       busiest arena: ' + worst + ' triangles');
});
test('mesh: arrays are consistent', function () {
  var a = boxmesh.boxesToArrays([{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 2, z1: 3, c: 0 }], CONFIG.PALETTE);
  assert.strictEqual(a.triangles, 10); assert.strictEqual(a.positions.length, 5 * 4 * 3); assert.strictEqual(Math.max.apply(null, a.indices), 19);
});

test('gait: loops seamlessly, stays inside joint limits, bobs twice per stride', function () {
  var pm = req('view/posemath'), J = req('data/poses').JOINTS, lim = {};
  J.forEach(function (g) { g.rows.forEach(function (r) { lim[r[0]] = [r[2], r[3]]; }); });

test('counters: three guitar counters draw from the back, fire their hits and the boom effect, and sling the guitar back', function () {
  var mp = req('view/moveplayer'), M = req('data/moves');
  assert.deepStrictEqual(M.COUNTERS, ['counterBoom', 'counterSmash', 'counterWhirl']);
  M.COUNTERS.forEach(function (n) {
    var m = M.MOVES[n], P = mp.createMovePlayer(), hits = 0, fx = [], i, maxOn = 0;
    P.onHit(function () { hits++; }); P.onFx(function (k) { fx.push(k); }); P.play(n);
    for (i = 0; i < 60 * 4 && P.active(); i++) { P.update(1 / 60); }
    for (i = 0; i <= 100; i++) { var on = mp.clipPose(n, m.len * i / 100)['gtr.on']; assert(on >= -1e-9 && on <= 1 + 1e-9, n + ' gtr.on out of range'); maxOn = Math.max(maxOn, on); }
    assert.strictEqual(maxOn, 1, n + ' never holds the guitar');
    assert.strictEqual(mp.clipPose(n, 0)['gtr.on'], 0); assert.strictEqual(mp.clipPose(n, m.len)['gtr.on'], 0);
    assert.strictEqual(hits, (m.hits || [m.hit]).length, n + ' hit count');
    if (n === 'counterBoom') assert.deepStrictEqual(fx, ['boom']);
  });
});

test('sim: no walking while a move plays or Block is held', function () {
  var f = fightWorld(), w = f.w, inp = f.inp, x0;
  inp.setAxis(1, 0); f.tick(1);
  x0 = w.player.x; f.tick(30);
  assert(w.player.x > x0 + 0.5, 'walks when free');
  w.attackLock = true; x0 = w.player.x; f.tick(30);
  assert.strictEqual(w.player.x, x0); assert.strictEqual(w.player.moving, false);
  w.attackLock = false; inp.setButton('block', true); f.tick(1); x0 = w.player.x;
  f.tick(30);
  assert.strictEqual(w.player.x, x0, 'held block pins the hero');
});
test('camera: finisher and counters fly a continuous shot that returns to the chase camera', function () {
  var cc = req('view/cinecam'), M = req('data/moves');
  M.COUNTERS.concat([M.FINISHER]).forEach(function (n) {
    var m = M.MOVES[n], D = cc.createDirector(), prev = null, t, worst = 0;
    assert(m.cam && m.cam.length >= 4, n + ' has camera keys');
    for (t = 0; t <= m.len; t += 1 / 60) {
      D.update(1 / 60, n, t, Math.min(t / 0.55, (m.len - t) / 0.7, 1));
      var c = D.resolve(2, 3, 1.2);
      ['x', 'y', 'z', 'lx', 'ly', 'lz', 'fov'].forEach(function (k) { assert(isFinite(c[k]), n + ' ' + k); });
      if (prev) worst = Math.max(worst, Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z));
      prev = c;
    }
    assert(worst < 1.6, n + ' camera jumps ' + worst.toFixed(2) + ' m in a frame');
    D.update(1 / 60, null, 0, 0); assert.strictEqual(D.weight, 0);
  });
});
test('moves: every clip starts and ends in guard, stays in joint limits, and fires one hit', function () {
  var mp = req('view/moveplayer'), M = req('data/moves'), J = req('data/poses').JOINTS, lim = {};
  J.forEach(function (g) { g.rows.forEach(function (r) { lim[r[0]] = [r[2], r[3]]; }); });
  Object.keys(M.MOVES).forEach(function (n) {
    var m = M.MOVES[n], i, k;
    for (i = 0; i <= 50; i++) {
      var p = mp.clipPose(n, m.len * i / 50);
      for (k in p) if (lim[k]) assert(p[k] >= lim[k][0] - 1e-6 && p[k] <= lim[k][1] + 1e-6, n + ' ' + k + ' ' + p[k]);
    }
    var a = mp.clipPose(n, 0), b = mp.clipPose(n, m.len);
    for (k in M.GUARD) assert(Math.abs(a[k] - M.GUARD[k]) < 1e-9 && Math.abs(b[k] - M.GUARD[k]) < 1e-9, n + ' not in guard at ' + k);
    assert(m.hit < m.cancel && m.cancel < m.len, n + ' timing');
  });
});
test('moves: repeated presses walk the seven-blow string, then it resets; a different roll gives a different string', function () {
  var mp = req('view/moveplayer'), M = req('data/moves'), P = mp.createMovePlayer({ rand: function () { return 0; } }), seq = [], hits = 0, i;
  P.onHit(function (m) { hits++; seq.push(m); });
  P.press();
  for (i = 0; i < 1500; i++) { var o = P.update(1 / 60); if (i % 5 === 0 && hits < 7) P.press(); }
  assert.deepStrictEqual(seq, M.makeString(function () { return 0; })); assert.strictEqual(seq.length, 7);
  assert.deepStrictEqual(seq.slice(0, 2), ['jab', 'cross'], 'opens with the jab'); assert.strictEqual(seq[4], 'uppercut');
  P.press(); var first = null; for (i = 0; i < 60; i++) { var o2 = P.update(1 / 60); if (o2 && o2.move) first = o2.move; }
  assert.strictEqual(first, 'jab', 'a late press starts a fresh string');
  var other = M.makeString(function () { return 0.99; }); assert.notDeepStrictEqual(other, seq); assert.strictEqual(other[4], 'uppercut');
  assert.ok(other.slice(5).some(function (m) { return ['axeKick', 'knee', 'roundhouse'].indexOf(m) >= 0; }), 'a leg blow in the finish');
});
  [1, 1.7].forEach(function (amp) {
    var a = pm.walkPose(0, amp), b = pm.walkPose(1, amp), k, minY = 9, maxY = -9, i;
    for (k in a) assert(Math.abs(a[k] - b[k]) < 1e-6, 'seam ' + k);
    for (i = 0; i <= 100; i++) {
      var p = pm.walkPose(i / 100, amp);
      for (k in p) if (lim[k]) assert(p[k] >= lim[k][0] - 1e-6 && p[k] <= lim[k][1] + 1e-6, k + ' out of range');
      minY = Math.min(minY, p['hip.y']); maxY = Math.max(maxY, p['hip.y']);
    }
    assert(maxY - minY > 0.015 && maxY - minY < 0.08, 'pelvis bob');
    assert(Math.abs(pm.walkPose(0.25, amp)['hip.y'] - pm.walkPose(0.75, amp)['hip.y']) < 1e-6, 'two bobs per stride');
  });
});

test('fight: while a man is held in the broken-guard sequence, two others can still start attacks (even guarders, with the hero mid-swing)', function () {
  var f = fightWorld(); combatMod.spawn(f.w, 'thug', 0, 1.2); combatMod.spawn(f.w, 'thug', 1.3, 0.4); combatMod.spawn(f.w, 'thug', -1.3, 0.4);
  var c = f.w.combat, a = c.enemies[0], b = c.enemies[1], d = c.enemies[2]; a.cd = 9999; a.st = 'hurt'; a.t = 0; c.seqId = a.id; c.seqT = 9999; c.target = a.id;
  b.canBlock = true; b.cd = 0; d.canBlock = true; d.cd = 0; f.w.attackLock = true; f.w.player.hp = 1e6; var started = 0;
  f.w.bus.on('windup', function () { started++; });
  for (var i = 0; i < 90; i++) { f.w.attackLock = true; f.tick(1); if (f.w.player.stun > 0) f.w.player.stun = 0; if (!c.seqId) { c.seqId = a.id; c.seqT = 9999; } }
  assert.ok(started >= 2, 'others attacked: ' + started); assert.strictEqual(a.st, 'hurt', 'the dazed man is still held');
});

test('road fight moves: every saddle blow exists left and right, and the saddle counter', function () {
  var moves = req('data/moves'), names = ['Jab', 'Cross', 'Hook', 'Elbow', 'Kick'], n, sd;
  for (n = 0; n < names.length; n++) for (sd = 0; sd < 2; sd++) { var k = 'bk' + names[n] + 'LR'[sd]; assert(moves.MOVES[k] && !moves.MOVES[k].counter, k); }
  ['bkCElbowL', 'bkCElbowR'].forEach(function (k) { assert(moves.MOVES[k] && moves.MOVES[k].counter, k); });
  assert(moves.MOVES.bkJabL.keys[3].pose['armA.sx'] > 80 && moves.MOVES.bkJabR.keys[3].pose['armB.sx'] > 80, 'jab uses the near arm on each side');
});

test('fight areas: every kind of place opens its fight with its men close by, inside the walls and clear of props', function () {
  var LOCD = req('data/locations');
  LOCD.ORDER.forEach(function (type) {
    var fw = fwMod.create({ seed: 20261028, type: type }), inp = inputMod.createInput(), i, B = fw.bounds;
    for (i = 0; i < 100; i++) { inp.tick(i); fwMod.step(fw, inp); }
    var p = fw.player, far = fw.combat.enemies.filter(function (e) { return Math.hypot(e.x - p.x, e.z - p.z) > 25; }).length;
    assert(fw.combat.enemies.length >= 4 && far === 0, type + ': ' + fw.combat.enemies.length + ' men, ' + far + ' far away');
    fw.combat.enemies.forEach(function (e) { assert(e.x >= B.x0 - 1e-6 && e.x <= B.x1 + 1e-6 && e.z >= B.z0 - 1e-6 && e.z <= B.z1 + 1e-6, type + ': a man outside'); });
  });
});
test('arenas: every arena builds the same twice, its men start inside the walls and clear of props', function () {
  var ag = req('sim/arenagen'), LOCD = req('data/locations');
  LOCD.ORDER.filter(ag.has).forEach(function (type) {
    var a = ag.build(777, type, 4, 0), b = ag.build(777, type, 4, 0);
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b), type + ' not deterministic');
    var B = a.bounds;
    a.loc.spawns.forEach(function (s) {
      assert(s.x >= B.x0 && s.x <= B.x1 && s.z >= B.z0 && s.z <= B.z1, type + ': spawn outside ' + JSON.stringify(s));
      var inSolid = a.solids.some(function (q) { return q.y1 > 0.25 && s.x > q.x0 + a.ox && s.x < q.x1 + a.ox && s.z > q.z0 + a.oz && s.z < q.z1 + a.oz; });
      assert(!inSolid, type + ': spawn inside a prop ' + JSON.stringify(s));
    });
    var n = a.boxes.length + a.tall.reduce(function (t, g) { return t + g.boxes.length; }, 0);
    assert(a.tall.length >= 3 && n > 700, type + ': too bare (' + n + ' boxes, ' + a.tall.length + ' tall pieces)');
  });
});
test('arenas: a fight is only the arena: walking any way stays inside the walls, and there is no bike, city or traffic in it', function () {
  var LOCD = req('data/locations');
  LOCD.ORDER.forEach(function (type) {
    var fw = fwMod.create({ seed: 20261028, type: type }), inp = inputMod.createInput(), t = 0, i;
    fw.combat.enemies.length = 0;
    assert(!('bike' in fw) && !('traffic' in fw) && !('streaming' in fw) && !('locs' in fw), type + ': street parts in the fight');
    [[0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, -0.7]].forEach(function (dir) {
      inp.setAxis(dir[0], dir[1]);
      for (i = 0; i < 900; i++) { inp.tick(t++); fwMod.step(fw, inp); }
      var p = fw.player, B = fw.bounds;
      assert(p.x >= B.x0 - 1e-6 && p.x <= B.x1 + 1e-6 && p.z >= B.z0 - 1e-6 && p.z <= B.z1 + 1e-6, type + ': walked out going ' + dir);
    });
  });
});
(function () {
  var lineup = req('sim/lineup'), ED = req('data/enemies');
  test('fighters: the crowd grows from 4 to 8 with the places cleared, always with a lathi man, tougher kinds later', function () {
    var a = lineup.lineup(0, rngMod.createRng(3)), b = lineup.lineup(5, rngMod.createRng(3)), c = lineup.lineup(12, rngMod.createRng(3));
    assert.strictEqual(a.length, 4); assert.strictEqual(b.length, 8); assert.strictEqual(c.length, 8);
    [a, b, c].forEach(function (l) { assert(l.indexOf('stick') >= 0, 'no lathi man: ' + l); l.forEach(function (k) { assert(ED.KINDS[k], 'unknown kind ' + k); }); });
    assert(a.every(function (k) { return k === 'thug' || k === 'stick'; }), 'first fight should be simple: ' + a);
    var many = {}; for (var i = 0; i < 30; i++) lineup.lineup(5, rngMod.createRng(i)).forEach(function (k) { many[k] = 1; });
    assert(['kicker', 'chain', 'blocker', 'thrower', 'heavy'].every(function (k) { return many[k]; }), 'late fights should bring every kind: ' + Object.keys(many));
  });
  function arena(kind, dz) {
    var f = fightWorld(); combatMod.spawn(f.w, kind, 0, dz || 1.2); var e = f.w.combat.enemies[0]; e.cd = 0;
    return { w: f.w, e: e, inp: f.inp, bus: { on: function (n, fn) { f.w.bus.on(n, fn); } }, tick: f.tick };
  }
  test('fighters: the kicker kicks twice in a row', function () {
    var T = arena('kicker', 1.3), winds = 0, i; T.bus.on('windup', function () { winds++; }); T.w.player.hp = 1e6;
    for (i = 0; i < 160; i++) { T.tick(1); if (winds >= 2) break; }
    assert(winds >= 2, 'only ' + winds + ' kick');
  });
  test('fighters: a kick smashes the blocker\'s guard open; punches only wear it down', function () {
    var T = arena('blocker', 1.2), e = T.e; e.canBlock = true; e.guarding = true; e.face = Math.PI; var broke = null;
    T.bus.on('enemyBlock', function (ev) { broke = ev.broke; });
    combatMod.playerStrike(T.w, 'jab'); assert.strictEqual(broke, false, 'one jab should not break him');
    e.guarding = true; combatMod.playerStrike(T.w, 'kick'); assert.strictEqual(broke, true, 'a kick should break the guard');
  });
  test('fighters: the heavy stays on his feet under a kick until he is worn down', function () {
    var T = arena('heavy', 1.2), e = T.e; combatMod.playerStrike(T.w, { move: 'kick', last: true });
    assert.notStrictEqual(e.st, 'down', 'heavy floored by one kick'); assert(e.hp < e.maxHp);
  });
  test('fighters: the thrower keeps his distance and hits from range', function () {
    var T = arena('thrower', 2.0), i, hurt = 0; T.bus.on('playerHurt', function () { hurt++; }); T.w.player.hp = 1e6;
    T.tick(400);
    var d = Math.hypot(T.e.x - T.w.player.x, T.e.z - T.w.player.z);
    assert(d > 3, 'thrower stayed close: ' + d.toFixed(2)); assert(hurt > 0, 'no bottle landed');
  });
})();
test('gangs: every kind of place belongs to exactly one gang, two places each', function () {
  var G = req('data/gangs'), LOCD = req('data/locations'), count = {};
  LOCD.ORDER.forEach(function (t) { var g = G.gangOf(t); assert(g, t + ' has no gang'); count[g] = (count[g] || 0) + 1; });
  G.ORDER.forEach(function (g) { assert.strictEqual(count[g], 2, g + ' holds ' + count[g]); });
});
test('gangs: a gang\'s fights lean to its own kind of fighter once the ramp brings them in', function () {
  var lineup = req('sim/lineup'), G = req('data/gangs'), heavies = 0, kicks = 0, i;
  for (i = 0; i < 40; i++) { heavies += lineup.lineup(5, rngMod.createRng(i), G.GANGS.kalia.mix).filter(function (k) { return k === 'heavy'; }).length; kicks += lineup.lineup(5, rngMod.createRng(i), G.GANGS.bhairav.mix).filter(function (k) { return k === 'kicker'; }).length; }
  var h0 = 0, k0 = 0; for (i = 0; i < 40; i++) { var l = lineup.lineup(5, rngMod.createRng(i)); h0 += l.filter(function (k) { return k === 'heavy'; }).length; k0 += l.filter(function (k) { return k === 'kicker'; }).length; }
  assert(heavies > h0 && kicks > k0, 'heavies ' + heavies + ' vs ' + h0 + ', kickers ' + kicks + ' vs ' + k0);
});



/* ---------------- the curved road and the Bangalore ride ---------------- */
(function () {
  var roadMod = req('sim/road'), B = req('sim/bride'), COURSE = req('data/course'), inputMod3 = req('core/input'), rm = roadMod;
  function angD(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  var road = roadMod.build(7);
  test('road: a closed loop, long enough to ride, with no bend tighter than 20 m and no two far-apart parts near each other', function () {
    var f0 = roadMod.frame(road, 0, 0), f1 = roadMod.frame(road, road.length - 0.001, 0);
    assert(Math.hypot(f0.x - f1.x, f0.z - f1.z) < 0.05, 'the loop does not close'); assert(road.length > 1000 && road.length < 1600, 'length ' + road.length);
    var i, j, minR = 1e9, minSep = 1e9;
    for (i = 0; i < road.N; i++) { var d = angD(road.hs[(i + 1) % road.N], road.hs[i]); minR = Math.min(minR, road.ds / Math.abs(d || 1e-9)); }
    for (i = 0; i < road.N; i += 3) for (j = i + 1; j < road.N; j += 3) { if (Math.min(j - i, road.N - (j - i)) * road.ds < 150) continue; minSep = Math.min(minSep, Math.hypot(road.xs[i] - road.xs[j], road.zs[i] - road.zs[j])); }
    assert(minR >= 20, 'tightest bend ' + minR); assert(minSep >= 90, 'parts only ' + minSep + ' m apart');
  });
  test('road: a place along the road and a sideways offset survive the trip to a point and back', function () {
    [5, 120, 333.3, 640, 900.5, 1200].forEach(function (s) { [-5.1, -1.9, 0, 1.9, 5.1, 9].forEach(function (lat) {
      var fr = roadMod.frame(road, s, lat), pr = roadMod.project(road, fr.x, fr.z, Math.round(s / road.ds));
      assert(Math.abs(roadMod.gap(road, s, pr.s)) < 0.3, 's ' + s + ' came back as ' + pr.s); assert(Math.abs(pr.lat - lat) < 0.3, 'lat ' + lat + ' came back as ' + pr.lat);
    }); });
  });
  test('road: every kind of stretch is on the loop, and potholes only where the road is broken', function () {
    var kinds = {}, i; road.type.forEach(function (t) { kinds[t] = 1; });
    ['fast', 'jam', 'broken', 'combo'].forEach(function (k) { assert(kinds[k], 'no ' + k + ' stretch'); });
    assert(road.holes.length > 20, 'too few potholes: ' + road.holes.length);
    road.holes.forEach(function (h) { assert(roadMod.surfaceAt(road, h.s).type !== 'jam' || roadMod.surfaceAt(road, h.s).rough > 0, 'pothole in a clean stretch at ' + h.s); assert(Math.abs(h.l) < COURSE.HALF, 'pothole off the carriageway'); });
    var cleanSample = roadMod.surfaceAt(road, road.length * 0.1); assert.strictEqual(cleanSample.type, 'fast'); assert.strictEqual(cleanSample.rough, 0);
  });
  function drive(o) {
    var r = B.createRide(o.seed || 7, { emit: function (n, d) { (o.ev || (o.ev = [])).push(n); if (o.on) o.on(n, d); } }, { s: o.s, noTraffic: !!o.clear, noBrawl: !o.brawl }), inp = inputMod3.createInput(), i;
    if (o.setup) o.setup(r);
    for (i = 0; i < o.ticks; i++) {
      var b = r.bike, e = (o.lat === undefined ? 5.1 : o.lat) - b.lat, des = roadMod.project(r.road, b.x, b.z, b.i).h + Math.max(-0.5, Math.min(0.5, e * 0.15));
      inp.setAxis(-Math.max(-1, Math.min(1, angD(des, b.h) * 2.5)), o.thr === undefined ? 1 : o.thr); inp.tick(r.tick); B.step(r, inp);
      if (o.each) o.each(r);
    }
    return r;
  }
  test('bride: the same seed and the same inputs give the same ride, tick for tick; another seed differs', function () {
    assert.strictEqual(B.hash(drive({ seed: 7, ticks: 900 })), B.hash(drive({ seed: 7, ticks: 900 }))); assert.notStrictEqual(B.hash(drive({ seed: 7, ticks: 900 })), B.hash(drive({ seed: 8, ticks: 900 })));
  });
  test('bride: on a fast stretch he reaches full speed; on a broken one the bike is held to its cap; a jam does not slow him, only the traffic', function () {
    var fast = 0, broken = 0, bs = roadMod.surfaceAt(road, road.length * 0.52), top = 0;
    drive({ s: 20, ticks: 420, clear: true, each: function (r) { fast = Math.max(fast, r.bike.speed); } });
    drive({ s: road.length * 0.46, ticks: 360, clear: true, lat: 5.1, each: function (r) { if (r.stretch.type === 'broken' && r.stretch.cap < 0.6) broken = Math.max(broken, r.bike.speed); } });
    assert(fast > 16, 'only ' + fast + ' m/s on the open road'); assert(broken > 0 && broken <= 17 * 0.6, 'held to ' + broken + ' m/s on broken road, cap ' + bs.cap);
  });
  test('bride: riding into a pothole slows the bike, costs health and says so; a clean road does neither', function () {
    var h = road.holes.filter(function (q) { return !q.deep && Math.abs(q.l) < 4; })[0], ev = [], r = drive({ s: h.s - 12, lat: h.l, thr: 0.55, ticks: 300, clear: true, ev: ev });
    assert(ev.indexOf('ride:pothole') >= 0, 'no pothole event: ' + ev.join(',')); assert(r.bike.hp < 100, 'no damage');
    var ev2 = [], r2 = drive({ s: 20, ticks: 200, clear: true, ev: ev2 }); assert.strictEqual(r2.bike.hp, 100); assert(ev2.indexOf('ride:pothole') < 0);
  });
  test('bride: a vehicle coming head-on sees him, honks and swerves round; nothing touches', function () {
    var ev = [], r = drive({ s: 100, lat: -5.1, thr: 0.8, ticks: 420, clear: true, ev: ev, setup: function (r0) { B.addVehicle(r0, { s: 100 + 90, dir: -1, lane: 1, v: 9, base: 9, kind: 'car' }); } });
    assert(ev.indexOf('ride:honk') >= 0, 'no honk'); assert(ev.indexOf('ride:hit') < 0, 'it hit him'); assert.strictEqual(r.bike.hp, 100);
  });
  test('bride: one that has no room to swerve brakes instead of running him down', function () {
    var ev = [], r = drive({ s: 100, lat: 5.1, thr: 0.0, ticks: 360, clear: true, ev: ev, setup: function (r0) { r0.bike.speed = 0; B.addVehicle(r0, { s: 100 - 25, dir: 1, lane: 1, v: 10, base: 10, kind: 'bus' }); } });
    assert(ev.indexOf('ride:honk') >= 0, 'no honk'); assert.strictEqual(r.bike.hp, 100, 'the bus ran him down');
  });
  test('bride: touching a stopped vehicle at speed costs speed and health, the driver shouts, and a hard hit throws him off', function () {
    var ev = [], hits = [], r = drive({ s: 100, lat: 5.1, thr: 1, ticks: 300, clear: true, ev: ev, on: function (n, d) { if (n === 'ride:hit') hits.push(d); }, setup: function (r0) { B.addVehicle(r0, { s: 100 + 45, dir: 1, lane: 1, v: 0, base: 0, kind: 'car', rt: 9999 }); } });
    assert(hits.length >= 1 && hits[0].sev === 2, 'no hard hit: ' + JSON.stringify(hits[0])); assert(ev.indexOf('ride:crash') >= 0, 'not thrown'); assert(r.bike.hp <= 90, 'hp ' + r.bike.hp);
  });
  test('brawl: a touched, hot-tempered driver steps out and fights in place with Toofan\'s own combat; knocked fighters clear; he is back on the bike', function () {
    var ev = [], bus = { emit: function (n, d) { ev.push(n); } }, r = B.createRide(7, bus, { s: 100, noTraffic: true }), inp = inputMod3.createInput(), i, st;
    var v = B.addVehicle(r, { s: 112, dir: 1, lane: 1, v: 0, base: 0, kind: 'car', temper: 1 }); v.hitCool = 0;
    r.bike.speed = 14; r.rng = { next: function () { return 0; }, fork: function () { return this; } };                /* (the roll always says: get out) */
    for (i = 0; i < 400 && r.state !== 'brawl'; i++) { inp.setAxis(0, 1); inp.tick(r.tick); B.step(r, inp); }
    assert.strictEqual(r.state, 'brawl', 'no brawl: ' + r.state + ' ' + ev.join());
    assert(r.brawl && r.brawl.combat.enemies.length === 1 && r.brawl.joined === 1, 'the driver did not step out');
    r.rng = require(S + '/core/rng').createRng(5);
    var fw = r.brawl, e = fw.combat.enemies[0], hits = 0;
    for (i = 0; i < 3000 && r.state === 'brawl'; i++) {                       /* walk to him and mash attack */
      var pl = fw.player, dx = e.x - pl.x, dz = e.z - pl.z, d = Math.hypot(dx, dz) || 1;
      inp.setAxis(d > 1.2 ? dx / d : 0, d > 1.2 ? -dz / d : 0); if (i % 24 === 0 && d < 1.8) fw.pendingStrikes.push({ move: i % 72 === 0 ? 'cross' : 'jab', last: i % 72 === 0 }); inp.tick(r.tick); B.step(r, inp);
      if (fw.state === 'thappad') break;
    }
    assert(ev.indexOf('hit') >= 0, 'no blow landed'); assert(ev.indexOf('ride:join') >= 0);
    assert(r.state === 'ride' || fw.state === 'thappad', 'still in the fight: ' + r.state + ' ' + fw.state + ' hp ' + fw.player.hp);
  });
  test('bride: a long ride never leaves the road or goes through a vehicle, and the traffic stays busy', function () {
    var maxLat = 0, minTraffic = 1e9, r = drive({ s: 20, ticks: 3000, thr: 0.8, each: function (q) { maxLat = Math.max(maxLat, Math.abs(q.bike.lat)); if (q.tick > 300) minTraffic = Math.min(minTraffic, q.traffic.length); } });
    assert(maxLat <= COURSE.HALF + COURSE.PAVE, 'lat ' + maxLat); assert(minTraffic >= 12, 'the road emptied: ' + minTraffic);
  });
})();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
