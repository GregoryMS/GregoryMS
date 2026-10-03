/* Quick lookup is a convenience directory, not a quote feed. All prices come from TradingView. */
(function (root) {
  'use strict';
  const stocks = [
    ['NASDAQ:AAPL','Apple'],['NASDAQ:MSFT','Microsoft'],['NASDAQ:NVDA','NVIDIA'],
    ['NASDAQ:GOOGL','Alphabet · Google'],['NASDAQ:AMZN','Amazon'],['NASDAQ:META','Meta · Facebook'],
    ['NASDAQ:TSLA','Tesla'],['NASDAQ:AMD','Advanced Micro Devices'],['NASDAQ:NFLX','Netflix'],
    ['NASDAQ:INTC','Intel'],['NASDAQ:AVGO','Broadcom'],['NASDAQ:COST','Costco'],
    ['NYSE:BRK.B','Berkshire Hathaway'],['NYSE:V','Visa'],['NYSE:MA','Mastercard'],
    ['NYSE:JPM','JPMorgan Chase'],['NYSE:WMT','Walmart'],['NYSE:DIS','Walt Disney'],
    ['NYSE:KO','Coca-Cola'],['NYSE:XOM','Exxon Mobil'],['NYSE:TSM','Taiwan Semiconductor'],
    ['NYSE:SPOT','Spotify'],['TSX:RY','Royal Bank of Canada'],['TSX:TD','Toronto-Dominion Bank'],
    ['TSX:BNS','Scotiabank'],['TSX:BMO','Bank of Montreal'],['TSX:CM','CIBC'],
    ['TSX:SHOP','Shopify'],['TSX:ENB','Enbridge'],['TSX:CNQ','Canadian Natural Resources'],
    ['TSX:CNR','Canadian National Railway'],['TSX:CP','Canadian Pacific Kansas City'],
    ['TSX:SU','Suncor Energy'],['TSX:BCE','BCE'],['TSX:T','Telus'],
    ['LSE:HSBA','HSBC'],['LSE:SHEL','Shell'],['LSE:BP.','BP'],['LSE:AZN','AstraZeneca']
  ].map(([symbol,name]) => ({symbol,name,type:'Stock'}));
  const currencies = [
    ['USD','US dollar'],['CAD','Canadian dollar'],['GBP','British pound'],['EUR','Euro'],
    ['JPY','Japanese yen'],['CHF','Swiss franc'],['AUD','Australian dollar'],
    ['NZD','New Zealand dollar'],['NOK','Norwegian krone'],['SEK','Swedish krona']
  ];
  const pairs = currencies.flatMap(([a,an]) => currencies.filter(([b]) => b!==a).map(([b,bn]) =>
    ({symbol:`FX_IDC:${a}${b}`,name:`${a}/${b}`,description:`${an} / ${bn}`,type:'Currency'})));
  const markets = [
    ['FOREXCOM:SPXUSD','S&P 500 CFD'],['FOREXCOM:NSXUSD','Nasdaq 100 CFD'],
    ['FOREXCOM:DJI','Dow 30 CFD'],['FOREXCOM:UKXGBP','FTSE 100 CFD'],
    ['AMEX:SPY','S&P 500 · SPDR ETF'],['NASDAQ:QQQ','Nasdaq 100 · Invesco ETF'],
    ['TSX:XIU','S&P/TSX 60 · iShares ETF']
  ].map(([symbol,name]) => ({symbol,name,type:'Market tracker'}));
  const directory = [...stocks,...markets,...pairs];
  function normalizeSymbol(value) {
    if(typeof value!=='string') return '';
    const raw=value.trim().toUpperCase();
    const compact=raw.replace(/\s+/g,'').replace(/\//g,'');
    if(/^[A-Z]{6}$/.test(compact) && currencies.some(([c])=>c===compact.slice(0,3)) && currencies.some(([c])=>c===compact.slice(3)) && compact.slice(0,3)!==compact.slice(3)) return `FX_IDC:${compact}`;
    return /^(?:[A-Z0-9_]{1,20}:)?[A-Z0-9][A-Z0-9.!_-]{0,24}$/.test(raw) ? raw : '';
  }
  function search(query) {
    const q=String(query||'').trim().toLowerCase();
    if(!q) return [];
    const normalized=normalizeSymbol(q);
    const exact=directory.find(item=>item.symbol===normalized || item.symbol.split(':')[1]===normalized || item.name.toLowerCase()===q);
    const matches=directory.filter(item=>`${item.symbol} ${item.name} ${item.description||''}`.toLowerCase().includes(q));
    const result=exact ? [exact,...matches.filter(item=>item!==exact)] : matches;
    if(!result.length && normalized) result.push({symbol:normalized,name:normalized,type:'Look up symbol'});
    return result.slice(0,6);
  }
  function cleanFavourites(value) {
    if(!Array.isArray(value)) return [];
    const seen=new Set();
    return value.filter(item=>item && typeof item.name==='string' && item.name.length<=80 && normalizeSymbol(item.symbol)===item.symbol && item.symbol && !seen.has(item.symbol) && seen.add(item.symbol)).slice(0,12).map(({symbol,name})=>({symbol,name}));
  }
  root.GregleFinance = {currencies,search,normalizeSymbol,cleanFavourites};
})(typeof globalThis!=='undefined' ? globalThis : this);
