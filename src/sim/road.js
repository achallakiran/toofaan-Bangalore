/* sim: the road. A closed curved road from control points: smoothed, then sampled evenly along its length.
   Everything about where things are on the road goes through here: a place along it (s) and a sideways offset (lat, positive to the
   driver's left going the way s grows) turn into a point and a heading, and the other way round. Stretches say how each part rides
   (bike speed cap, traffic speed and density, roughness) and where the potholes are. Plain data from a seed: no graphics, no DOM. */
'use strict';

var C = require('../data/course');
var rngMod = require('../core/rng');

function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function wrapIdx(i, n) { i %= n; return i < 0 ? i + n : i; }

/* centripetal Catmull-Rom through the closed list of points, then resampled every STEP metres */
function curve(pts) {
  var n = pts.length, fine = [], i, k, a, b, c, d;
  function tj(t, p, q) { return t + Math.pow(Math.hypot(q[0] - p[0], q[1] - p[1]), 0.5); }
  for (i = 0; i < n; i++) {
    a = pts[wrapIdx(i - 1, n)]; b = pts[i]; c = pts[wrapIdx(i + 1, n)]; d = pts[wrapIdx(i + 2, n)];
    var t0 = 0, t1 = tj(t0, a, b), t2 = tj(t1, b, c), t3 = tj(t2, c, d);
    for (k = 0; k < 60; k++) {
      var t = t1 + (t2 - t1) * k / 60;
      function mix(p, q, ta, tb) { var w = tb === ta ? 0 : (t - ta) / (tb - ta); return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w]; }
      var A1 = mix(a, b, t0, t1), A2 = mix(b, c, t1, t2), A3 = mix(c, d, t2, t3);
      var B1 = [A1[0] + (A2[0] - A1[0]) * (t - t0) / (t2 - t0), A1[1] + (A2[1] - A1[1]) * (t - t0) / (t2 - t0)];
      var B2 = [A2[0] + (A3[0] - A2[0]) * (t - t1) / (t3 - t1), A2[1] + (A3[1] - A2[1]) * (t - t1) / (t3 - t1)];
      fine.push([B1[0] + (B2[0] - B1[0]) * (t - t1) / (t2 - t1), B1[1] + (B2[1] - B1[1]) * (t - t1) / (t2 - t1)]);
    }
  }
  var acc = [0], len = 0, m = fine.length;
  for (i = 0; i < m; i++) { var p = fine[i], q = fine[(i + 1) % m]; len += Math.hypot(q[0] - p[0], q[1] - p[1]); acc.push(len); }
  var N = Math.max(8, Math.round(len / C.STEP)), ds = len / N, xs = [], zs = [], j = 0;
  for (i = 0; i < N; i++) {
    var want = i * ds; while (j < m - 1 && acc[j + 1] < want) j++;
    var u = (want - acc[j]) / ((acc[j + 1] - acc[j]) || 1), P = fine[j], Q = fine[(j + 1) % m];
    xs.push(P[0] + (Q[0] - P[0]) * u); zs.push(P[1] + (Q[1] - P[1]) * u);
  }
  return { xs: xs, zs: zs, N: N, ds: ds, length: len };
}

function build(seed) {
  var cv = curve(C.POINTS), N = cv.N, i, hs = [], k;
  for (i = 0; i < N; i++) { var a = (i + N - 1) % N, b = (i + 1) % N; hs.push(Math.atan2(cv.xs[b] - cv.xs[a], cv.zs[b] - cv.zs[a])); }
  var road = { seed: seed, N: N, ds: cv.ds, length: cv.length, xs: cv.xs, zs: cv.zs, hs: hs, HALF: C.HALF, PAVE: C.PAVE, LANES: C.LANES };

  /* stretches: which part of the loop rides how. The numbers are smoothed over about 24 m so a stretch changes gradually. */
  var type = [], cap = [], tv = [], dens = [], rough = [], pot = [], name = [];
  for (i = 0; i < N; i++) {
    var f = i / N, S = C.STRETCHES[C.STRETCHES.length - 1];
    for (k = 0; k < C.STRETCHES.length; k++) if (f >= C.STRETCHES[k].f0 && f < C.STRETCHES[k].f1) { S = C.STRETCHES[k]; break; }
    type.push(S.type); name.push(S.name);
  }
  function blur(key) {
    var raw = type.map(function (t) { return C.TYPES[t][key]; }), out = [], W = 12, j, acc;
    for (i = 0; i < N; i++) { acc = 0; for (j = -W; j <= W; j++) acc += raw[wrapIdx(i + j, N)]; out.push(acc / (2 * W + 1)); }
    return out;
  }
  cap = blur('cap'); tv = blur('tv'); dens = blur('dens'); rough = blur('rough'); pot = blur('pot');
  road.type = type; road.name = name; road.cap = cap; road.tv = tv; road.dens = dens; road.rough = rough; road.pot = pot;

  /* potholes: scattered where the road is broken, bigger and deeper in the worst parts. Bucketed by 8 m of road for quick lookups. */
  var rng = rngMod.createRng((seed >>> 0) ^ 0xd17c4), holes = [], s;
  for (s = 0; s < road.length; s += 5) {
    var ix = wrapIdx(Math.round(s / road.ds), N), p = pot[ix];
    if (p < 0.2 || rng.next() > 0.55 * p) continue;
    var big = rng.next() < 0.22 * p, r = big ? 1.2 + rng.next() * 0.7 : 0.45 + rng.next() * 0.55;
    holes.push({ id: holes.length, s: s + rng.next() * 4, l: (rng.next() * 2 - 1) * (C.HALF - r - 0.3), r: r, deep: big, water: rng.next() < 0.35 });
  }
  road.holes = holes; road.holeGrid = {};
  holes.forEach(function (h) { var key = Math.floor(h.s / 8); (road.holeGrid[key] || (road.holeGrid[key] = [])).push(h); });

  /* poles and trees along both pavements: solid for the bike. Bucketed on an 8 m grid. */
  var props = [], prng = rngMod.createRng((seed >>> 0) ^ 0x9e3);
  for (s = 6; s < road.length - 4; s += 16) for (var sd = -1; sd <= 1; sd += 2) {
    var A = frame(road, s, sd * (C.HALF + 0.45)); props.push({ kind: 'pole', x: A.x, z: A.z, r: 0.2, sd: sd, h: A.h, s: s });
    if (prng.next() < 0.45) { var T = frame(road, s + 8, sd * (C.HALF + C.PAVE - 0.9)); props.push({ kind: 'tree', x: T.x, z: T.z, r: 0.45, v: Math.floor(prng.next() * 3), sd: sd }); }
  }
  var grid = {}; props.forEach(function (q) { var key = Math.floor(q.x / 8) + ',' + Math.floor(q.z / 8); (grid[key] || (grid[key] = [])).push(q); });
  road.props = { list: props, grid: grid };
  return road;
}

/* a place along the road and a sideways offset (positive to the left of the way the road is drawn) as a point and a heading */
function frame(road, s, lat) {
  var N = road.N, f = s / road.ds, i = Math.floor(f), t = f - i, a = wrapIdx(i, N), b = wrapIdx(i + 1, N);
  var x = road.xs[a] + (road.xs[b] - road.xs[a]) * t, z = road.zs[a] + (road.zs[b] - road.zs[a]) * t;
  var hx = Math.sin(road.hs[a]) * (1 - t) + Math.sin(road.hs[b]) * t, hz = Math.cos(road.hs[a]) * (1 - t) + Math.cos(road.hs[b]) * t, h = Math.atan2(hx, hz);
  lat = lat || 0;
  return { x: x + Math.cos(h) * lat, z: z - Math.sin(h) * lat, h: h, cx: x, cz: z };
}

/* the nearest place on the road to a point: {s, lat, h, d}. `hint` is a sample index to search near (the bike's last one); with no hint,
   or a long way off it, the whole road is searched. */
function project(road, x, z, hint) {
  var N = road.N, best = 1e18, bi = 0, bt = 0, i, w = 0;
  function seg(i0) {
    var a = wrapIdx(i0, N), b = wrapIdx(i0 + 1, N), ax = road.xs[a], az = road.zs[a], dx = road.xs[b] - ax, dz = road.zs[b] - az, L2 = dx * dx + dz * dz || 1e-9;
    var t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    var px = ax + dx * t, pz = az + dz * t, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) { best = d2; bi = i0; bt = t; }
  }
  if (hint !== undefined && hint !== null) { for (w = -30; w <= 30; w++) seg(hint + w); }
  if (hint === undefined || hint === null || best > 30 * 30) { best = 1e18; for (i = 0; i < N; i++) seg(i); }
  var f = bi + bt, s = ((f * road.ds) % road.length + road.length) % road.length, fr = frame(road, s, 0);
  var lat = (x - fr.cx) * Math.cos(fr.h) - (z - fr.cz) * Math.sin(fr.h);
  return { s: s, lat: lat, h: fr.h, d: Math.sqrt(best), i: wrapIdx(Math.round(f), N), cx: fr.cx, cz: fr.cz };
}

/* shortest signed distance along the road from a to b (positive: b is further along) */
function gap(road, a, b) { var d = (b - a) % road.length; if (d > road.length / 2) d -= road.length; else if (d < -road.length / 2) d += road.length; return d; }

/* how the road rides at s: the stretch's type and name, and the smoothed numbers */
function surfaceAt(road, s) {
  var i = wrapIdx(Math.round(s / road.ds), road.N);
  return { type: road.type[i], name: road.name[i], cap: road.cap[i], tv: road.tv[i], dens: road.dens[i], rough: road.rough[i] };
}

/* the potholes near s (within `reach` metres along the road) */
function holesNear(road, s, reach) {
  var out = [], k0 = Math.floor((s - reach) / 8), k1 = Math.floor((s + reach) / 8), k, nb = Math.floor(road.length / 8) + 1;
  for (k = k0; k <= k1; k++) {
    var list = road.holeGrid[((k % nb) + nb) % nb]; if (!list) continue;
    for (var i = 0; i < list.length; i++) if (Math.abs(gap(road, s, list[i].s)) <= reach) out.push(list[i]);
  }
  return out;
}

/* is a circle at (x, z) clear of every pole and tree? */
function clearOfProps(road, x, z, r) {
  var cx = Math.floor(x / 8), cz = Math.floor(z / 8), i, j, k;
  for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) {
    var cell = road.props.grid[(cx + i) + ',' + (cz + j)]; if (!cell) continue;
    for (k = 0; k < cell.length; k++) { var p = cell[k]; if (Math.hypot(p.x - x, p.z - z) < p.r + r) return false; }
  }
  return true;
}

module.exports = { build: build, frame: frame, project: project, gap: gap, surfaceAt: surfaceAt, holesNear: holesNear, clearOfProps: clearOfProps, smooth01: smooth01 };
