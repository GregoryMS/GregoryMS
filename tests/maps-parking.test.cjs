const {test}=require('node:test'),assert=require('node:assert/strict');
const parking=require('../assets/maps-parking-core.js'),maps=require('../assets/maps-core.js');
const snapshot=require('../data/victoria-parking.json');
test('official parking snapshot contains all five photo colours, 1903 general spaces and eight city facilities',()=>{
 const d=parking.read(snapshot);assert.equal(d.spaces.length,1903);assert.equal(d.facilities.filter(f=>f.kind==='parkade').length,5);assert.equal(d.facilities.filter(f=>f.kind==='lot').length,3);
 assert.deepEqual([...new Set(d.spaces.map(s=>s.zone))].sort(),[1,2,3,4,5]);assert.equal(parking.zones[4].limit,'4 hrs');assert.equal(parking.zones[1].sundayRate,2.5);assert.equal(parking.zones[5].sundayLimit,'24 hrs');
});
test('parking rejects malformed locations, duplicated spaces and unrecognised zones',()=>{
 for(const mutate of [d=>d.spaces[0].point=[0,0],d=>d.spaces[0].zone=9,d=>d.spaces.push(d.spaces[0]),d=>d.source='https://example.com/',d=>d.facilities[0].kind='private']){const d=structuredClone(snapshot);mutate(d);assert.throws(()=>parking.read(d));}
});
test('parking is off by default and saved links preserve the layer with other overlays',()=>{
 assert.equal(maps.normalizeLayers(null).parking,false);
 const state=maps.normalizeLayers({parking:true,ev:true,base:'3d'});assert.deepEqual(maps.readLayers(maps.makeHash(maps.defaultView,null,state)),state);
});
