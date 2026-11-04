const {test} = require('node:test');
const assert = require('node:assert/strict');
const {usable, FEED} = require('../assets/astro-news.js');
const now = Date.UTC(2026, 10, 3, 13);
const story = {title: 'The Moon & Mars', link: 'https://www.universetoday.com/articles/moon-and-mars'};
const snapshot = items => ({feedUpdatedAt: new Date(now).toISOString(), items});

test('only unique HTTPS Universe Today articles reach the ticker', () => {
  assert.deepEqual(usable(snapshot([
    story, story, {title: '', link: story.link},
    {title: 'Other', link: 'https://universetoday.com.evil.example/story'},
    {title: 'Credentials', link: 'https://user:pass@universetoday.com/story'},
    {title: 'HTTP', link: 'http://universetoday.com/story'},
    {title: 'Script', link: 'javascript:alert(1)'}
  ]), now), [story]);
});

test('expired, future and invalid snapshots are rejected', () => {
  for (const feedUpdatedAt of ['invalid', new Date(now - 7 * 24 * 60 * 60 * 1000 - 1).toISOString(), new Date(now + 300001).toISOString()]) {
    assert.deepEqual(usable({feedUpdatedAt, items: [story]}, now), []);
  }
  assert.deepEqual(usable(null, now), []);
  assert.equal(usable(snapshot([story]), now).length, 1);
});

test('ticker caps its feed at ten headlines', () => {
  const items = Array.from({length: 15}, (_, i) => ({title: `Story ${i}`, link: `https://universetoday.com/articles/${i}`}));
  assert.equal(usable(snapshot(items), now).length, 10);
  assert.equal(FEED, 'https://www.universetoday.com/feed');
});

test('recent astronomy headlines survive delayed scheduled refreshes', () => {
  const feedUpdatedAt = new Date(now - 12 * 60 * 60 * 1000).toISOString();
  assert.deepEqual(usable({feedUpdatedAt, items: [story]}, now), [story]);
});
