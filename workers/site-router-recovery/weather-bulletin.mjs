// GeoMet may not have the city warning yet. Read its matching public ECCC report.
export async function weatherBulletin(request) {
  const headers = {'Cache-Control':'no-store', 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff'};
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
  if (request.method !== 'GET') return new Response(null, {status:405, headers:{Allow:'GET'}});
  const params = new URL(request.url).searchParams;
  const region = params.get('region'), id = params.get('id');
  if (params.size !== 2 || !/^[a-z]{2}[a-z0-9]{1,12}$/i.test(region || '') || !/^\d{1,40}$/.test(id || '')) {
    return json({error:'Invalid bulletin reference'}, 400);
  }

  try {
    const source = new URL('https://weather.gc.ca/warnings/report_e.html');
    source.searchParams.set(region.toLowerCase(), '');
    const report = await fetch(source, {
      headers:{Accept:'text/html'}, redirect:'manual', signal:AbortSignal.timeout(6000),
    });
    if (!report.ok || !/^text\/html\b/i.test(report.headers.get('Content-Type') || '')) {
      await report.body?.cancel();
      return json({error:'Environment Canada report unavailable'}, 502);
    }
    const bulletin = `div[id="${id}"]`;
    const paragraphs = [];
    let issued, paragraph = '';
    // HTMLRewriter preserves character references in text chunks. The page decodes
    // them before inserting the bulletin as plain text.
    const rewritten = new HTMLRewriter()
      .on(bulletin + ' > p > time[datetime]', {element(element) {
        issued = element.getAttribute('datetime');
      }})
      .on(bulletin + ' > p.pre-wrap', {element(element) {
        paragraph = '';
        element.onEndTag(() => { if (paragraph.trim()) paragraphs.push(paragraph.trim()); });
      }, text(chunk) { paragraph += chunk.text; }})
      .transform(report);
    await rewritten.body.pipeTo(new WritableStream());
    const text = paragraphs.join('\n\n');
    if (!Number.isFinite(Date.parse(issued)) || !text || text.length > 30000) {
      return json({error:'Matching bulletin unavailable'}, 404);
    }
    return json({issued, text});
  } catch {
    return json({error:'Environment Canada report unavailable'}, 502);
  }
}
