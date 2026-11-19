// Stream the existing tide tracker inside Weather's same-origin PWA scope.
export function weatherTidesView(response,search='',Rewriter=globalThis.HTMLRewriter) {
  return new Rewriter()
    .on('meta[charset]',{element(el){el.after('<base href="/">',{html:true});}})
    .on('body',{element(el){el.setAttribute('data-weather-app-tides','');}})
    .on('link[rel="manifest"]',{element(el){el.setAttribute('href','/weather.webmanifest?v=20261119-tides1');}})
    .on('link[rel="apple-touch-icon"]',{element(el){el.setAttribute('href','/assets/weather-app/apple-touch-icon.png?v=20261002-radio');}})
    .on('meta[name="application-name"]',{element(el){el.setAttribute('content','Gregle Weather');}})
    .on('meta[name="apple-mobile-web-app-title"]',{element(el){el.setAttribute('content','Weather');}})
    .on('#weatherLink',{element(el){
      el.setAttribute('href','/'+search);
      el.setAttribute('class','pill weather-app-back');
      el.setAttribute('aria-label','Back to Weather');el.setAttribute('title','Back to Weather');
      el.setInnerContent('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span><span class="weather-back-prefix">Back to </span>Weather</span>',{html:true});
    }})
    .transform(response);
}
