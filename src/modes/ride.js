/* modes: Ride, free riding on the curved Bangalore road. Toofan on Bijli, one thumb to steer, honking drivers who watch him and swerve,
   fast, jammed and broken stretches. No goal, no timer. Touching a vehicle costs speed and health and the driver shouts. */
'use strict';

var rideSim = require('../sim/bride');
var R = require('../data/ride');
var C = require('../data/course');
var brideview = require('../view/brideview');
var sfxmod = require('../view/sfx');
var musicMod = require('../view/music');
var speechMod = require('../view/speech');
var SH = require('../data/shouts');

var VIEWS = ['OVERHEAD', 'CHASE', 'CLOSE', 'RIDER'];

function createRide() {
  var S = {};
  function say(text, secs) { S.ui.msg.textContent = text; S.ui.msg.style.opacity = 1; S.msgT = secs || 1.4; }
  function word(text) { S.ui.word.textContent = text; S.ui.word.style.opacity = 1; S.ui.word.style.transform = 'translate(-50%,-50%) rotate(-8deg) scale(1.15)'; S.wordT = 0.7; }
  function vehicle(id) { var T = S.r.traffic; for (var i = 0; i < T.length; i++) if (T[i].id === id) return T[i]; return null; }
  function shout(id, list, secs) {
    if (!S.speech || S.t - (S.shoutT[id] || -9) < 2.5) return; S.shoutT[id] = S.t;
    var v = vehicle(id), text = list[(S.nShout++ + (S.r.seed % list.length)) % list.length];
    S.speech.say(text, function () { var q = vehicle(id) || v; return { x: q.x, y: 3.1, z: q.z }; }, secs || 2);
  }
  return {
    name: 'ride',
    enter: function (ctx, scope) {
      var view = ctx.view;
      view.setSky('#a9c7da', false);
      ctx.hudRoot.hidden = false; ctx.touchRoot.hidden = false; ctx.touch.setMode('ride'); ctx.touch.setFinisherVisible(true); scope.add(function () { ctx.touch.setMode('fight'); ctx.touch.setFinisherVisible(false); });
      if (!ctx.ride) ctx.ride = rideSim.createRide(ctx.world.seed, ctx.bus, { free: true });
      S.r = ctx.ride; S.t = 0; S.cam = null; S.msgT = 0; S.wordT = 0; S.last = 0; S.shake = 0; S.flashT = 0; S.view = 0; S.shoutT = {}; S.nShout = 0; S.honkQ = false; S.honkT = 0; S.pot = 0;
      S.v = brideview.createBrideView(view.scene); S.v.build(S.r.road); S.v.prime(S.r.bike.s);
      scope.add(function () { S.v.dispose(); });
      S.sfx = sfxmod.createSfx(); S.sfx.engineOff(); S.sfx.start(); scope.add(function () { S.sfx.engineOff(); });
      S.speech = speechMod.createSpeech(); scope.add(function () { S.speech.dispose(); });
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:6;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000';
      el.innerHTML =
        '<div id="rStretch" style="position:absolute;left:50%;top:max(54px,env(safe-area-inset-top));transform:translateX(-50%);text-align:center;font:800 13px system-ui,sans-serif;letter-spacing:.08em;white-space:nowrap"></div>' +
        '<div id="rBar" style="position:absolute;left:16px;top:max(86px,calc(env(safe-area-inset-top) + 32px));width:110px"><div style="font:700 10px system-ui;letter-spacing:.1em">BIJLI</div>' +
        '<div style="height:9px;border:1px solid #fff;border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden"><div id="rHp" style="height:100%;width:100%;background:#4ade80"></div></div></div>' +
        '<button id="rView" data-ok="1" style="position:absolute;left:16px;top:max(126px,calc(env(safe-area-inset-top) + 72px));padding:6px 10px;pointer-events:auto;cursor:pointer;border-radius:6px;border:1px solid #fff;background:rgba(10,14,18,.55);color:#fff;font:800 11px system-ui;letter-spacing:.08em"></button>' +
        '<div id="rMsg" style="position:absolute;left:50%;top:26%;transform:translateX(-50%);font:900 26px system-ui,sans-serif;letter-spacing:.06em;color:#ffc21a;opacity:0;transition:opacity .25s;white-space:nowrap"></div>' +
        '<div id="rWord" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) rotate(-8deg) scale(0);font:900 clamp(40px,8vw,84px) \'Arial Black\',Impact,sans-serif;color:#ffd21f;-webkit-text-stroke:3px #1b1b1b;opacity:0;transition:transform .12s"></div>' +
        '<div id="rSpeed" style="position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);font:900 24px system-ui,sans-serif"></div>';
      document.body.appendChild(el); scope.add(function () { el.remove(); });
      var red = document.createElement('div'); red.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 40%,rgba(255,0,0,.5));opacity:0;transition:opacity .15s';
      document.body.appendChild(red); scope.add(function () { red.remove(); });
      S.ui = { stretch: el.querySelector('#rStretch'), hp: el.querySelector('#rHp'), view: el.querySelector('#rView'), msg: el.querySelector('#rMsg'), word: el.querySelector('#rWord'), speed: el.querySelector('#rSpeed'), red: red };
      function cycle() { S.view = (S.view + 1) % VIEWS.length; S.ui.view.textContent = 'VIEW: ' + VIEWS[S.view]; S.cam = null; }
      S.ui.view.textContent = 'VIEW: ' + VIEWS[0]; S.ui.view.addEventListener('click', function (e) { e.stopPropagation(); cycle(); });
      var key = function (e) { if (e.code === 'KeyV' && !e.repeat) cycle(); }; window.addEventListener('keydown', key); scope.add(function () { window.removeEventListener('keydown', key); });
      ctx.debug.cycleView = cycle; ctx.debug.teleport = function (sv) { rideSim.teleport(S.r, sv); S.cam = null; S.v.prime(sv); }; ctx.debug.rideMode = S;
      scope.add(ctx.bus.on('ride:honk', function (e) { if (e.dist < 24 && S.honkT <= 0) { S.sfx.honk(); S.honkT = 0.5; } if (e.dist < 7 && e.why === 'bike') shout(e.id, SH.NEAR, 1.4); }));
      scope.add(ctx.bus.on('ride:hit', function (e) {
        if (e.sev >= 1) { S.sfx.crash(e.sev > 1); S.shake = e.sev > 1 ? 0.45 : 0.25; S.flashT = 0.3; word(e.sev > 1 ? 'DHADAAM!' : 'THOK!'); } else S.sfx.hit('jab', 0.4);
        shout(e.id, e.sev > 1 ? SH.HARD : SH.HIT, 2.4);
      }));
      scope.add(ctx.bus.on('ride:crash', function () { say('BIKE SE GIRA!', 1.6); }));
      scope.add(ctx.bus.on('ride:getup', function () { say('Back to Bijli!', 1.4); }));
      scope.add(ctx.bus.on('ride:remount', function () { S.sfx.start(); }));
      scope.add(ctx.bus.on('ride:wall', function () { S.sfx.land(4); }));
      scope.add(ctx.bus.on('ride:pothole', function (e) {
        S.sfx.land(e.deep ? 6 : 3); S.shake = e.deep ? 0.35 : 0.18; S.flashT = e.deep ? 0.2 : 0;
        if (S.t - S.pot > 3 && S.speech) { S.pot = S.t; var L = SH.HOLE; S.speech.say(L[S.nShout++ % L.length], function () { var B = S.r.bike; return { x: B.x, y: 2.9, z: B.z }; }, 1.6); }
      }));
      scope.add(ctx.bus.on('ride:wrecked', function () { say('BIKE HALAAT KHARAB! GARAGE JAO', 2.6); }));
      S.stretchName = '';
    },
    step: function (ctx, tick) {
      ctx.input.tick(tick);
      if (ctx.debug.freeze) return;
      if (ctx.input.state.pressed.finisher && S.r.state === 'ride') S.honkQ = true;
      rideSim.step(S.r, ctx.input);
    },
    render: function (ctx, alpha) {
      var now = ctx.now(), dt = S.last ? Math.min(0.05, (now - S.last) / 1000) : 1 / 60; S.last = now; S.t += dt;
      var r = S.r, b = r.bike, x = b.px + (b.x - b.px) * alpha, z = b.pz + (b.z - b.pz) * alpha;
      S.v.sync(r, alpha, dt, S.t); S.speech.update(ctx.view.camera, dt);
      var near = (ctx.view.canvas.clientHeight || 700) < 520 ? 0.82 : 1;
      var cx = x, cz = z, yaw = b.h, sp = Math.max(0, b.speed);
      if (r.state === 'fly' || r.state === 'run') { cx = r.hero.x; cz = r.hero.z; }
      var c = S.cam || (S.cam = { x: cx, z: cz, yaw: yaw }), k = 1 - Math.exp(-5 * dt), ky = 1 - Math.exp(-(S.view === 3 ? 6 : 2.2) * dt);
      c.x += (cx - c.x) * k; c.z += (cz - c.z) * k;
      if (r.state === 'ride') c.yaw += Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * ky;
      var sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), shot, CAM = R.CAM;
      if (S.view === 0) shot = { x: c.x - sy * (CAM.back + sp * 0.12) * near, y: (CAM.height + sp * 0.1) * near, z: c.z - cy * (CAM.back + sp * 0.12) * near, lx: c.x + sy * (CAM.ahead + sp * 0.2), ly: 0.6, lz: c.z + cy * (CAM.ahead + sp * 0.2), fov: CAM.fov };
      else if (S.view === 1) shot = { x: c.x - sy * 6.5, y: 4.6, z: c.z - cy * 6.5, lx: c.x + sy * 6, ly: 1.2, lz: c.z + cy * 6, fov: 56 };
      else if (S.view === 2) shot = { x: c.x - sy * 3.6, y: 2.5, z: c.z - cy * 3.6, lx: c.x + sy * 5, ly: 1.3, lz: c.z + cy * 5, fov: 62 };
      else shot = { x: c.x + sy * 0.2, y: 2.45, z: c.z + cy * 0.2, lx: c.x + sy * 14, ly: 1.7, lz: c.z + cy * 14, fov: 74 };
      if (S.shake > 0) { var sh = S.shake * 0.25; shot.x += (Math.random() - 0.5) * sh; shot.y += (Math.random() - 0.5) * sh; S.shake = Math.max(0, S.shake - dt * 1.5); }
      if (b.rough > 0.2 && r.state === 'ride') { shot.y += Math.sin(S.t * 41) * 0.05 * b.rough; shot.x += Math.cos(S.t * 37) * 0.04 * b.rough; }
      ctx.view.followCamera(0, 0, shot);
      ctx.view.render();
      if (r.state === 'ride') S.sfx.engine(dt, { rpm: 0.2 + 0.8 * Math.abs(b.speed) / R.TOP, thr: Math.max(0.15, ctx.input.state.my), speed: b.speed, drifting: false, braking: ctx.input.state.held.block, air: false });
      if (S.honkQ) { S.honkQ = false; S.sfx.honk(); }
      S.honkT -= dt;
      if (S.msgT > 0) { S.msgT -= dt; if (S.msgT <= 0) S.ui.msg.style.opacity = 0; }
      if (S.wordT > 0) { S.wordT -= dt; if (S.wordT < 0.45) S.ui.word.style.transform = 'translate(-50%,-50%) rotate(-8deg) scale(1)'; if (S.wordT <= 0) S.ui.word.style.opacity = 0; }
      S.ui.red.style.opacity = S.flashT > 0 ? 1 : 0; S.flashT -= dt;
      var st = r.stretch;
      var nm = st ? st.name : ''; if (nm !== S.stretchName) { S.stretchName = nm; if (nm) say(nm.toUpperCase(), 1.8); }
      S.ui.stretch.textContent = nm ? nm.toUpperCase() + '  ·  ' + (st.type === 'fast' ? 'FAST' : st.type === 'jam' ? 'JAM' : st.type === 'broken' ? 'BROKEN' : 'JAM + BROKEN') : '';
      S.ui.hp.style.width = Math.max(0, b.hp) + '%'; S.ui.hp.style.background = b.hp > 60 ? '#4ade80' : b.hp > 30 ? '#facc15' : '#f87171';
      S.ui.speed.textContent = r.state === 'ride' ? Math.round(Math.abs(b.speed) * 3.6) + ' km/h' : '';
      S.hudT = (S.hudT || 0) - dt;
      if (S.hudT <= 0) { S.hudT = 0.25; var vs = ctx.view.stats(); ctx.hud.update({ mode: 'ride', tick: r.tick, chunks: 0, maxChunks: 0, triangles: vs.triangles, calls: vs.calls, bytes: vs.bytes, loads: r.crashes, unloads: r.hits, saveOk: ctx.save.persistent(), rage: 0, ms: vs.ms, tier: vs.tier }); }
    },
    exit: function () {}
  };
}

module.exports = { createRide: createRide };
