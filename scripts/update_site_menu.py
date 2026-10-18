#!/usr/bin/env python3
"""Regenerate the shared, JavaScript-independent Gregle app launcher."""
from pathlib import Path
import argparse
import re

ROOT = Path(__file__).resolve().parents[1]
APPS = [
    ('Gregle', '/', 'favicons/favicon.svg'),
    ('Translate', '/translate.html', 'assets/translate-app/icon-192.png'),
    ('Weather', '/weather.html', 'assets/weather-app/icon-192.png'),
    ('Earthquakes', '/earthquakes.html', 'assets/earthquakes-app/icon-192.png'),
    ('Astronomy', '/astro.html', 'assets/astro-app/icon-192.png'),
    ('Sports', '/sports.html', 'assets/sports-app/icon-192.png'),
    ('News', '/news.html', 'assets/news-app/icon-192.png'),
    ('Finance', '/finance.html', 'assets/finance-app/icon-192.png'),
    ('More', '/links.html', 'assets/tools-app.svg'),
    ('Radio', '/radio.html', 'assets/radio-app/icon-192.png'),
    ('Dictionary', '/dictionary.html', 'assets/dictionary-app/icon-192.png'),
    ('Maps', '/maps.html', 'assets/maps-app/icon.svg'),
]
EXTRAS = [
    ('Portal', 'https://portal.gregle.de'), ('Notes', 'https://42.gsuth.uk'),
    ('Apple Maps', 'https://maps.apple.com'), ('Dictionary', '/dictionary.html'),
    ('Music', 'https://music.apple.com'),
    ('Radio', 'https://gregle.uk/radio.html'), ('SpaceWeather', 'https://spaceweather.com'),
    ('Hacker News', 'https://news.ycombinator.com'), ('xkcd', 'https://xkcd.com'),
    ('Contact', 'https://gsuth.uk'),
]
MAP_EXTRAS = [
    ('OpenStreetMap', 'https://www.openstreetmap.org/'),
    ('Google Maps', 'https://www.google.com/maps'),
    ('Apple Maps', 'https://maps.apple.com'),
    ('ADS-B Exchange', 'https://globe.adsbexchange.com/'),
    ('MarineTraffic', 'https://www.marinetraffic.com/'),
    ('TomTom Planner', 'https://plan.tomtom.com/en/'),
]
PATTERN = r'<!-- Gregle app menu -->.*?<!-- /Gregle app menu -->'

def menu(page):
    circles = ''.join(f'<circle cx="{x}" cy="{y}" r="1.8"/>' for y in (5, 12, 19) for x in (5, 12, 19))
    links = []
    for label, href, icon in APPS:
        current = ' aria-current="page"' if href == ('/' if page == 'index.html' else '/' + page) else ''
        links.append(f'<a class="gregle-app" href="{href}"{current}><img src="/{icon}" width="44" height="44" alt="" loading="lazy" decoding="async"><span>{label}</span></a>')
    extras = ''
    extra_links = EXTRAS if page == 'index.html' else MAP_EXTRAS if page == 'maps.html' else []
    if extra_links:
        extras = '<section class="gregle-menu-more" aria-label="More links"><h3>More links</h3><div>' + ''.join(f'<a href="{href}" rel="noreferrer">{label}</a>' for label, href in extra_links) + '</div></section>'
    return '\n'.join([
        '<!-- Gregle app menu -->',
        '<details class="gregle-app-menu" id="gregleAppMenu" data-gregle-menu>',
        f'<summary class="gregle-menu-toggle" aria-label="Gregle apps" aria-controls="gregleMenuPanel" aria-expanded="false" title="Gregle apps"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">{circles}</svg></summary>',
        '<nav class="gregle-menu-panel" id="gregleMenuPanel" aria-label="Gregle apps"><div class="gregle-menu-heading"><h2>Gregle apps</h2><button class="gregle-theme-switch" id="themeToggle" type="button" role="switch" aria-label="Dark mode" aria-checked="false" title="Dark mode"></button></div>',
        '<p class="gregle-menu-sr-only" id="gregleAppHelp">Drag apps to rearrange them. On a touch screen, hold an app before dragging. With an app focused, use Alt and the arrow keys to move it.</p>',
        '<div class="gregle-app-grid" aria-describedby="gregleAppHelp">' + '\n'.join(links) + '</div>',
        '<div class="gregle-menu-sr-only" role="status" aria-live="polite" data-gregle-app-status></div>',
        extras + '</nav></details>',
        '<!-- /Gregle app menu -->',
    ])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    outdated = []
    for path in sorted(ROOT.glob('*.html')):
        if path.name == 'environment-canada.html':
            continue  # This URL immediately redirects to weather.html.
        source = path.read_text()
        if not re.search(PATTERN, source, re.S):
            outdated.append(path.name)
            continue
        updated = re.sub(PATTERN, lambda _: menu(path.name), source, flags=re.S)
        if updated != source:
            outdated.append(path.name)
            if not args.check:
                path.write_text(updated)
    if args.check and outdated:
        raise SystemExit('Menus need regeneration: ' + ', '.join(outdated))

if __name__ == '__main__':
    main()
