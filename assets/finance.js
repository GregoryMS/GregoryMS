(() => {
  'use strict';
  const {currencies,search,normalizeSymbol,cleanFavourites}=GregleFinance;
  const $=id=>document.getElementById(id);
  const storageKey='gregle-finance-favourites';
  let favourites=[{symbol:'NASDAQ:AAPL',name:'Apple'},{symbol:'NASDAQ:MSFT',name:'Microsoft'},{symbol:'FX_IDC:USDCAD',name:'USD/CAD'},{symbol:'FX_IDC:GBPCAD',name:'GBP/CAD'}];
  try { const saved=localStorage.getItem(storageKey); if(saved!==null) favourites=cleanFavourites(JSON.parse(saved)); } catch (_) {}
  const params=new URLSearchParams(location.search);
  let symbol=normalizeSymbol(params.get('tvwidgetsymbol') || params.get('symbol')) || 'NASDAQ:AAPL';
  const disposers=new Map();
  const chartURL=()=>`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
  const localChartURL=new URL('finance.html',location.href).href;
  const theme=()=>document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light';

  function embed(id,kind,config,label,fallback) {
    disposers.get(id)?.();
    const host=$(id);
    host.replaceChildren();
    const container=document.createElement('div');
    container.className='tradingview-widget-container';
    const slot=document.createElement('div');
    slot.className='tradingview-widget-container__widget';
    slot.textContent=`Loading ${label.toLowerCase()}…`;
    const attribution=document.createElement('div');
    attribution.className='tradingview-widget-copyright';
    const link=document.createElement('a');
    link.href=fallback; link.target='_blank'; link.rel='noopener nofollow';
    link.textContent=`${label} by TradingView`;
    attribution.append(link);
    const script=document.createElement('script');
    script.src=`https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js`;
    script.async=true;
    script.textContent=JSON.stringify(config);
    let disposed=false;
    const observer=new MutationObserver(()=>{
      const frame=container.querySelector('iframe');
      if(frame) { frame.title=label; clearTimeout(timer); observer.disconnect(); }
    });
    const cleanup=()=>{ disposed=true; clearTimeout(timer); observer.disconnect(); script.onerror=null; };
    const fail=()=>{
      if(disposed) return;
      cleanup();
      const message=document.createElement('div'); message.className='widget-error';
      const text=document.createElement('p'); text.textContent=`${label} could not load. Check your connection or open TradingView.`;
      const retry=document.createElement('button'); retry.className='pill'; retry.type='button'; retry.textContent='Try again';
      retry.addEventListener('click',()=>embed(id,kind,config,label,fallback));
      message.append(text,retry,link); host.replaceChildren(message);
    };
    const timer=setTimeout(fail,20000);
    script.onerror=fail;
    observer.observe(container,{childList:true,subtree:true});
    disposers.set(id,cleanup);
    container.append(slot,attribution); host.append(container); container.append(script);
  }
  function renderChart() {
    $('chartFallback').href=chartURL();
    embed('chartWidget','advanced-chart',{
      autosize:true,symbol,interval:'D',timezone:'Etc/UTC',theme:theme(),style:'3',locale:'en',
      allow_symbol_change:true,hide_top_toolbar:false,hide_side_toolbar:true,hide_volume:false,
      withdateranges:true,save_image:false,calendar:false,details:false,hotlist:false,
      backgroundColor:theme()==='dark' ? '#2c2c2c' : '#ffffff',support_host:'https://www.tradingview.com'
    },'Interactive stock and currency chart',chartURL());
  }
  function renderDashboards() {
    embed('cadTickerWidget','ticker-tape',{
      symbols:['GBP','EUR','SEK','NOK','AUD','NZD','USD','CHF','JPY'].map(currency=>({
        proName:`FX_IDC:${currency}CAD`,title:`${currency} / CAD`
      })),
      colorTheme:theme(),locale:'en',isTransparent:false,showSymbolLogo:true,
      displayMode:'regular',largeChartUrl:localChartURL
    },'CAD currency ticker','https://www.tradingview.com/markets/currencies/rates-cross/');
    embed('marketWidget','market-overview',{
      colorTheme:theme(),dateRange:'12M',locale:'en',width:'100%',height:'100%',
      isTransparent:false,showChart:true,showSymbolLogo:true,showFloatingTooltip:true,largeChartUrl:localChartURL,
      plotLineColorGrowing:'#326c63',plotLineColorFalling:'#326c63',
      belowLineFillColorGrowing:'rgba(50,108,99,0.12)',belowLineFillColorFalling:'rgba(50,108,99,0.12)',
      belowLineFillColorGrowingBottom:'rgba(50,108,99,0)',belowLineFillColorFallingBottom:'rgba(50,108,99,0)',
      tabs:[
        {title:'Markets',symbols:[
          {s:'FOREXCOM:SPXUSD',d:'S&P 500 · CFD'},{s:'FOREXCOM:NSXUSD',d:'Nasdaq 100 · CFD'},
          {s:'FOREXCOM:DJI',d:'Dow 30 · CFD'},{s:'FOREXCOM:UKXGBP',d:'FTSE 100 · CFD'},
          {s:'TSX:XIU',d:'S&P/TSX 60 · ETF'}]},
        {title:'Stocks',symbols:[{s:'NASDAQ:AAPL',d:'Apple'},{s:'NASDAQ:MSFT',d:'Microsoft'},
          {s:'NASDAQ:NVDA',d:'NVIDIA'},{s:'NASDAQ:GOOGL',d:'Alphabet'},{s:'NASDAQ:AMZN',d:'Amazon'}]},
        {title:'Canada',symbols:[{s:'TSX:RY',d:'Royal Bank'},{s:'TSX:TD',d:'TD Bank'},
          {s:'TSX:SHOP',d:'Shopify'},{s:'TSX:ENB',d:'Enbridge'},{s:'TSX:CNR',d:'CN Railway'}]}
      ]
    },'Market overview','https://www.tradingview.com/markets/');
    embed('currencyWidget','market-overview',{
      width:'100%',height:'100%',locale:'en',colorTheme:theme(),isTransparent:false,showChart:false,showSymbolLogo:true,largeChartUrl:localChartURL,
      tabs:[
        {title:'Major pairs',symbols:[{s:'FX_IDC:USDCAD',d:'USD / CAD'},{s:'FX_IDC:EURUSD',d:'EUR / USD'},
          {s:'FX_IDC:GBPUSD',d:'GBP / USD'},{s:'FX_IDC:USDJPY',d:'USD / JPY'},
          {s:'FX_IDC:AUDUSD',d:'AUD / USD'},{s:'FX_IDC:USDCHF',d:'USD / CHF'}]},
        {title:'Canadian dollar',symbols:[{s:'FX_IDC:USDCAD',d:'USD / CAD'},{s:'FX_IDC:GBPCAD',d:'GBP / CAD'},
          {s:'FX_IDC:EURCAD',d:'EUR / CAD'},{s:'FX_IDC:AUDCAD',d:'AUD / CAD'},
          {s:'FX_IDC:NZDCAD',d:'NZD / CAD'},{s:'FX_IDC:CADJPY',d:'CAD / JPY'}]},
        {title:'Europe',symbols:[{s:'FX_IDC:EURGBP',d:'EUR / GBP'},{s:'FX_IDC:EURCHF',d:'EUR / CHF'},
          {s:'FX_IDC:EURNOK',d:'EUR / NOK'},{s:'FX_IDC:EURSEK',d:'EUR / SEK'},
          {s:'FX_IDC:GBPNOK',d:'GBP / NOK'},{s:'FX_IDC:GBPSEK',d:'GBP / SEK'}]}
      ]
    },'Currency quotes','https://www.tradingview.com/markets/currencies/rates-major/');
  }
  function choose(item,scroll=true) {
    symbol=item.symbol;
    const url=new URL(location.href); url.searchParams.delete('tvwidgetsymbol'); url.searchParams.set('symbol',symbol);
    history.replaceState(null,'',url);
    $('searchResults').hidden=true; $('symbolSearch').value='';
    $('searchStatus').textContent=`Opening ${item.name} in the chart.`;
    renderChart();
    if(scroll) $('explore').scrollIntoView({block:'start'});
  }
  function save() {
    try { localStorage.setItem(storageKey,JSON.stringify(favourites)); $('saveStatus').textContent=''; }
    catch (_) { $('saveStatus').textContent='Favourites work for this visit, but this browser cannot save them.'; }
    renderFavourites();
  }
  function renderFavourites() {
    $('favourites').replaceChildren();
    if(!favourites.length) { const empty=document.createElement('span'); empty.className='hint'; empty.textContent='Search above and save a symbol to keep it here.'; $('favourites').append(empty); }
    favourites.forEach(item=>{
      const chip=document.createElement('span'); chip.className='favourite';
      const open=document.createElement('button'); open.type='button'; open.textContent=item.name; open.title=item.symbol;
      open.addEventListener('click',()=>choose(item));
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='×'; remove.setAttribute('aria-label',`Remove ${item.name} from favourites`);
      remove.addEventListener('click',()=>{ favourites=favourites.filter(f=>f.symbol!==item.symbol); save(); renderResults(); });
      chip.append(open,remove); $('favourites').append(chip);
    });
  }
  function renderResults() {
    const query=$('symbolSearch').value.trim();
    const result=search(query); $('searchResults').replaceChildren(); $('searchResults').hidden=!query;
    if(!query) { $('searchStatus').textContent=''; return; }
    $('searchStatus').textContent=result.length ? `${result.length} suggestions. Select one to view its chart.` : 'No quick-search match. Use the chart’s symbol search for all listings.';
    if(!result.length) { const empty=document.createElement('p'); empty.className='lookup-empty'; empty.textContent='No quick-search match. Try an exchange:ticker, or click the symbol at the top left of the chart to search all listings.'; $('searchResults').append(empty); }
    result.forEach(item=>{
      const row=document.createElement('div'); row.className='lookup-result';
      const open=document.createElement('button'); open.type='button'; open.className='choose-symbol';
      const title=document.createElement('strong'); title.textContent=item.name;
      const info=document.createElement('small'); info.textContent=`${item.symbol} · ${item.description || item.type}`;
      open.append(title,info); open.addEventListener('click',()=>choose(item));
      const add=document.createElement('button'); add.className='pill save-symbol'; add.type='button';
      const saved=favourites.some(f=>f.symbol===item.symbol); add.textContent=saved ? 'Saved' : '☆ Save'; add.disabled=saved;
      add.setAttribute('aria-label',saved ? `${item.name} is saved` : `Save ${item.name} to favourites`);
      add.addEventListener('click',()=>{
        if(favourites.length>=12) { $('saveStatus').textContent='You have 12 favourites. Remove one to make room for another.'; return; }
        favourites.push({symbol:item.symbol,name:item.name}); save(); renderResults();
      });
      row.append(open,add); $('searchResults').append(row);
    });
  }
  $('symbolSearch').addEventListener('input',renderResults);
  $('symbolSearch').addEventListener('keydown',event=>{ if(event.key==='Escape') $('searchResults').hidden=true; });
  $('symbolForm').addEventListener('submit',event=>{
    event.preventDefault(); const result=search($('symbolSearch').value);
    if(result.length) choose(result[0]); else renderResults();
  });
  for(const id of ['baseCurrency','quoteCurrency']) currencies.forEach(([code,name])=>{
    const option=document.createElement('option'); option.value=code; option.textContent=`${code} · ${name}`; $(id).append(option);
  });
  $('baseCurrency').value='USD'; $('quoteCurrency').value='CAD';
  const validatePair=()=>{ $('viewPair').disabled=$('baseCurrency').value===$('quoteCurrency').value; $('viewPair').textContent=$('viewPair').disabled ? 'Choose different currencies' : 'Explore this pair ↗'; };
  $('baseCurrency').addEventListener('change',validatePair); $('quoteCurrency').addEventListener('change',validatePair);
  $('viewPair').addEventListener('click',()=>{
    const base=$('baseCurrency').value,quote=$('quoteCurrency').value;
    if(base===quote) return;
    choose({symbol:`FX_IDC:${base}${quote}`,name:`${base}/${quote}`});
  });
  $('reloadChart').addEventListener('click',renderChart);
  $('themeToggle').addEventListener('click',()=>{ renderChart(); renderDashboards(); });
  renderFavourites(); renderChart(); renderDashboards();
})();
