/* view: a street brawl drawn in place on the road. Toofan's own fight presentation (the move clips and combo, block and counter, the finisher
   whirl, knockdowns, the rock stand, hit-stop, comic words, sparks, sweat and blood, the fight HUD), lifted from the fight mode so the same
   fight can play anywhere. It works in the brawler's own units inside a group scaled up to ride size and placed at the fight's anchor, so
   nothing about the fight changes but where it stands. Reads the fight world (sim/brawl) only. */
'use strict';

var moveData = require('../data/moves');
var herorig = require('./herorig');
var posemath = require('./posemath');
var moveplayer = require('./moveplayer');
var fxmod = require('./fx');
var cinecam = require('./cinecam');
var enemyview = require('./enemyview');
var fightui = require('./fightui');
var lettering = require('./lettering');
var rockstand = require('./rockstand');
var combatMod = require('../sim/combat');

function groupCentre(fw, hx, hz) {
  var sx = 0, sz = 0, n = 0, list = fw.combat.enemies;
  for (var i = 0; i < list.length; i++) { var e = list[i]; if (e.dead || e.st === 'dead') continue; if (Math.hypot(e.x - hx, e.z - hz) < 7) { sx += e.x; sz += e.z; n++; } }
  return n ? { x: sx / n, z: sz / n } : null;
}

/* opts: fw (the fight world), anchor {x,z}, k (scale), sfx */
function createBrawlView(ctx, opts) {
  var fw = opts.fw, k = opts.k, A = opts.anchor, sfx = opts.sfx, scene = ctx.view.scene, camera = ctx.view.camera, S = {}, subs = [];
  var group = new THREE.Group(); group.scale.setScalar(k); group.position.set(A.x, 0, A.z); scene.add(group);
  function W(p) { return { x: A.x + p.x * k, y: p.y * k, z: A.z + p.z * k }; }                      /* fight units -> world */
  var rig = herorig.createHeroRig(); group.add(rig.root);
  var blobG = new THREE.CircleGeometry(0.5, 16); blobG.rotateX(-Math.PI / 2); var blobM = new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.3, depthWrite: false });
  var blob = new THREE.Mesh(blobG, blobM); blob.scale.set(1, 1, 1); blob.position.y = 0.06; group.add(blob);
  var mp = moveplayer.createMovePlayer(), fx = fxmod.createFx(group), txt = lettering.createLettering(), cine = cinecam.createDirector(), ev = enemyview.createEnemyView(group), ui = fightui.createFightUi();
  var cur = posemath.named('stand'), phase = 0, t = 0, face = fw.player.face, blockW = 0, hurtW = 0, downW = 0, counterIdx = 0, freeze = 0, slow = 0, focusPt = null, focusT = 0, rise = false, riseYaw = 0, lastMv = null, whirlT = -9;
  function on(name, fn) { subs.push(ctx.bus.on(name, fn)); }
  function say(word, at, hot) { txt.say(word, W(at), camera, hot); }
  function heroPoint(y) { var p = fw.player; return { x: p.x + Math.sin(face) * 0.8, y: y, z: p.z + Math.cos(face) * 0.8 }; }

  mp.onFx(function (kind) {
    var rp = rig.root.position, pt = kind === 'boom' ? rig.guitarPoint(30, 0, 0) : rp;
    if (kind === 'boom') pt = { x: pt.x, y: pt.y, z: pt.z };
    fx.spawn(kind, pt, rig.root.rotation.y);
    var hp0 = { x: rp.x, y: 2.0, z: rp.z };
    if (kind === 'boom') { say('boom', hp0, true); sfx.boom(); }
    else if (kind === 'slam') { say('smash', hp0, true); sfx.smash(); }
    else if (kind === 'whirl' && t - whirlT > 1.2) { whirlT = t; say('whirl', hp0, false); sfx.swirl(); }
    if (kind === 'slam') cine.shake(0.28, 0.7); else if (kind === 'boom') cine.shake(0.2, 0.7);
  });
  mp.onHit(function (move, idx, last) { fw.pendingStrikes.push({ move: move, last: last }); });
  on('hit', function (e) {
    var p = fw.player, dx = e.x - p.x, dz = e.z - p.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl, hy = e.high ? 1.6 : 1.2;
    fx.spawn('spark', { x: e.x - ux * 0.25, y: hy, z: e.z - uz * 0.25 }, 0); cine.shake(0.05 + e.power * 0.12, 0.2); freeze = 0.04 + e.power * 0.05; ev.shove(e.id, ux, uz, 0.12 + e.power * 0.22 + (e.down ? 0.1 : 0));
    fx.droplets('sweat', { x: e.x, y: 1.65, z: e.z }, ux, uz, 5 + Math.round(e.power * 5), e.power);
    fx.droplets('blood', { x: e.x - ux * 0.2, y: hy, z: e.z - uz * 0.2 }, ux, uz, (e.killed || e.down ? 12 : 4) + Math.round(e.power * 4), e.power);
    var wk = e.move === 'counter' ? null : e.move, lastBlow = e.down && wk;
    if (wk) say(lastBlow && !e.killed ? 'fall' : wk, { x: e.x, y: hy + 0.25, z: e.z }, e.power > 0.55 || !!lastBlow);
    sfx.hit(e.move === 'counter' ? 'cross' : e.move, e.power); if (e.down) sfx.fall();
    var fpt = e.high ? ev.facePoint(e.id) : null;
    if (fpt) {
      var sgn = e.move === 'hook' ? 1 : (e.move === 'hookB' ? -1 : 0), up = e.move === 'uppercut' ? 3.2 : 0.4, ddx = ux * (sgn ? 0.35 : 1) + uz * sgn * 1.1, ddz = uz * (sgn ? 0.35 : 1) - ux * sgn * 1.1, mo = { x: fpt.mx, y: fpt.my, z: fpt.mz };
      fx.droplets('spit', mo, ddx, ddz, 4 + Math.round(e.power * 4), 0.4 + e.power * 0.5, up);
      fx.droplets('blood', mo, ddx, ddz, 3 + Math.round(e.power * 3) + (e.down ? 4 : 0), 0.5 + e.power * 0.5, up);
    }
  });
  on('enemyBlock', function (e) {
    say(e.broke ? 'guardbreak' : 'block', { x: e.x, y: 1.5, z: e.z }, !!e.broke); sfx.block(!!e.broke);
    fx.spawn('blockspark', { x: e.x, y: 1.4, z: e.z }, e.broke ? 1.6 : 0.2); cine.shake(e.broke ? 0.1 : 0.04, 0.16); freeze = e.broke ? 0.12 : 0.05;
  });
  on('block', function (e) { say('thud', heroPoint(1.7), false); sfx.block(false); fx.spawn('blockspark', heroPoint(1.3), e.timed ? 1.5 : 0); cine.shake(e.timed ? 0.06 : 0.03, 0.15); if (e.timed) freeze = 0.07; });
  on('counter', function (e) { mp.play(e.kind === 'double' ? 'counterWhirl' : (e.kind === 'special' ? ['counterBoom', 'counterSmash'][counterIdx++ % 2] : 'counterCross')); });
  on('lastKo', function (e) {
    slow = 1.1; focusPt = { x: e.x, z: e.z }; focusT = 1.7;
    cine.playShot([{ t: 0, dist: 5.2, h: 2.2, look: 1.3, fov: 42, rel: 2.3 }, { t: 0.7, dist: 3.9, h: 1.4, look: 1.3, fov: 34, rel: 3.5 }, { t: 1.7, dist: 5.6, h: 2.6, look: 1.2, fov: 44, rel: 4.5 }], 1.7);
  });
  on('heroFloored', function () { cine.shake(0.16, 0.45); freeze = 0.12; say('fall', heroPoint(0.6), true); sfx.fall && sfx.fall(); });
  on('heroUp', function () { sfx.whoosh && sfx.whoosh(0.5); });
  on('playerHurt', function () {
    mp.cancel(); hurtW = 1; cine.shake(0.1, 0.25); freeze = 0.1; say('hurt', heroPoint(1.8), true); sfx.hit('cross', 0.8); fx.spawn('spark', heroPoint(1.4), 0.6);
    var pl = fw.player; fx.droplets('sweat', { x: pl.x, y: 1.7, z: pl.z }, -Math.sin(face), -Math.cos(face), 7, 0.6); fx.droplets('blood', { x: pl.x, y: 1.5, z: pl.z }, -Math.sin(face), -Math.cos(face), 3, 0.4);
  });
  on('guardbreak', function () { mp.cancel(); hurtW = 1; cine.shake(0.12, 0.3); fx.spawn('spark', heroPoint(1.3), 1); });
  on('action', function (e) {
    if (e.type === 'attack' && !ctx.input.state.held.block && fw.player.stun <= 0 && !fw.player.down) mp.press();
    if (e.type === 'finisher') { mp.play(moveData.FINISHER); say('finisher', { x: fw.player.x, y: 2.3, z: fw.player.z }, true); sfx.mega(); }
  });
  on('fight:rise', function () { rise = true; riseYaw = face; downW = 0; hurtW = 0; sfx.whoosh(0.8); });
  on('fight:resume', function () { rise = false; cur = posemath.named('guard') || posemath.named('stand'); });
  on('fight:thappad', function () { mp.cancel(); ui.show(false); });

  return {
    fw: fw, group: group, mp: mp, ev: ev,
    /* before each sim tick: the same two lines the fight mode sets */
    pre: function () {
      var cm0 = mp.current(), mv0 = cm0 && moveData.MOVES[cm0];
      fw.attackLock = mp.active();
      fw.invuln = !!(mv0 && mv0.counter) || cm0 === 'counterCross';
    },
    /* every frame: poses, effects and HUD; returns the camera shot in world units */
    update: function (real, alpha) {
      var dt = real;
      if (freeze > 0) { freeze -= real; dt *= 0.05; } else if (slow > 0) { slow -= real; dt *= 0.3; } if (focusT > 0) focusT -= real; t += dt;
      var p = fw.player, x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha, speed = Math.hypot(p.x - p.px, p.z - p.pz) * 60, target;
      if (p.moving) { phase += speed * dt / 1.9; target = posemath.walkPose(phase, 1 + Math.min(0.2, speed / 20)); } else target = posemath.idlePose(t);
      posemath.approach(cur, target, 16, dt);
      var pose = cur, mo = mp.update(dt);
      var hurtT = p.stun > 0 ? 1 : 0; hurtW += (hurtT - hurtW) * (1 - Math.exp(-(hurtT ? 24 : 8) * dt));
      downW += ((p.down ? 1 : 0) - downW) * (1 - Math.exp(-6 * dt));
      if (mo) pose = posemath.layer(pose, mo.pose, mo.wLower, mo.wUpper, mo.wArmA, mo.wArmB);
      var bt = (p.guard && !mp.active() && !mo) ? 1 : 0; blockW += (bt - blockW) * (1 - Math.exp(-(bt ? 7 : 5) * dt));
      if (blockW > 0.01) { var bw = posemath.smooth(blockW); pose = posemath.layer(pose, posemath.named('block'), bw * 0.85, bw); }
      if (hurtW > 0.02) { var hw = posemath.smooth(hurtW); pose = posemath.layer(pose, posemath.named('hurt'), hw, hw, hw, hw); }
      if (downW > 0.02) { var dw = posemath.smooth(downW); pose = posemath.layer(pose, posemath.named('down'), dw, dw, dw, dw); }
      var riseLift = 0;
      if (p.kd > 0 && !p.down) {
        var ke = (combatMod.KD - p.kd + alpha) / 60, kdn = combatMod.KD_DOWN / 60;
        if (ke < kdn) pose = posemath.blend(cur, posemath.named('down'), posemath.smooth(ke / 0.22));
        else { var ks = rockstand.at(ke - kdn, 1.75, 0.45); pose = ks.pose; riseLift = ks.lift; }
        cur = posemath.copy(pose); mp.cancel();
      }
      if (rise && fw.state === 'rise') { var rs = rockstand.at(fw.riseT / 60); pose = rs.pose; riseLift = rs.lift; cur = posemath.copy(pose); }
      ev.sync(fw.combat.enemies, alpha, dt, fw.combat.target, fw.combat.seqId); ui.update(p, fw.combat); ui.show(fw.state === 'fight' || fw.state === 'cleared' || fw.state === 'police');
      fx.update(dt);
      var dyaw = Math.atan2(Math.sin(p.face - face), Math.cos(p.face - face)); face += dyaw * (1 - Math.exp(-14 * dt));
      rig.root.position.set(x, riseLift, z); rig.root.rotation.y = face; blob.position.x = x; blob.position.z = z; blob.scale.set(0.9, 1, 0.9);
      rig.applyPose(pose, { plant: true }); rig.flutter(t, p.moving ? 0.5 : 0.12);
      var cmw = mp.current(); if (cmw !== lastMv) { lastMv = cmw; if (cmw && !moveData.MOVES[cmw].counter) sfx.whoosh(0.5); }
      var cm = mp.current(), cl = cm ? moveData.MOVES[cm].len : 0, ct = mp.time();
      cine.update(dt, cm, ct, cm ? Math.min(ct / 0.55, (cl - ct) / 0.7, 1) : 0);
      var focus = focusT > 0 ? focusPt : groupCentre(fw, x, z), shot = cine.weight > 0.001 || cine.shakeT > 0 ? cine.resolve(x, z, face, focus) : null;
      if (rise && fw.state === 'rise') {
        var RZ = 300, ra = riseYaw + Math.PI * 2 * posemath.smooth(fw.riseT / RZ), rr = 4.6 - 0.8 * Math.sin(Math.PI * fw.riseT / RZ);
        shot = { x: x + Math.sin(ra) * rr, y: 1.6 + 0.8 * Math.sin(Math.PI * fw.riseT / RZ), z: z + Math.cos(ra) * rr, lx: x, ly: 1.25, lz: z, fov: 50 };
      }
      if (!shot) {                                                                       /* the brawl's own raised view, a little wider when several men are in */
        var men = fw.combat.enemies.filter(function (e) { return !e.dead && e.st !== 'dead'; }).length, up = 1 + Math.min(0.5, (men - 1) * 0.12);
        shot = { x: x, y: 6.4 * up, z: z + 6.6 * up, lx: x, ly: 1.0, lz: z - 2.2, fov: 46 };
      }
      var wl = W({ x: shot.x, y: shot.y, z: shot.z }), wk = W({ x: shot.lx, y: shot.ly, z: shot.lz });
      return { x: wl.x, y: wl.y, z: wl.z, lx: wk.x, ly: wk.y, lz: wk.z, fov: shot.fov };
    },
    dispose: function () {
      subs.forEach(function (u) { if (typeof u === 'function') u(); });
      scene.remove(group); ev.dispose(); fx.dispose(); txt.dispose(); ui.dispose(); blobG.dispose(); blobM.dispose();
    }
  };
}

module.exports = { createBrawlView: createBrawlView };
