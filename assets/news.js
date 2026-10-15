/* News: browser-local RSS/Atom/JSON Feed reader. Feed HTML is rendered as text only. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'gregle-news-v1';
  const defaults = {feeds:[],articles:[],read:[],saved:[],updated:null};
  let state = {...defaults}, view = 'all', selected = '', limit = 40, refreshing = false, opened = null;
  let storageOK = true, notice = '', failures = new Map();
  const safeURL = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
  const feedURL = value => {
    const url = safeURL(value);
    if (!url) return '';
    const u = new URL(url);
    if (u.search || u.hash || u.hostname === 'localhost' || u.hostname.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(':')) return '';
    return u.href;
  };
  // Query strings are allowed for public feeds, except common credential parameters.
  const publicFeedURL = value => {
    const url = safeURL(value); if (!url) return '';
    const u = new URL(url); const clean = new URL(url); clean.search = ''; clean.hash = '';
    if (!feedURL(clean.href) || [...u.searchParams.keys()].some(k => /token|password|secret|auth|api.?key|credential/i.test(k))) return '';
    u.hash = ''; return u.href;
  };
  const xml = raw => {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('This XML contains unsupported document declarations.');
    const doc = new DOMParser().parseFromString(raw, 'text/xml');
    if (doc.querySelector('parsererror')) throw Error('This is not valid XML.');
    return doc;
  };
  function plain(value) {
    const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
    doc.querySelectorAll('script,style,iframe,object').forEach(n=>n.remove());
    doc.querySelectorAll('p,br,div,li,h1,h2,h3').forEach(n=>n.appendChild(doc.createTextNode('\n')));
    return (doc.body.textContent || '').replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim().slice(0,40000);
  }
  const text = (node,names) => { for(const name of names) { const n = [...node.children].find(c=>c.localName===name); if(n?.textContent) return n.textContent.trim(); } return ''; };
  const absolute = (value, base) => { try { return safeURL(new URL(value,base).href); } catch { return ''; } };
  function parseFeed(raw, url) {
    if (raw.trim().startsWith('{')) {
      const data = JSON.parse(raw);
      if(!Array.isArray(data.items)) throw Error('Not a JSON feed.');
      return {title:plain(data.title),items:data.items.map(i=>({title:plain(i.title),link:absolute(i.url||i.external_url||'',url),date:i.date_published||i.date_modified,body:plain(i.content_text||i.content_html||i.summary),author:plain(i.authors?.map(a=>a.name).join(', ')||i.author?.name)}))};
    }
    const doc=xml(raw), root=doc.documentElement;
    if(!['rss','feed','RDF'].includes(root.localName)) throw Error('No RSS or Atom feed found at this URL.');
    const channel=[...root.children].find(c=>c.localName==='channel')||root;
    const nodes=[...doc.getElementsByTagName('*')].filter(n=>['item','entry'].includes(n.localName));
    return {title:plain(text(channel,['title'])),items:nodes.slice(0,100).map(n=>{
      const links=[...n.children].filter(c=>c.localName==='link');
      const link=links.find(l=>l.getAttribute('href')&&(!l.getAttribute('rel')||l.getAttribute('rel')==='alternate'));
      const author=[...n.children].find(c=>c.localName==='author');
      return {title:plain(text(n,['title'])),link:absolute(link?.getAttribute('href')||text(n,['link']),url),date:text(n,['pubDate','published','updated','date']),body:plain(text(n,['encoded','content','description','summary'])),author:plain(author?text(author,['name'])||author.textContent:text(n,['creator']))};
    })};
  }
  function parseOPML(raw) {
    const doc=xml(raw); if(doc.documentElement.localName.toLowerCase()!=='opml') throw Error('Choose an OPML subscription file.');
    const feeds=[], seen=new Set(); let skipped=0;
    for(const node of doc.querySelectorAll('outline')) {
      const value=node.getAttribute('xmlUrl')||node.getAttribute('xmlurl'); if(!value) continue;
      const url=publicFeedURL(value); if(!url) { skipped++; continue; }
      if(seen.has(url)) continue; seen.add(url);
      const path=[]; let parent=node.parentElement;
      while(parent?.localName==='outline') { const name=parent.getAttribute('title')||parent.getAttribute('text'); if(name) path.unshift(name); parent=parent.parentElement; }
      feeds.push({url,name:(node.getAttribute('title')||node.getAttribute('text')||new URL(url).hostname).slice(0,160),folder:path.join(' / ').slice(0,320)});
    }
    return {feeds,skipped};
  }
  function normalizeArticle(i,feed) {
    const link=safeURL(i.link); if(!link) return null;
    const stamp=Date.parse(i.date);
    return {id:feed.url+'\n'+link,feed:feed.url,source:feed.name,title:String(i.title||'Untitled article').slice(0,500),link,date:Number.isFinite(stamp)?stamp:0,body:String(i.body||'').slice(0,40000),author:String(i.author||'').slice(0,200)};
  }
  function restore() {
    try {
      const data=JSON.parse(localStorage.getItem(KEY)||'null'); if(!data) return;
      state={feeds:Array.isArray(data.feeds)?data.feeds.filter(f=>publicFeedURL(f.url)).slice(0,500).map(f=>({url:publicFeedURL(f.url),name:String(f.name||new URL(f.url).hostname).slice(0,160),folder:String(f.folder||'').slice(0,320)})):[],articles:[],read:Array.isArray(data.read)?data.read.filter(s=>typeof s==='string'):[],saved:Array.isArray(data.saved)?data.saved.filter(s=>typeof s==='string'):[],updated:data.updated||null};
      state.articles=Array.isArray(data.articles)?data.articles.filter(a=>a&&typeof a.id==='string'&&safeURL(a.link)&&typeof a.title==='string'&&typeof a.body==='string'&&typeof a.feed==='string').slice(0,10000):[];
    } catch { storageOK=false; }
  }
  function persist() {
    // Keep bookmarks even when rolling the article cache forward.
    const ids=new Set(state.articles.map(a=>a.id));
    state.read=state.read.filter(id=>ids.has(id));state.saved=state.saved.filter(id=>ids.has(id));
    try { localStorage.setItem(KEY,JSON.stringify(state));storageOK=true; }
    catch {
      // Subscriptions and reading state take priority when the browser cache fills up.
      try { localStorage.setItem(KEY,JSON.stringify({...state,articles:state.articles.map(a=>({...a,body:a.body.slice(0,1500)}))}));storageOK=true; }
      catch { storageOK=false; }
    }
    $('storageWarning').hidden=storageOK;
    $('storageWarning').textContent=storageOK?'':'Browser storage is unavailable or full. Your current session still works, but changes may not be saved. Export OPML to keep your subscriptions.';
  }
  const element=(tag,className,content)=>{const n=document.createElement(tag);if(className)n.className=className;if(content!==undefined)n.textContent=content;return n;};
  const button=(label,className,fn)=>{const b=element('button',className,label);b.type='button';b.addEventListener('click',fn);return b;};
  const articleDate=a=>a.date?new Date(a.date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Date unavailable';
  function filtered() {
    const read=new Set(state.read),saved=new Set(state.saved),q=$('search').value.toLocaleLowerCase();
    return state.articles.filter(a=>(view!=='unread'||!read.has(a.id))&&(view!=='saved'||saved.has(a.id))&&(view!=='feed'||a.feed===selected)&&(view!=='folder'||state.feeds.some(f=>f.url===a.feed&&f.folder===selected))&&(!q||(a.title+' '+a.body+' '+a.source).toLocaleLowerCase().includes(q))).sort((a,b)=>$('sort').value==='oldest'?a.date-b.date:b.date-a.date);
  }
  function nav(label,count,active,fn,title) {
    const b=button('', 'nav-item feed-link'+(active?' active':''),fn);b.append(element('span','',label),element('span','',String(count)));if(title)b.title=title;b.setAttribute('aria-current',active?'true':'false');return b;
  }
  function setView(next,value='') {view=next;selected=value;limit=40;if(!refreshing)notice=next==='feed'?(failures.get(value)||''):'';render();}
  function renderSidebar() {
    const unread=new Set(state.articles.filter(a=>!state.read.includes(a.id)).map(a=>a.id));
    $('allCount').textContent=state.articles.length;$('unreadCount').textContent=unread.size;$('savedCount').textContent=state.saved.length;
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'true':'false');});
    const container=$('feeds');container.replaceChildren();
    const folders=[...new Set(state.feeds.map(f=>f.folder))].sort();
    for(const folder of folders) {
      if(folder) container.append(button(folder,'folder-title'+(view==='folder'&&selected===folder?' active':''),()=>setView('folder',folder)));
      for(const f of state.feeds.filter(f=>f.folder===folder)) {
        const count=state.articles.filter(a=>a.feed===f.url&&unread.has(a.id)).length;
        container.append(nav((failures.has(f.url)?'⚠ ':'')+f.name,count,view==='feed'&&selected===f.url,()=>setView('feed',f.url),failures.get(f.url)||f.url));
      }
    }
    if(!state.feeds.length) container.append(element('p','muted','Your favourite publications belong here.'));
    $('folderOptions').replaceChildren(...folders.filter(Boolean).map(f=>{const o=element('option');o.value=f;return o;}));
  }
  function render() {
    renderSidebar();
    $('listTitle').textContent=view==='feed'?(state.feeds.find(f=>f.url===selected)?.name||'Feed'):view==='folder'?selected:({all:'All articles',unread:'Unread',saved:'Saved for later'}[view]);
    const items=filtered(), container=$('articles');container.replaceChildren();
    $('markAll').disabled=!items.some(a=>!state.read.includes(a.id));
    if(!items.length) {
      const empty=element('div','empty-state');empty.append(element('div','empty-symbol','◔'));
      const title=!state.feeds.length?'Make room for what matters.':$('search').value?'No matching articles':refreshing?'Gathering your stories…':view==='saved'?'A place for the good reads.':view==='unread'?'You’re all caught up.':'No articles yet';
      empty.append(element('h3','',title),element('p','',!state.feeds.length?'Bring your subscriptions from another reader, or add your first feed.':view==='saved'?'Tap the star beside any story to keep it here.':$('search').value?'Try another search, or choose All articles.':view==='unread'?'Fresh stories will appear here when your feeds update.':'Refresh your feeds to check for stories.'));
      if(!state.feeds.length){empty.append(button('Import OPML','pill primary',()=>$('opmlFile').click()),button('Start with BBC News','pill',()=>addFeeds([{url:'https://feeds.bbci.co.uk/news/rss.xml',name:'BBC News',folder:''}])));}
      container.append(empty);
    }
    for(const a of items.slice(0,limit)) {
      const row=element('article','article-row'+(state.read.includes(a.id)?' read':'')), main=element('div','article-main'),meta=element('div','article-meta');
      meta.append(element('span','source-dot'),element('span','',a.source),element('span','','·'),element('time','',articleDate(a)));
      main.append(meta,button(a.title,'article-title',()=>openArticle(a)),element('p','article-excerpt',a.body||'Open the original article to read this story.'));
      const actions=element('div','article-actions'),link=element('a','','Read original ↗');link.href=a.link;link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',()=>markRead(a.id,true));
      actions.append(button(state.read.includes(a.id)?'Mark unread':'Mark read','',()=>markRead(a.id,!state.read.includes(a.id))),link);main.append(actions);
      const saved=state.saved.includes(a.id),save=button(saved?'★':'☆','save-button'+(saved?' saved':''),()=>toggleSave(a.id));save.setAttribute('aria-label',(saved?'Unsave ':'Save ')+a.title);save.setAttribute('aria-pressed',String(saved));row.append(main,save);container.append(row);
    }
    $('moreButton').hidden=items.length<=limit;
    $('refreshButton').disabled=refreshing||!state.feeds.length;$('refreshButton').textContent=refreshing?'↻ Updating…':'↻ Refresh';
    const updated=state.updated?'Updated '+new Date(state.updated).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Add feeds to get started';
    $('status').textContent=refreshing?notice:(notice||`${items.length} ${items.length===1?'article':'articles'} · ${updated}${failures.size?' · '+failures.size+' feed(s) unavailable; cached stories kept':''}`);
    $('exportButton').disabled=!state.feeds.length;
  }
  function markRead(id,read) {state.read=state.read.filter(x=>x!==id);if(read)state.read.push(id);persist();render();}
  function toggleSave(id) {state.saved=state.saved.includes(id)?state.saved.filter(x=>x!==id):[...state.saved,id];persist();render();if(opened?.id===id)$('articleSave').textContent=state.saved.includes(id)?'★ Saved':'☆ Save for later';}
  function openArticle(a) {
    opened=a;markRead(a.id,true);$('articleSource').textContent=a.source;$('articleTitle').textContent=a.title;$('articleDate').textContent=articleDate(a)+(a.author?' · '+a.author:'');$('articleBody').textContent=a.body||'This feed provides a headline only. Visit the original article to read more.';$('originalLink').href=a.link;$('articleSave').textContent=state.saved.includes(a.id)?'★ Saved':'☆ Save for later';$('articleDialog').showModal();
  }
  async function request(url,json=false) {
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
    try {const res=await fetch(url,{signal:c.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!res.ok)throw Error('HTTP '+res.status);const raw=await res.text();if(raw.length>5000000)throw Error('Feed is too large.');return json?JSON.parse(raw):raw;}finally{clearTimeout(timer);}
  }
  async function loadFeed(f) {
    try{return parseFeed(await request(f.url),f.url);}catch{}
    try{
      const d=await request('https://api.rss2json.com/v1/api.json?rss_url='+encodeURIComponent(f.url),true);
      if(d.status!=='ok'||!Array.isArray(d.items))throw Error('Feed unavailable.');
      return {title:plain(d.feed?.title),items:d.items.map(i=>({title:plain(i.title),link:i.link,date:i.pubDate?i.pubDate.replace(' ','T')+'Z':'',body:plain(i.content||i.description),author:plain(i.author)}))};
    }catch{}
    try{return parseFeed(await request('https://api.allorigins.win/raw?url='+encodeURIComponent(f.url)),f.url);}catch{throw Error('Could not retrieve this feed. Check its URL or try Refresh later.');}
  }
  async function refresh(only) {
    if(refreshing)return;const jobs=only||[...state.feeds];if(!jobs.length)return;
    refreshing=true;notice='Checking your feeds…';let index=0,done=0,success=0;render();
    await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
      while(index<jobs.length){const f=jobs[index++];try{
        const data=await loadFeed(f);
        if(state.feeds.some(x=>x.url===f.url)){
          if(f.name===new URL(f.url).hostname&&data.title)f.name=data.title.slice(0,160);
          const fresh=data.items.slice(0,100).map(i=>normalizeArticle(i,f)).filter(Boolean);
          const byId=new Map(state.articles.map(a=>[a.id,a]));fresh.forEach(a=>byId.set(a.id,a));
          const saved=new Set(state.saved),perFeed=new Map();
          let kept=0;
          state.articles=[...byId.values()].sort((a,b)=>b.date-a.date).filter(a=>{const n=(perFeed.get(a.feed)||0)+1;perFeed.set(a.feed,n);if(saved.has(a.id))return true;if(n>100||kept>=2000)return false;kept++;return true;});
          failures.delete(f.url);success++;persist();
        }
      }catch(e){if(state.feeds.some(x=>x.url===f.url))failures.set(f.url,e.message);}
      done++;notice=`Updating feeds · ${done} of ${jobs.length}`;render();}
    }));
    if(success)state.updated=Date.now();refreshing=false;notice=success?`Updated ${success} of ${jobs.length} feeds${failures.size?' · Some feeds are unavailable; cached stories kept':''}`:'Feeds could not be reached. Check the feed URLs or try Refresh later. Cached articles are still available.';persist();render();
  }
  function addFeeds(incoming) {
    const known=new Set(state.feeds.map(f=>f.url)),added=[];let duplicates=0;
    for(const f of incoming){if(known.has(f.url)){duplicates++;continue;}if(state.feeds.length>=500)break;known.add(f.url);state.feeds.push(f);added.push(f);}
    notice=`Added ${added.length} ${added.length===1?'feed':'feeds'}${duplicates?' · '+duplicates+' already subscribed':''}${state.feeds.length>=500?' · Maximum 500 feeds reached':''}`;persist();render();
    if(added.length){if(refreshing)notice+=' · Refresh again to load the new feeds';else refresh(added);}return added.length;
  }
  async function importFile(file) {
    if(!file)return;
    try {if(file.size>5000000)throw Error('Please choose an OPML file smaller than 5 MB.');const result=parseOPML(await file.text());if(!result.feeds.length)throw Error('No public feed URLs found in this OPML file.');const count=addFeeds(result.feeds);notice=`Imported ${count} feeds${result.skipped?' · '+result.skipped+' unsupported or private URLs skipped':''}${refreshing?' · Loading articles…':''}`;render();}
    catch(e){notice=e.message;render();}finally{$('opmlFile').value='';}
  }
  function exportOPML() {
    const doc=document.implementation.createDocument('','opml');doc.documentElement.setAttribute('version','2.0');
    const head=doc.createElement('head'),title=doc.createElement('title');title.textContent='News subscriptions';head.append(title);doc.documentElement.append(head);const body=doc.createElement('body');doc.documentElement.append(body);
    const folders=new Map([['',body]]);
    for(const f of state.feeds){let parent=body,path='';for(const part of f.folder.split(' / ').filter(Boolean)){path=path?path+' / '+part:part;if(!folders.has(path)){const node=doc.createElement('outline');node.setAttribute('text',part);node.setAttribute('title',part);parent.append(node);folders.set(path,node);}parent=folders.get(path);}const node=doc.createElement('outline');for(const [k,v]of Object.entries({type:'rss',text:f.name,title:f.name,xmlUrl:f.url}))node.setAttribute(k,v);parent.append(node);}
    const url=URL.createObjectURL(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n',new XMLSerializer().serializeToString(doc)],{type:'text/xml'})),a=element('a');a.href=url;a.download='news-subscriptions.opml';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function manage() {
    $('manageList').replaceChildren();
    if(!state.feeds.length)$('manageList').append(element('p','muted','No feeds yet. Add a feed or import an OPML file.'));
    for(const f of state.feeds){const row=element('div','manage-row'),info=element('div');info.append(element('strong','',f.name),element('small','',f.folder||'Unfiled'),element('small','',f.url));const remove=button('Remove','',()=>{state.feeds=state.feeds.filter(x=>x.url!==f.url);state.articles=state.articles.filter(a=>a.feed!==f.url||state.saved.includes(a.id));failures.delete(f.url);if(selected===f.url)setView('all');persist();render();manage();});remove.setAttribute('aria-label','Remove '+f.name);row.append(info,remove);$('manageList').append(row);}
    $('manageExport').disabled=!state.feeds.length;
    if(!$('manageDialog').open)$('manageDialog').showModal();
  }
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',() => $(b.dataset.close).close()));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('today').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  $('addButton').addEventListener('click',()=>{$('feedForm').reset();$('addError').textContent='';$('feedDialog').showModal();});
  $('feedForm').addEventListener('submit',e=>{e.preventDefault();const url=publicFeedURL($('feedUrl').value.trim());if(!url){$('addError').textContent='Use a public HTTP or HTTPS feed URL without credentials or access tokens.';return;}if(state.feeds.some(f=>f.url===url)){$('addError').textContent='You already subscribe to this feed.';return;}if(state.feeds.length>=500){$('addError').textContent='The maximum is 500 feeds. Remove a feed first.';return;}addFeeds([{url,name:$('feedName').value.trim()||new URL(url).hostname,folder:$('feedFolder').value.trim()}]);$('feedDialog').close();});
  $('importButton').addEventListener('click',()=>$('opmlFile').click());$('manageImport').addEventListener('click',()=>{$('manageDialog').close();$('opmlFile').click();});$('opmlFile').addEventListener('change',e=>importFile(e.target.files[0]));
  $('exportButton').addEventListener('click',exportOPML);$('manageExport').addEventListener('click',exportOPML);$('manageButton').addEventListener('click',manage);$('refreshButton').addEventListener('click',()=>refresh());
  $('search').addEventListener('input',()=>{limit=40;render();});$('sort').addEventListener('change',()=>{limit=40;render();});$('moreButton').addEventListener('click',()=>{limit+=40;render();});
  $('markAll').addEventListener('click',()=>{state.read=[...new Set([...state.read,...filtered().map(a=>a.id)])];persist();render();});$('articleSave').addEventListener('click',()=>{if(opened)toggleSave(opened.id);});
  restore();render();persist();if(state.feeds.length)refresh();
  setInterval(()=>{if(!document.hidden&&state.feeds.length)refresh();},15*60*1000);
  window.addEventListener('storage',e=>{if(e.key===KEY){restore();notice='Reader updated from another tab';render();}});
})();
