(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/satellite.min.js'));
  else root.GregleSatelliteCore = factory(root.satellite);
})(typeof window === 'object' ? window : globalThis, function (S) {
  'use strict';
  const DAY = 86400000;
  const satellites = [
    {id:25544, name:'International Space Station', short:'ISS'},
    {id:48274, name:'Tiangong space station', short:'Tiangong'},
    {id:20580, name:'Hubble Space Telescope', short:'Hubble'},
    {id:25994, name:'Terra', short:'Terra'},
    {id:27424, name:'Aqua', short:'Aqua'}
  ];
  function record(data, id, now = Date.now()) {
    const epoch = Date.parse(data?.EPOCH + 'Z');
    const fields = ['MEAN_MOTION','ECCENTRICITY','INCLINATION','RA_OF_ASC_NODE','ARG_OF_PERICENTER',
      'MEAN_ANOMALY','BSTAR','MEAN_MOTION_DOT','MEAN_MOTION_DDOT'];
    if (!S || !data || data.NORAD_CAT_ID !== id || !Number.isFinite(epoch) ||
        now - epoch > 7 * DAY || epoch - now > DAY ||
        !fields.every(key => Number.isFinite(data[key])) ||
        data.MEAN_MOTION <= 0 || data.MEAN_MOTION > 18 || data.ECCENTRICITY < 0 ||
        data.ECCENTRICITY >= 1 || data.INCLINATION < 0 || data.INCLINATION > 180) throw Error('Orbit data missing, invalid or older than seven days');
    const satrec = S.json2satrec(data);
    if (satrec.error) throw Error('Invalid orbit');
    return {satrec, epoch};
  }
  function position(orbit, time, place) {
    const date = new Date(time), state = S.propagate(orbit.satrec, date);
    if (!state || !state.position || !state.velocity || orbit.satrec.error) throw Error('Orbit calculation unavailable');
    const gmst = S.gstime(date), geo = S.eciToGeodetic(state.position, gmst);
    const result = {latitude:S.degreesLat(geo.latitude), longitude:S.degreesLong(geo.longitude),
      altitude:geo.height, velocity:Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z)*3600,
      timestamp:time/1000, elevation:null};
    if (place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
      result.elevation = S.ecfToLookAngles({latitude:place.latitude*Math.PI/180,
        longitude:place.longitude*Math.PI/180, height:0}, S.eciToEcf(state.position,gmst)).elevation*180/Math.PI;
    }
    if (![result.latitude,result.longitude,result.altitude,result.velocity].every(Number.isFinite) ||
        result.altitude <= 0 || result.altitude > 2000) throw Error('Satellite orbit unavailable');
    return result;
  }
  function segments(points) {
    const result = []; let current = [];
    for (const p of points) {
      const last = current[current.length-1];
      if (last && (Math.abs(p.longitude-last.longitude)>180 || p.timestamp-last.timestamp>61)) {
        result.push(current.map(p => [p.latitude,p.longitude])); current=[];
      }
      current.push(p);
    }
    if (current.length) result.push(current.map(p => [p.latitude,p.longitude]));
    return result;
  }
  function projectedPath(orbit, now) {
    const points = [];
    for (let minute=0; minute<=90; minute++) points.push(position(orbit,now+minute*60000));
    return segments(points);
  }
  function passesURL(place, id=25544) {
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) ||
        Math.abs(place.latitude)>90 || Math.abs(place.longitude)>180) return 'https://www.heavens-above.com/';
    return 'https://www.heavens-above.com/PassSummary.aspx?' + new URLSearchParams({
      satid:String(id),lat:String(place.latitude),lng:String(place.longitude),alt:'0',loc:place.name || 'Observing location'
    });
  }
  return {satellites,record,position,segments,projectedPath,passesURL};
});
