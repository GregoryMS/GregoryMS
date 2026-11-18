const {test} = require('node:test');
const assert = require('node:assert/strict');
const {convert,parseAmount,referenceRates,searchCategories} = require('../assets/calc-units.js');

const near = (value,expected) => assert(Math.abs(value-expected) < 1e-10,`${value} != ${expected}`);

test('linear, offset and reciprocal conversions work in both directions', () => {
  assert.equal(convert('length',1,'mi','m'),1609.344);
  near(convert('volume',1,'imp gal','L'),4.54609);
  near(convert('temperature',-40,'°C','°F'),-40);
  near(convert('temperature',32,'°F','°C'),0);
  assert.equal(convert('temperature',-273.15,'°C','K'),0);
  assert(Number.isNaN(convert('temperature',-1,'K','°C')));
  near(convert('fuel',8,'L/100 km','US mpg'),29.401822916666665);
  near(convert('fuel',convert('fuel',8,'L/100 km','imp mpg'),'imp mpg','L/100 km'),8);
  near(convert('fuel',8,'L/100 km','km/L'),12.5);
  assert(Number.isNaN(convert('fuel',0,'L/100 km','US mpg')));
  near(convert('storage',1,'MiB','MB'),1.048576);
  assert(Number.isNaN(convert('absorbed-dose',1,'Gy','Sv')));
});

test('search matches unit names, symbols and categories', () => {
  const matches = query => searchCategories(query).flatMap(([,entries]) => entries.map(([id]) => id));
  assert(matches('feet').includes('length'));
  assert(matches('binary storage').includes('storage'));
  assert(matches('square meter').includes('area'));
  assert(matches('kilometres litre').includes('fuel'));
  assert.deepEqual(matches('złoty'),['currency']);
  assert.deepEqual(matches('no matching unit'),[]);
  assert.equal(parseAmount('−1,25'),-1.25);
  assert.equal(parseAmount(' 2e3 '),2000);
  assert(Number.isNaN(parseAmount('')));
});

test('currency uses a complete dated CAD table and rejects missing rates', () => {
  const [,units] = searchCategories('currency')[0];
  const codes = units[0][2].map(([,code]) => code).filter(code => code !== 'CAD');
  const rates = Object.fromEntries(codes.map(code => [code,1]));
  rates.USD = 0.75;
  rates.EUR = 0.6;
  const data = referenceRates({base:'CAD',date:'2026-11-18',rates});
  near(convert('currency',100,'USD','EUR',data.rates),80);
  assert.equal(convert('currency',80,'CAD','CAD'),80);
  assert(Number.isNaN(convert('currency',1,'CAD','USD')));
  assert.equal(referenceRates({base:'CAD',date:'2026-11-18',rates:{USD:0.75}}),null);
});
