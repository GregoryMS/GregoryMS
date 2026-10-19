/* Public starter subscriptions. Publisher headlines stay in their original language. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GregleNewsDefaults = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const version = 1;
  const feeds = [
    {name:'BBC News',url:'https://feeds.bbci.co.uk/news/rss.xml',folder:''},
    {name:'SVT Nyheter',url:'https://www.svt.se/nyheter/rss.xml',folder:''},
    {name:'NRK',url:'https://www.nrk.no/toppsaker.rss',folder:''},
    {name:'Reuters',url:'https://news.google.com/rss/search?q=site%3Areuters.com&hl=en-CA&gl=CA&ceid=CA%3Aen',folder:''},
    {name:'CBC News',url:'https://www.cbc.ca/webfeed/rss/rss-topstories',folder:''},
    {name:'DW Deutsch',url:'https://rss.dw.com/xml/rss-de-all',folder:''}
  ];
  function apply(state) {
    // Add the starter selection once; later removals and imported subscriptions stay intact.
    if (state.defaultFeedsVersion >= version) return state;
    const known = new Set(state.feeds.map(feed => feed.url));
    const missing = feeds.filter(feed => !known.has(feed.url));
    return {...state,feeds:[...state.feeds,...missing.map(feed => ({...feed}))].slice(0,500),defaultFeedsVersion:version};
  }
  function snapshots(data,now=Date.now()) {
    const result=new Map();
    if(data?.version!==1||!Array.isArray(data.feeds))return result;
    for(const snapshot of data.feeds){
      if(!snapshot||typeof snapshot.xml!=='string'||snapshot.xml.length>500000)continue;
      const age=now-Date.parse(snapshot.fetchedAt);
      if(age>=-300000&&age<=2*60*60*1000&&feeds.some(f=>f.url===snapshot.url))result.set(snapshot.url,snapshot);
    }
    return result;
  }
  return {feeds,apply,snapshots};
});
