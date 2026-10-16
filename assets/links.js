(() => {
  'use strict';
  const form = document.getElementById('toolsSearchForm');
  const input = document.getElementById('toolSearch');
  const clear = document.getElementById('clearToolSearch');
  const count = document.getElementById('toolCount');
  const empty = document.getElementById('toolsEmpty');
  const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-GB').replace(/\s+/g, ' ').trim();
  const cards = Array.from(document.querySelectorAll('#toolGrid .tool-card'), card => ({card, text:normalize(card.textContent)}));
  function filter() {
    const query = input.value.trim();
    const terms = normalize(query).split(' ').filter(Boolean);
    let visible = 0;
    for (const {card, text} of cards) {
      const matches = terms.every(term => text.includes(term));
      card.hidden = !matches;
      if (matches) visible++;
    }
    clear.hidden = !input.value;
    empty.hidden = visible > 0;
    count.textContent = query ? `${visible} ${visible === 1 ? 'result' : 'results'} for “${query}”` : `${cards.length} tools & links`;
  }
  function reset() { input.value = ''; filter(); input.focus(); }
  form.addEventListener('submit', event => { event.preventDefault(); filter(); });
  input.addEventListener('input', filter);
  input.addEventListener('keydown', event => { if (event.key === 'Escape' && input.value) { event.preventDefault(); reset(); } });
  clear.addEventListener('click', reset);
  document.getElementById('resetToolSearch').addEventListener('click', reset);
  filter();
  form.hidden = false;
})();
