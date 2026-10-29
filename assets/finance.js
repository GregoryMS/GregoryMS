(() => {
  'use strict';
  const {currencies,search,normalizeSymbol,cleanFavourites}=GregleFinance;
  const $=id=>document.getElementById(id);
  const storageKey='gregle-finance-favourites';
  let favourites=[{symbol:'NASDAQ:AAPL',name:'Apple'},{symbol:'NASDAQ:MSFT',name:'Microsoft'},{symbol:'FX_IDC:USDCAD',name:'USD/CAD'},{symbol:'FX_IDC:GBPCAD',name:'GBP/CAD'}];
  try { const saved=localStorage.getItem(storageKey); if(saved!==null) favourites=cleanFavourites(JSON.parse(saved)); } catch (_) {}
  const params=new URLSearchParams(location.search);
  let symbol=normalizeSymbol(params.get('tvwidgetsymbol') || params.get('symbol')) || 'NASDAQ:AAPL';
  let activeView='markets';
  let editingFavourites=false;
  const views=['markets','explore','currencies'];
  const tabs=Array.from(document.querySelectorAll('[data-finance-view]'));
  const loadedViews=new Set();
  const disposers=new Map();
  const chartURL=()=>`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
  const localChartURL=new URL(location.href).origin + new URL(location.href).pathname;
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
      if(frame) {
        frame.title=label; clearTimeout(timer); observer.disconnect();
        if(id==='cadTickerWidget') {
          const shell=document.createElement('div');
          shell.className='cad-ticker-frame';
          frame.replaceWith(shell);
          shell.append(frame);
        }
      }
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
      backgroundColor:theme()==='dark' ? '#23232c' : '#ffffff',support_host:'https://www.tradingview.com'
    },'Interactive stock and currency chart',chartURL());
  }
  function renderDashboards(view) {
    const accent=theme()==='dark' ? '#bf9bff' : '#7044c7';
    const accentRGB=theme()==='dark' ? '191,155,255' : '112,68,199';
    if(view==='currencies') embed('cadTickerWidget','ticker-tape',{
      symbols:['GBP','EUR','SEK','NOK','AUD','NZD','USD','CHF','JPY'].map(currency=>({
        proName:`FX_IDC:${currency}CAD`,title:`${currency} / CAD`
      })),
      colorTheme:theme(),locale:'en',isTransparent:true,showSymbolLogo:true,
      displayMode:'regular',largeChartUrl:localChartURL
    },'CAD currency ticker','https://www.tradingview.com/markets/currencies/rates-cross/');
    if(view==='markets') embed('marketWidget','market-overview',{
      colorTheme:theme(),dateRange:'12M',locale:'en',width:'100%',height:'100%',
      isTransparent:true,showChart:true,showSymbolLogo:true,showFloatingTooltip:true,largeChartUrl:localChartURL,
      plotLineColorGrowing:accent,plotLineColorFalling:accent,
      belowLineFillColorGrowing:`rgba(${accentRGB},0.12)`,belowLineFillColorFalling:`rgba(${accentRGB},0.12)`,
      belowLineFillColorGrowingBottom:`rgba(${accentRGB},0)`,belowLineFillColorFallingBottom:`rgba(${accentRGB},0)`,
      tabs:[
        {title:'Markets',symbols:[
          {s:'TSX:TSX',d:'S&P/TSX Composite'},
          {s:'FOREXCOM:SPXUSD',d:'S&P 500 · CFD'},{s:'FOREXCOM:NSXUSD',d:'Nasdaq 100 · CFD'},
          {s:'FOREXCOM:DJI',d:'Dow 30 · CFD'},{s:'FOREXCOM:UKXGBP',d:'FTSE 100 · CFD'},
          {s:'TSX:XIU',d:'S&P/TSX 60 · ETF'}]},
        {title:'Stocks',symbols:[{s:'NASDAQ:AAPL',d:'Apple'},{s:'NASDAQ:MSFT',d:'Microsoft'},
          {s:'NASDAQ:NVDA',d:'NVIDIA'},{s:'NASDAQ:GOOGL',d:'Alphabet'},{s:'NASDAQ:AMZN',d:'Amazon'}]},
        {title:'Canada',symbols:[{s:'TSX:RY',d:'Royal Bank'},{s:'TSX:TD',d:'TD Bank'},
          {s:'TSX:SHOP',d:'Shopify'},{s:'TSX:ENB',d:'Enbridge'},{s:'TSX:CNR',d:'CN Railway'}]}
      ]
    },'Market overview','https://www.tradingview.com/markets/');
    if(view==='currencies') embed('currencyWidget','market-overview',{
      width:'100%',height:'100%',locale:'en',colorTheme:theme(),isTransparent:true,showChart:false,showSymbolLogo:true,largeChartUrl:localChartURL,
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
  function renderActiveView() {
    if(loadedViews.has(activeView)) return;
    if(activeView==='explore') renderChart(); else renderDashboards(activeView);
    loadedViews.add(activeView);
  }
  function dismissResults() {
    $('searchResults').hidden=true;
  }
  function showView(view,updateURL=true) {
    if(!views.includes(view)) return;
    activeView=view;
    tabs.forEach(tab=>{
      const selected=tab.dataset.financeView===view;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex=selected ? 0 : -1;
    });
    views.forEach(id=>{ $(id).hidden=id!==view; });
    dismissResults();
    if(updateURL) { const url=new URL(location.href); url.hash=view; history.replaceState(null,'',url); }
    renderActiveView();
    renderFavourites();
  }
  function choose(item,scroll=true) {
    symbol=item.symbol;
    const url=new URL(location.href); url.searchParams.delete('tvwidgetsymbol'); url.searchParams.set('symbol',symbol); url.hash='explore';
    history.replaceState(null,'',url);
    dismissResults(); $('symbolSearch').value='';
    $('searchStatus').textContent=`Opening ${item.name} in the chart.`;
    loadedViews.delete('explore');
    showView('explore',false);
    if(scroll) { $('exploreTitle').focus({preventScroll:true}); $('financeViews').scrollIntoView({block:'start'}); }
  }
  function addFavourite(item) {
    if(favourites.some(f=>f.symbol===item.symbol)) return;
    if(favourites.length>=12) { $('saveStatus').textContent='You have 12 favourites. Use Edit to remove one first.'; return; }
    favourites.push({symbol:item.symbol,name:item.name}); save();
  }
  function save() {
    try { localStorage.setItem(storageKey,JSON.stringify(favourites)); $('saveStatus').textContent=''; }
    catch (_) { $('saveStatus').textContent='Favourites work for this visit, but this browser cannot save them.'; }
    renderFavourites();
  }
  function renderFavourites() {
    $('favourites').replaceChildren();
    if(!favourites.length) { const empty=document.createElement('span'); empty.className='hint'; empty.textContent='Search above and save a symbol to keep it here.'; $('favourites').append(empty); }
    favourites.forEach((item,index)=>{
      const chip=document.createElement('span'); chip.className='favourite';
      const open=document.createElement('button'); open.type='button'; open.textContent=item.name; open.title=item.symbol;
      open.addEventListener('click',()=>choose(item));
      const remove=document.createElement('button'); remove.type='button'; remove.className='remove-favourite'; remove.textContent='×'; remove.setAttribute('aria-label',`Remove ${item.name} from favourites`);
      remove.addEventListener('click',()=>{
        favourites=favourites.filter(f=>f.symbol!==item.symbol); save(); renderResults();
        const next=$('favourites').children[Math.min(index,favourites.length-1)];
        (next?.querySelector('.remove-favourite') || $('editFavourites')).focus();
      });
      chip.append(open,remove); $('favourites').append(chip);
    });
  }
  function renderResults() {
    const query=$('symbolSearch').value.trim();
    const result=search(query); $('searchResults').replaceChildren(); $('searchResults').hidden=!query;
    if(!query) { $('searchStatus').textContent=''; return; }
    $('searchStatus').textContent=result.length ? `${result.length} suggestions. Select one to view its chart.` : 'No quick-search match. Use the chart’s symbol search for all listings.';
    if(!result.length) { const empty=document.createElement('p'); empty.className='lookup-empty'; empty.textContent='No quick-search match. Try an exchange:ticker, or click the symbol at the top left of the chart to search all listings.'; $('searchResults').append(empty); }
    result.forEach((item,index)=>{
      const row=document.createElement('div'); row.className='lookup-result';
      const open=document.createElement('button'); open.type='button'; open.className='choose-symbol';
      const title=document.createElement('strong'); title.textContent=item.name;
      const info=document.createElement('small'); info.textContent=`${item.symbol} · ${item.description || item.type}`;
      open.append(title,info); open.addEventListener('click',()=>choose(item));
      const add=document.createElement('button'); add.className='pill save-symbol'; add.type='button';
      const saved=favourites.some(f=>f.symbol===item.symbol); add.textContent=saved ? 'Saved' : '☆ Save'; add.disabled=saved;
      add.setAttribute('aria-label',saved ? `${item.name} is saved` : `Save ${item.name} to favourites`);
      add.addEventListener('click',()=>{
        addFavourite(item); renderResults();
        $('searchResults').children[index]?.querySelector('.choose-symbol')?.focus();
      });
      row.append(open,add); $('searchResults').append(row);
    });
  }
  $('symbolSearch').addEventListener('input',renderResults);
  $('symbolSearch').addEventListener('keydown',event=>{ if(event.key==='Escape') dismissResults(); });
  for(const type of ['click','focusin']) document.addEventListener(type,event=>{
    if(!document.querySelector('.lookup-panel').contains(event.target)) dismissResults();
  });
  $('symbolForm').addEventListener('submit',event=>{
    event.preventDefault(); const result=search($('symbolSearch').value);
    if(result.length) choose(result[0]); else renderResults();
  });
  for(const id of ['baseCurrency','quoteCurrency']) currencies.forEach(([code,name])=>{
    const option=document.createElement('option'); option.value=code; option.textContent=`${code} · ${name}`; $(id).append(option);
  });
  $('baseCurrency').value='USD'; $('quoteCurrency').value='CAD';
  const validatePair=()=>{ $('viewPair').disabled=$('baseCurrency').value===$('quoteCurrency').value; $('viewPair').textContent=$('viewPair').disabled ? 'Choose different currencies' : 'Explore pair ↗'; };
  $('baseCurrency').addEventListener('change',validatePair); $('quoteCurrency').addEventListener('change',validatePair);
  $('pairForm').addEventListener('submit',event=>{
    event.preventDefault();
    const base=$('baseCurrency').value,quote=$('quoteCurrency').value;
    if(base===quote) return;
    choose({symbol:`FX_IDC:${base}${quote}`,name:`${base}/${quote}`});
  });
  $('editFavourites').addEventListener('click',()=>{
    editingFavourites=!editingFavourites;
    $('favouritesRow').classList.toggle('is-editing',editingFavourites);
    $('editFavourites').setAttribute('aria-pressed',String(editingFavourites));
    $('editFavourites').textContent=editingFavourites ? 'Done' : 'Edit';
    $('editFavourites').setAttribute('aria-label',editingFavourites ? 'Finish editing favourites' : 'Edit favourites');
  });
  $('reloadChart').addEventListener('click',renderChart);
  $('themeToggle').addEventListener('click',()=>{
    for(const id of ['chartWidget','marketWidget','currencyWidget','cadTickerWidget']) {
      disposers.get(id)?.(); $(id).replaceChildren();
    }
    loadedViews.clear(); renderActiveView();
  });
  $('financeViews').setAttribute('role','tablist');
  tabs.forEach((tab,index)=>{
    const view=tab.dataset.financeView;
    tab.setAttribute('role','tab'); tab.setAttribute('aria-controls',view);
    $(view).setAttribute('role','tabpanel'); $(view).setAttribute('aria-labelledby',tab.id); $(view).tabIndex=0;
    tab.addEventListener('click',event=>{
      if(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); showView(view);
    });
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight') next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft') next=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home') next=0;
      else if(event.key==='End') next=tabs.length-1;
      else if(event.key===' ') next=index;
      else return;
      event.preventDefault(); showView(tabs[next].dataset.financeView); tabs[next].focus();
    });
  });
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1),false));
  validatePair();
  const initialView=location.hash.slice(1);
  showView(views.includes(initialView) ? initialView : params.has('symbol') || params.has('tvwidgetsymbol') ? 'explore' : 'markets',false);
})();
