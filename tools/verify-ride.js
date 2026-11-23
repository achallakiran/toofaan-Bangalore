#!/usr/bin/env node
/* Opens the built file from file:// in headless Chromium with the network refused: the game must boot straight into the free ride,
   the bike must go when the stick is pushed, and nothing may log an error. Saves a phone-sized shot to dist/. */
'use strict';
var path = require('path');
var pw = require('playwright');
var file = path.resolve(__dirname, '..', 'dist', 'toofan-brawler.html');
var shotDir = process.argv[2] || path.resolve(__dirname, '..', 'dist');
(async function () {
  var browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  var ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  var page = await ctx.newPage(), errors = [], blocked = [];
  await ctx.route(/^https?:/, function (r) { blocked.push(r.request().url()); r.abort(); });
  page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + file);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  var mode = await page.evaluate(function () { return window.__game.modes.currentName(); });
  var free = await page.evaluate(function () { return !!window.__game.ctx.ride.free && !!window.__game.ctx.ride.road; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
  var speed = await page.evaluate(function () { return window.__game.ctx.ride.bike.speed; });
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: path.join(shotDir, 'shot-ride-phone.png') });
  await browser.close();
  var ok = mode === 'ride' && free && speed > 3 && !errors.length && !blocked.length;
  console.log(JSON.stringify({ mode: mode, free: free, speed: +speed.toFixed(1), errors: errors, blocked: blocked }, null, 1));
  console.log(ok ? 'RIDE VERIFY: PASS' : 'RIDE VERIFY: FAIL'); process.exit(ok ? 0 : 1);
})();
