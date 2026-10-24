#!/usr/bin/env python3
"""Fetch official 2026 NPB roster and regular-season statistics.

No third-party Python packages. TLS and the environment's HTTPS proxy remain
enabled. Only factual data is extracted; original HTML is cached, not published.
Registration is not equivalent to eligibility for the active-player draft.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TEAMS = ['t', 'g', 'db', 'c', 's', 'd', 'h', 'f', 'm', 'e', 'b', 'l']
POSITIONS = ['投手', '捕手', '内野手', '外野手']


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'tr':
            self.row = {'cells': [], 'attrs': attrs, 'links': []}
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = ''
        elif tag == 'a' and self.row is not None and re.search(r'/players/\d+\.html$', attrs.get('href', '')):
            self.row['links'].append(attrs['href'])

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.row is not None and self.cell is not None:
            self.row['cells'].append(' '.join(self.cell.split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def rows(html):
    parser = TableRows()
    parser.feed(html)
    return parser.rows


def normal_name(name):
    return re.sub(r'\s', '', name).lstrip('*+')


def parse_roster(html, team, source):
    if not re.search(r'2026年度\s*選手一覧', html):
        raise ValueError(f'{team}: page is not a 2026 roster; refusing a wrong-season snapshot')
    position = None
    players = []
    for row in rows(html):
        cells = row['cells']
        if row['attrs'].get('class') == 'rosterMainHead':
            position = cells[1] if len(cells) > 1 and cells[1] in POSITIONS else None
        elif row['attrs'].get('class') == 'rosterPlayer' and row['links'] and position:
            if len(cells) != 8 or not re.fullmatch(r'\d{4}\.\d{2}\.\d{2}', cells[2]):
                raise ValueError(f'{team}: roster layout changed')
            player_id = re.search(r'/(\d+)\.html$', row['links'][0]).group(1)
            development = len(cells[0]) >= 3
            players.append({
                'id': f'npb-{player_id}', 'team': team, 'name': cells[1],
                'position': position, 'eligible': not development,
                'eligibility': 'ineligible-development' if development else 'unverified',
                'number': cells[0], 'birthDate': cells[2].replace('.', '-'),
                'throws': cells[5], 'bats': cells[6],
                'registration': '育成' if development else '支配下',
                'note': cells[7], 'sourceUrl': source,
            })
    if not 40 <= len(players) <= 150:
        raise ValueError(f'{team}: unexpected roster size {len(players)}')
    return players


def parse_stats(html, pitching=False):
    if not re.search(r'<title>[^<]*2026年度[^<]*個人(?:投手|打撃)成績', html):
        raise ValueError('Statistics are not labeled 2026')
    result = {}
    table = rows(html)
    games_header = '登板' if pitching else '試合'
    header = next((r['cells'] for r in table if r['cells'] and r['cells'][0] == '選手' and games_header in r['cells']), None)
    if not header:
        raise ValueError('Statistics header not found')
    for row in table:
        c = row['cells']
        if len(c) != len(header) or not c or c == header:
            continue
        values = dict(zip(header, c))
        if not re.fullmatch(r'\d+', values.get(games_header, '')):
            continue
        def number(key):
            val = values.get(key, '')
            return None if val in ('', '-', '.---', '----') else float(val) if '.' in val else int(val)
        if pitching:
            stats = {'games': number('登板'), 'era': number('防御率'), 'wins': number('勝利'), 'losses': number('敗北'), 'saves': number('セーブ'), 'innings': values.get('投球回', '')}
        else:
            slugging, on_base = number('長打率'), number('出塁率')
            ops = None if slugging is None or on_base is None else round(slugging + on_base, 3)
            stats = {'games': number('試合'), 'plateAppearances': number('打席'), 'average': number('打率'), 'homeRuns': number('本塁打'), 'rbi': number('打点'), 'ops': ops}
        result[normal_name(c[0])] = stats
    if not result:
        raise ValueError('No statistic rows parsed')
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--refresh', action='store_true', help='refresh the raw HTML cache from official sources')
    ap.add_argument('--output', type=Path, default=ROOT / 'src' / 'npb2026.json')
    args = ap.parse_args()
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
    cache = ROOT / '.cache' / 'npb' / today
    cache.mkdir(parents=True, exist_ok=True)
    urls = [f'https://npb.jp/bis/teams/rst_{t}.html' for t in TEAMS]
    urls += [f'https://npb.jp/bis/2026/stats/{kind}_{t}.html' for t in TEAMS for kind in ['idb1', 'idp1']]
    def fetch(url):
        path = cache / (url.rsplit('/', 1)[-1])
        if path.exists() and not args.refresh:
            data = path.read_bytes()
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'GenekiDraftRoom/0.1 (personal development; official factual roster and statistics)'})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            path.write_bytes(data)
        return url, data.decode('utf-8'), hashlib.sha256(data).hexdigest()
    # Limit parallelism to avoid burdening the source website.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pages = {url: (html, checksum) for url, html, checksum in pool.map(fetch, urls)}
    players = []
    sources = []
    for team in TEAMS:
        roster_url = f'https://npb.jp/bis/teams/rst_{team}.html'
        roster = parse_roster(pages[roster_url][0], team, roster_url)
        batting_url = f'https://npb.jp/bis/2026/stats/idb1_{team}.html'
        pitching_url = f'https://npb.jp/bis/2026/stats/idp1_{team}.html'
        batting = parse_stats(pages[batting_url][0])
        pitching = parse_stats(pages[pitching_url][0], pitching=True)
        for p in roster:
            stats = pitching if p['position'] == '投手' else batting
            p['stats'] = stats.get(normal_name(p['name']))
            p['statsSourceUrl'] = pitching_url if p['position'] == '投手' else batting_url
        players.extend(roster)
        print(f'{team}: {len(roster)} players, {sum(p["stats"] is not None for p in roster)} with first-team statistics')
    ids = [p['id'] for p in players]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate player IDs between rosters; resolve membership from official notices before updating')
    for url, (_, checksum) in pages.items():
        sources.append({'url': url, 'sha256': checksum, 'retrievedAt': today})
    dataset = {
        'version': 1, 'season': 2026, 'label': 'NPB公式・2026年度選手名簿／一軍成績',
        'kind': 'official-roster', 'sourceUrl': 'https://npb.jp/bis/teams/', 'asOf': today,
        'eligibilityNotice': '登録区分のみ反映。外国人・FA・年俸・複数年契約等の現役ドラフト対象条件は未照合。eligibleはシミュレーションで選択可能かを示し、参加資格の確認済みを意味しません。',
        'sources': sources, 'players': players,
    }
    # Only replace the snapshot after every required source and record validates.
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(output)
    print(f'Saved {len(players)} players to {output}')


if __name__ == '__main__':
    main()
