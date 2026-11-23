#!/usr/bin/env node
/* Phone-sized screenshots of each kind of stretch and each camera, saved to dist/shots/. Usage: node tools/shots.js */
'use strict';
var path = require('path'), fs = require('fs');
var pw = require('playwright');
var file = path.resolve(__dirname, '..', 'dist', 'toofan-brawler.html'), dir = path.resolve(__dirname, '..', 'dist', 'shots');
fs.mkdirSync(dir, { recursive: true });
(async function () {
  var browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  var ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  var page = await ctx.newPage(), errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); }); page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file); await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  var len = await page.evaluate(function () { return window.__game.ctx.ride.road.length; });
  var spots = [['fast', 0.10], ['jam', 0.32], ['broken', 0.52], ['combo', 0.71], ['bend', 0.17]];
  for (var i = 0; i < spots.length; i++) {
    await page.evaluate(function (s) { window.__game.ctx.debug.teleport(s); }, spots[i][1] * len);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(dir, spots[i][0] + '.png') });
    await page.keyboard.up('KeyW');
  }
  for (var v = 1; v < 4; v++) {
    await page.evaluate(function () { window.__game.ctx.debug.cycleView(); });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(dir, 'view' + v + '.png') }); await page.keyboard.up('KeyW');
  }
  var st = await page.evaluate(function () { var r = window.__game.ctx.ride; return { s: r.bike.s, hp: r.bike.hp, hits: r.hits, traffic: r.traffic.length }; });
  await browser.close(); console.log(JSON.stringify({ st: st, errors: errors }));
  process.exit(errors.length ? 1 : 0);
})();
