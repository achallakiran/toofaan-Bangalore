/* view: the curved Bangalore road. A ribbon of tarmac along the loop (patched and cracked where it is broken, potholes as dark pools), roadside
   rows of shops and flats built in 40 m chunks near the bike and released behind it, poles with sagging wires, trees, the bike, the rider
   and the traffic. Reads the bride sim only. */
'use strict';

var R = require('../data/ride');
var C = require('../data/course');
var roadMod = require('../sim/road');
var boxmesh = require('./boxmesh');
var ridevox = require('./ridevox');
var bikevox = require('./bikevox');
var herorig = require('./herorig');
var posemath = require('./posemath');
var vg = require('./voxgrid');

var PAL = [], PIX = {};
function col(hex) { if (PIX[hex] === undefined) { PIX[hex] = PAL.length; PAL.push(hex); } return PIX[hex]; }
var WALLS = ['#2fa6a0', '#d8576b', '#e9a23b', '#7fb069', '#8e7cc3', '#e7d8b5', '#c97b5a', '#5fa8d3'].map(col);
var TRIMS = ['#f2efe6', '#ffe08a', '#2d3238', '#f2efe6', '#ff8a1f'].map(col);
var SHUTS = ['#e2552b', '#1b9aaa', '#2f9e44', '#f2b705', '#6b3fa0', '#d1397a'].map(col);
var WIN = col('#2b3f55'), DARK = col('#2d3238'), ROOF = col('#bdb3a2'), TANK = col('#1b1d21'), WALLG = col('#b9ad98'), CONC = col('#a79c8c');
var AWN = ['#d8452b', '#f4efe8', '#1b9aaa', '#f2b705'].map(col);
var CHUNK = 40, LOAD = 150, DROP = 200;

function h3(a, b, c) { return vg.h3(Math.round(a * 7), Math.round(b * 7), c | 0, 53); }

/* ---- one building in its own frame: +x away from the road, +z along it, ground at y = 0 ---- */
function building(rn, w, d, H, kind) {
  var B = [], wall = WALLS[Math.floor(rn() * WALLS.length)], trim = TRIMS[Math.floor(rn() * TRIMS.length)];
  function box(x0, y0, z0, x1, y1, z1, c) { B.push({ x0: x0, y0: y0, z0: z0, x1: x1, y1: y1, z1: z1, c: c }); }
  if (kind === 'wall') { box(0, 0, 0, 0.5, 2.4 + rn() * 1.2, w, WALLG); box(0, 2.4, 0, 0.6, 2.6, w, CONC); return B; }
  box(0, 0, 0, d, H, w, wall);
  box(0, H, 0, d, H + 0.25, w, trim);                                       /* parapet */
  /* shopfront: a dark opening with a coloured shutter and an awning */
  var gw = Math.min(w - 1, 3.2 + rn() * 2), z0 = (w - gw) / 2, sh = SHUTS[Math.floor(rn() * SHUTS.length)];
  box(-0.06, 0, z0, 0.04, 2.5, z0 + gw, DARK);
  box(-0.1, 0, z0, 0.02, 0.35 + rn() * 1.7, z0 + gw, sh);
  box(-0.9, 2.55, z0 - 0.3, 0, 2.8, z0 + gw + 0.3, AWN[Math.floor(rn() * AWN.length)]);
  box(-0.12, 3.0, 0.4, 0.0, 3.9, w - 0.4, trim);                            /* signboard band */
  box(-0.16, 3.2, 0.7, 0.0, 3.7, w - 0.7, SHUTS[Math.floor(rn() * SHUTS.length)]);
  /* upper floors: window bands */
  for (var y = 4.5; y + 1.6 < H; y += 3) {
    for (var z = 0.9; z + 1.3 < w; z += 2.2) box(-0.05, y, z, 0.05, y + 1.3, z + 1.3, WIN);
    box(-0.12, y - 0.15, 0.2, 0.05, y, w - 0.2, trim);
  }
  if (rn() < 0.6) box(d * 0.3, H + 0.25, w * 0.2, d * 0.3 + 1.4, H + 1.6, w * 0.2 + 1.4, TANK);
  return B;
}

function createBrideView(scene) {
  var root = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ vertexColors: true }), i;
  scene.add(root);
  var prevBg = scene.background, prevFog = { c: scene.fog.color.clone(), n: scene.fog.near, f: scene.fog.far };
  var skyC = document.createElement('canvas'); skyC.width = 2; skyC.height = 256;
  var sx = skyC.getContext('2d'), gr = sx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#4f9fb3'); gr.addColorStop(0.6, '#f0c697'); gr.addColorStop(1, '#f3b27a'); sx.fillStyle = gr; sx.fillRect(0, 0, 2, 256);
  var sky = new THREE.CanvasTexture(skyC); scene.background = sky; scene.fog.color.set('#f0c295'); scene.fog.near = 40; scene.fog.far = 130;
  var road = null, roadMesh = null, ground = null, wires = null, chunks = {}, holeMeshes = [], trees = [], treeGeos = [];
  var bike = bikevox.createBike(), rig = herorig.createHeroRig(), seat = bike.seat, ridePose = posemath.named('ride'), down = posemath.named('down');
  root.add(bike.root); bike.root.scale.setScalar(R.SCALE);
  var blobGeo = new THREE.CircleGeometry(0.5, 18); blobGeo.rotateX(-Math.PI / 2);
  var blobMat = new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.3, depthWrite: false });
  var bikeBlob = new THREE.Mesh(blobGeo, blobMat); bikeBlob.scale.set(0.9 * R.SCALE, 1, 2.1 * R.SCALE); bikeBlob.position.y = 0.05; root.add(bikeBlob);
  function seatRider() { bike.pitch.add(rig.root); rig.root.position.set(seat.x, seat.y + 0.08 - 0.85, seat.z); rig.root.rotation.set(0, 0, 0); rig.root.scale.setScalar(1); rig.applyPose(ridePose, { plant: false }); }
  seatRider();
  var traffic = ridevox.createRideTraffic(root), wheel = 0, runPhase = 0, layOn = 0;

  function geo(a) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(a.colors, 3)); g.setIndex(new THREE.BufferAttribute(a.indices, 1)); g.computeBoundingSphere(); return g;
  }

  /* ---- the tarmac: one ribbon for the whole loop ---- */
  function buildRoad() {
    var N = road.N, pos = [], nor = [], clr = [], idx = [], k, j, rgb = function (hex) { return boxmesh.hexToRgb(hex); };
    var cRoad = rgb('#3b4046'), cBroke = rgb('#4a4640'), cPave = rgb('#9c8f7d'), cKerb = rgb('#cfc6b4'), H = C.HALF, P = C.PAVE;
    /* flat-coloured strips from the far pavement across the tarmac to the near pavement (each strip has its own vertices so colours never blend) */
    var strips = [[-H - P, -H - 0.3, cPave, 0.12, 0], [-H - 0.3, -H, cKerb, 0.12, 0], [-H, 0, cRoad, 0.03, 1], [0, H, cRoad, 0.03, 1], [H, H + 0.3, cKerb, 0.12, 0], [H + 0.3, H + P, cPave, 0.12, 0]];
    strips.forEach(function (sp) {
      var base = pos.length / 3;
      for (k = 0; k <= N; k++) {
        var i0 = k % N, s = i0 * road.ds, rough = road.rough[i0], tone = sp[4] ? 1 + (h3(i0, sp[0], 5) - 0.5) * 0.4 * rough : 1;
        var c = sp[4] && rough > 0.3 ? cBroke : sp[2];
        for (j = 0; j < 2; j++) {
          var f = roadMod.frame(road, s, sp[j]); pos.push(f.x, sp[3], f.z); nor.push(0, 1, 0); clr.push(c[0] * tone, c[1] * tone, c[2] * tone);
        }
        if (k < N) { var a0 = base + k * 2; idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
      }
    });
    /* the strips run left to right along the heading; make every face point up */
    for (k = 0; k < idx.length; k += 3) {
      var ia = idx[k] * 3, ib = idx[k + 1] * 3, ic = idx[k + 2] * 3;
      var ux = pos[ib] - pos[ia], uz = pos[ib + 2] - pos[ia + 2], vx = pos[ic] - pos[ia], vz = pos[ic + 2] - pos[ia + 2];
      if (uz * vx - ux * vz < 0) { var t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
    /* the centre line: dashes every 6 m, solid on the fast roads' ends is not needed; white dashes between lanes */
    var dashC = rgb('#e8e4da'), base = pos.length / 3;
    for (var s2 = 0; s2 < road.length; s2 += 6) {
      var A = roadMod.frame(road, s2, 0), Bf = roadMod.frame(road, s2 + 2.6, 0), q = [[-0.1, A], [0.1, A], [0.1, Bf], [-0.1, Bf]], v0 = pos.length / 3;
      q.forEach(function (p) { var o = p[1]; pos.push(o.x + Math.cos(o.h) * p[0], 0.05, o.z - Math.sin(o.h) * p[0]); nor.push(0, 1, 0); clr.push(dashC[0], dashC[1], dashC[2]); });
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      var ia2 = v0 * 3, ib2 = (v0 + 1) * 3, ic2 = (v0 + 2) * 3;
      if ((pos[ib2 + 2] - pos[ia2 + 2]) * (pos[ic2] - pos[ia2]) - (pos[ib2] - pos[ia2]) * (pos[ic2 + 2] - pos[ia2 + 2]) < 0) { idx[idx.length - 5] = v0 + 2; idx[idx.length - 4] = v0 + 1; idx[idx.length - 2] = v0 + 3; idx[idx.length - 1] = v0 + 2; }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3)); g.setIndex(idx); g.computeBoundingSphere();
    roadMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); root.add(roadMesh);
    ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x7a6a58 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; root.add(ground);
    /* potholes: dark pools (bluish where there is water) */
    var hg = new THREE.CircleGeometry(1, 14); hg.rotateX(-Math.PI / 2);
    road.holes.forEach(function (h) {
      var f = roadMod.frame(road, h.s, h.l), m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: h.water ? 0x3d5568 : 0x15171a }));
      m.position.set(f.x, 0.06, f.z); m.scale.set(h.r, 1, h.r); root.add(m); holeMeshes.push(m);
    });
  }

  /* ---- roadside poles, wires and trees ---- */
  function buildProps() {
    var pts = [], lines = [], last = { '-1': null, '1': null };
    treeGeos = [0, 1, 2].map(function (sd) {
      var g = vg.createGrid(10, 12, 10), greens = [vg.hex('#3f8f4a'), vg.hex('#2f7a3d'), vg.hex('#58a85c')];
      vg.box(g, 5, 0, 5, 5, 5, 5, vg.hex('#6a4a30'));
      [[5, 7, 5, 3], [7, 5.5, 6, 2], [3, 6, 4, 2], [5.5, 9, 4.5, 2]].forEach(function (b, n) { vg.ellipsoid(g, b[0], b[1], b[2], b[3], b[3], b[3], greens[(n + sd) % 3]); });
      return geo(vg.meshGrid(g, { x: 5.5, y: 0, z: 5.5 }, 0.3, { jitter: 0.08, seed: sd + 3 }));
    });
    var poleB = [], pc = col('#5a4a3c');
    road.props.list.forEach(function (p) {
      if (p.kind === 'tree') { var t = new THREE.Mesh(treeGeos[p.v % 3], mat); t.position.set(p.x, 0.12, p.z); t.rotation.y = (p.x * 7 + p.z) % 6.28; root.add(t); trees.push(t); }
      else if (p.kind === 'pole') {
        poleB.push({ x0: p.x - 0.14, y0: 0, z0: p.z - 0.14, x1: p.x + 0.14, y1: 7.2, z1: p.z + 0.14, c: pc });
        poleB.push({ x0: p.x - 1.0, y0: 6.6, z0: p.z - 0.1, x1: p.x + 1.0, y1: 6.8, z1: p.z + 0.1, c: pc });
        var prev = last[p.sd]; if (prev && Math.hypot(prev.x - p.x, prev.z - p.z) < 30) for (var w = 0; w < 3; w++) {
          var off = (w - 1) * 0.8, ox = Math.cos(p.h) * off, oz = -Math.sin(p.h) * off;
          for (var q = 0; q < 6; q++) {
            var u0 = q / 6, u1 = (q + 1) / 6, sg0 = Math.sin(u0 * Math.PI) * 0.9, sg1 = Math.sin(u1 * Math.PI) * 0.9;
            lines.push(prev.x + ox + (p.x - prev.x) * u0, 6.7 - sg0, prev.z + oz + (p.z - prev.z) * u0, prev.x + ox + (p.x - prev.x) * u1, 6.7 - sg1, prev.z + oz + (p.z - prev.z) * u1);
          }
        }
        last[p.sd] = p;
      }
    });
    var pm = new THREE.Mesh(geo(boxmesh.boxesToArrays(poleB, PAL)), mat); root.add(pm); trees.push(pm);
    var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    wires = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x23272b })); root.add(wires);
  }

  /* ---- roadside buildings, a 40 m chunk at a time ---- */
  function buildChunk(k) {
    var s0 = k * CHUNK, boxesAll = [], side, sd;
    var P = [], Nn = [], Cc = [], Ix = [], vbase = 0;
    for (sd = 0; sd < 2; sd++) {
      side = sd ? 1 : -1;
      var s = s0, seed = k * 2 + sd, rr = 0;
      var rn = function () { rr++; return h3(seed, rr, 9); };
      while (s < s0 + CHUNK) {
        var i0 = Math.floor(((s % road.length) / road.ds)) % road.N, dens = road.dens[i0], open = road.type[i0] === 'fast' || road.cap[i0] >= 1;
        var w = 5 + rn() * 4, d = 6 + rn() * 3, H = 4.2 + Math.floor(rn() * 3) * 3, setback = C.HALF + C.PAVE + 0.8 + (open ? rn() * 3 : 0), kind = 'shop';
        if (open && rn() < 0.55) kind = 'wall';
        if (rn() < 0.06) { s += 6; continue; }                                    /* a gap: a side lane */
        var f = roadMod.frame(road, s + w / 2, side * setback), th = f.h + (side < 0 ? Math.PI : 0);
        /* local +x points away from the road: for the left side that is the heading's left, so rotate by h; for the right side by h + pi */
        var cs = Math.cos(th), sn = Math.sin(th), o = roadMod.frame(road, s, side * setback);
        var B = building(rn, w, d, H, kind), a = boxmesh.boxesToArrays(B, PAL), n = a.positions.length / 3, m;
        /* origin so that local z (along road) starts at s: for the right side z runs backwards, so start at s + w */
        var oo = side > 0 ? roadMod.frame(road, s, side * setback) : roadMod.frame(road, s, side * setback);
        var ox = oo.x, oz = oo.z;
        if (side > 0) { var fe = roadMod.frame(road, s + w, side * setback); ox = fe.x; oz = fe.z; }
        for (m = 0; m < n; m++) {
          var lx = a.positions[m * 3], ly = a.positions[m * 3 + 1], lz = a.positions[m * 3 + 2];
          P.push(ox + lx * cs + lz * sn, ly, oz - lx * sn + lz * cs);
          var nx = a.normals[m * 3], nz = a.normals[m * 3 + 2]; Nn.push(nx * cs + nz * sn, a.normals[m * 3 + 1], -nx * sn + nz * cs);
          Cc.push(a.colors[m * 3], a.colors[m * 3 + 1], a.colors[m * 3 + 2]);
        }
        for (m = 0; m < a.indices.length; m++) Ix.push(a.indices[m] + vbase);
        vbase += n; s += w + 0.4 + rn() * 1.2;
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setIndex(Ix); g.computeBoundingSphere();
    var mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); root.add(mesh); return mesh;
  }
  function streamChunks(sBike, max) {
    var nCh = Math.ceil(road.length / CHUNK), built = 0, k;
    for (k = 0; k < nCh; k++) {
      var mid = (k + 0.5) * CHUNK, d = Math.abs(roadMod.gap(road, sBike, mid % road.length)), e = chunks[k];
      if (d < LOAD && !e && built < max) { chunks[k] = buildChunk(k); built++; }
      else if (d > DROP && e) { root.remove(e); e.geometry.dispose(); e.material.dispose(); delete chunks[k]; }
    }
  }

  return {
    build: function (rd) { if (road) return; road = rd; buildRoad(); buildProps(); },
    prime: function (s) { streamChunks(s, 99); },
    bikeY: 0,
    sync: function (r, alpha, dt, t) {
      var b = r.bike, x = b.px + (b.x - b.px) * alpha, z = b.pz + (b.z - b.pz) * alpha, h = b.ph + Math.atan2(Math.sin(b.h - b.ph), Math.cos(b.h - b.ph)) * alpha;
      streamChunks(b.s, 1);
      ground.position.x = x; ground.position.z = z;
      var jy = (b.rough || 0) * 0.06 * Math.sin(t * 38) + (b.jolt || 0) * 0.05;
      bike.root.position.set(x, jy, z); bike.root.rotation.order = 'YXZ'; bike.root.rotation.y = h; bike.root.rotation.x = (b.jolt || 0) * 0.04 * Math.sin(t * 30);
      bikeBlob.position.set(x, 0.05, z); bikeBlob.rotation.y = h;
      var onBike = r.state === 'ride';
      layOn += ((onBike ? 0 : 1) - layOn) * (1 - Math.exp(-10 * dt));
      bike.lean.rotation.z = layOn * 1.35 + (onBike ? Math.max(-0.4, Math.min(0.4, b.turn * 14 * Math.min(1, Math.abs(b.speed) / 6))) : 0);
      wheel += (onBike ? b.speed : 0) * dt / (bike.wheelR * R.SCALE); bike.front.rotation.x = wheel; bike.rear.rotation.x = wheel;
      if (onBike) { if (rig.root.parent !== bike.pitch) seatRider(); rig.body.rotation.x = 0; rig.flutter(t, Math.min(1, Math.abs(b.speed) / 12)); }
      else {
        if (rig.root.parent !== root) { root.add(rig.root); rig.root.rotation.set(0, 0, 0); rig.root.scale.setScalar(R.SCALE); }
        var hx = r.hero.px + (r.hero.x - r.hero.px) * alpha, hz = r.hero.pz + (r.hero.z - r.hero.pz) * alpha;
        rig.root.position.set(hx, 0, hz); rig.root.rotation.y = r.hero.face;
        if (r.state === 'fly') { var u = Math.min(1, r.t / R.FLY_TICKS); rig.applyPose(down, { plant: true }); rig.root.position.y = Math.sin(Math.PI * Math.min(1, u * 2.2)) * 0.6 * (1 - u); }
        else { runPhase += dt * 9; rig.body.rotation.x = 0; rig.applyPose(posemath.walkPose(runPhase, 1.4), { plant: true }); }
        rig.flutter(t, 0.6);
      }
      var draw = [];
      for (i = 0; i < r.traffic.length; i++) {
        var v = r.traffic[i]; if (Math.abs(v.x - b.x) > R.VIEW_R || Math.abs(v.z - b.z) > R.VIEW_R) continue;
        var K = R.KINDS[v.kind];
        draw.push({ id: v.id, kind: v.kind, look: v.look, x: v.px + (v.x - v.px) * alpha, z: v.pz + (v.z - v.pz) * alpha, h: v.h, len: K.len, r: K.r });
      }
      traffic.draw(draw, b.x, b.z);
    },
    dispose: function () {
      scene.remove(root); scene.background = prevBg; scene.fog.color.copy(prevFog.c); scene.fog.near = prevFog.n; scene.fog.far = prevFog.f;
      Object.keys(chunks).forEach(function (k) { chunks[k].geometry.dispose(); chunks[k].material.dispose(); }); chunks = {};
      if (roadMesh) { roadMesh.geometry.dispose(); roadMesh.material.dispose(); }
      if (ground) { ground.geometry.dispose(); ground.material.dispose(); }
      if (wires) { wires.geometry.dispose(); wires.material.dispose(); }
      treeGeos.forEach(function (g) { g.dispose(); }); holeMeshes.forEach(function (m) { m.material.dispose(); });
      sky.dispose(); blobGeo.dispose(); blobMat.dispose(); traffic.dispose();
    }
  };
}

module.exports = { createBrideView: createBrideView };
