// Transitous source names mapped to the operator IDs published by BC Transit:
// https://www.bctransit.com/open-data/ . Keep the feed namespace in route IDs;
// route numbers alone are not unique between cities.
const operators = Object.freeze({
  'Campbell-River-Transit':12, 'Comox-Valley-Transit':45,
  'Cowichan-Valley-Transit':10, 'Creston-Transit':16,
  'Dawson-Creek-Transit':27, 'East-Kootenay-Transit':21,
  'Fort-St-John-Transit':28, 'Fraser-Valley-Transit':13,
  'Kamloops-Transit':46, 'Nanaimo-Transit':41,
  'North-Okanagan-Transit':14, 'Port-Alberni-Transit':11,
  'Powell-River-Transit':29, 'Prince-George-Transit':22,
  'Prince-Rupert-Transit':23, 'South-Okanagan-Transit':15,
  'Squamish-Transit':43, 'Sunshine-Coast-Transit':18,
  'Victoria-Transit':48, 'West-Kootenay-Transit':20, 'Whistler-Transit':44
});
export function resolveRoute(id) {
  if(typeof id!=='string'||id.length>250)return null;
  const match=/^ca-bc-([A-Za-z-]+)_([A-Za-z0-9:.-]{1,100})$/.exec(id);
  if(!match)return null;
  const [,source,route]=match;
  if(source==='TransLink')return {feed:'translink',route,source,label:'TransLink',maxAgeSeconds:300,interval:120000};
  const operator=operators[source];
  return operator?{feed:`bc-${operator}`,route,source,label:'BC Transit',maxAgeSeconds:120,interval:30000}:null;
}
export function provider(feed) {
  if(feed==='translink')return {label:'TransLink',maxAgeSeconds:300,interval:120000};
  const operator=/^bc-(\d+)$/.exec(feed)?.[1];
  return operator&&Object.values(operators).includes(Number(operator))?{operator,label:'BC Transit',maxAgeSeconds:120,interval:30000}:null;
}
