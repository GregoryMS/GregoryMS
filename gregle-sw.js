/* One root registration avoids Maps and Calculator replacing each other's SW. */
'use strict';
if (self.location.hostname === 'calc.gregle.uk') importScripts('/calc-sw.js');
else if (self.location.hostname === 'maps.gregle.uk') importScripts('/maps-sw.js');
else if (self.location.hostname === 'weather.gregle.uk') importScripts('/weather-sw.js');
else importScripts('/calc-sw.js', '/maps-sw.js', '/weather-sw.js');

