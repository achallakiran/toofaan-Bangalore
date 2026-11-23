/* data layer: the Bangalore track. One closed road with curves, made of stretches that each ride differently.
   Metres. Control points are smoothed into a curve by sim/road. Stretches are fractions of the loop's length.
   fast: open and quick, few vehicles. jam: bumper to bumper, crawling. broken: potholes and patches, the bike is slowed.
   combo: broken and jammed together. cap: share of top speed the bike can reach. tv: how fast traffic runs. dens: vehicles per 100 m (both ways). */
'use strict';

var COURSE = {
  HALF: 7,                 /* half the carriageway: two lanes each way and a median */
  LANES: [1.9, 5.1],       /* inner and outer lane centres, from the centre line */
  PAVE: 3,                 /* pavement beyond the kerb; the bike may ride onto it */
  STEP: 2,                 /* metres between samples of the curve */
  POINTS: [[232, 0], [225, 80], [150, 125], [75, 95], [-10, 135], [-110, 140], [-190, 90], [-215, 10], [-165, -60], [-120, -120], [-40, -105], [45, -140], [125, -120], [180, -65]],
  /* where the bike starts: metres along the road, in the outer lane going the way the road is drawn */
  START: 30,
  TYPES: {
    fast:   { cap: 1.0,  tv: 1.25, dens: 7,  rough: 0,   pot: 0 },
    jam:    { cap: 1.0,  tv: 0.3,  dens: 28, rough: 0,   pot: 0 },
    broken: { cap: 0.55, tv: 0.6,  dens: 12, rough: 1,   pot: 1 },
    combo:  { cap: 0.5,  tv: 0.3,  dens: 24, rough: 1,   pot: 0.8 }
  },
  STRETCHES: [
    { f0: 0.00, f1: 0.22, type: 'fast',   name: 'Outer Ring Road' },
    { f0: 0.22, f1: 0.42, type: 'jam',    name: 'Silk Board Junction' },
    { f0: 0.42, f1: 0.62, type: 'broken', name: 'Hosur Service Road' },
    { f0: 0.62, f1: 0.80, type: 'combo',  name: 'KR Market' },
    { f0: 0.80, f1: 1.00, type: 'fast',   name: 'Tech Corridor' }
  ]
};

module.exports = COURSE;
