(() => {
  const input = document.getElementById('bookmarkSearch');
  const folders = [...document.querySelectorAll('.bookmark-folder')];
  const links = [...document.querySelectorAll('.bookmark')];
  const count = document.getElementById('bookmarkCount');
  const empty = document.getElementById('noBookmarks');
  const normalise = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const index = links.map(element => {
    const anchor = element.querySelector('a');
    const parents = [];
    for (let folder = element.closest('details'); folder; folder = folder.parentElement.closest('details')) {
      parents.push(folder.querySelector('.folder-title').textContent);
    }
    return { element, text: normalise(`${anchor.textContent} ${anchor.getAttribute('href')} ${parents.join(' ')}`) };
  });
  let savedOpen = null;
  function filter() {
    const terms = normalise(input.value).trim().split(/\s+/).filter(Boolean);
    if (terms.length && !savedOpen) savedOpen = folders.map(folder => folder.open);
    let matches = 0;
    for (const item of index) {
      item.element.hidden = !terms.every(term => item.text.includes(term));
      if (!item.element.hidden) matches++;
    }
    for (const [i, folder] of folders.entries()) {
      const visible = !terms.length || !!folder.querySelector('.bookmark:not([hidden])');
      folder.parentElement.hidden = !visible;
      if (terms.length) folder.open = visible;
      else if (savedOpen) folder.open = savedOpen[i];
    }
    if (!terms.length) savedOpen = null;
    count.textContent = terms.length ? `${matches} of ${links.length} bookmarks` : `${links.length} bookmarks`;
    empty.hidden = matches !== 0;
  }
  input.addEventListener('input', filter);
  document.getElementById('clearSearch').addEventListener('click', () => {
    input.value = '';
    filter();
    input.focus();
  });
  document.getElementById('expandFolders').addEventListener('click', () => folders.forEach(folder => { folder.open = true; }));
  document.getElementById('collapseFolders').addEventListener('click', () => folders.forEach(folder => { folder.open = false; }));
  document.querySelector('.bookmark-controls').hidden = false;
  document.querySelector('.folder-actions').hidden = false;
  filter();
})();
