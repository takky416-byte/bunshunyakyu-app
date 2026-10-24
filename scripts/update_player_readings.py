#!/usr/bin/env python3
"""Store official kana for selectable players, matched by ID, name and birthday."""
import argparse
import concurrent.futures
import datetime as dt
from html.parser import HTMLParser
import json
import re
from update_npb_data import ROOT
from update_eligibility_data import fetch_source, status_name
from update_player_career_data import parse_profile


class Names(HTMLParser):
    def __init__(self):
        super().__init__()
        self.field = None
        self.values = {}

    def handle_starttag(self, tag, attrs):
        field = dict(attrs).get('id')
        if tag == 'li' and field in ('pc_v_name', 'pc_v_kana'):
            if field in self.values:
                raise ValueError('Duplicated profile name')
            self.field = field
            self.values[field] = ''

    def handle_data(self, data):
        if self.field:
            self.values[self.field] += data

    def handle_endtag(self, tag):
        if tag == 'li':
            self.field = None


def parse_reading(html, player):
    parse_profile(html, player['birthDate'])  # Check the official birthday too.
    names = Names()
    names.feed(html)
    if status_name(re.split('[（(]', names.values.get('pc_v_name', ''))[0]) != status_name(player['name']):
        raise ValueError('Profile name does not match roster')
    reading = re.split('[（(]', names.values.get('pc_v_kana', ''))[0].strip().replace('・', ' ')
    if not re.fullmatch(r'[ぁ-ゖァ-ヺー 　]+', reading):
        raise ValueError('Missing or unexpected official kana')
    return reading


def build(refresh=False):
    day = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())['players']
    facts = json.loads((ROOT / 'src/eligibility2026.json').read_text())['players']
    selectable = [p for p in roster if p['eligible'] and not facts[p['id']]['exclusions'] and not facts[p['id']]['holds'] and facts[p['id']]['salaryManYen'] is not None and facts[p['id']]['salaryManYen'] < 10000]
    cache = ROOT / '.cache/player-career' / day
    cache.mkdir(parents=True, exist_ok=True)

    def fetch(p):
        _, meta, html = fetch_source(cache, p['id'] + '.html', f'https://npb.jp/bis/players/{p["id"][4:]}.html', day, refresh)
        return p['id'], {'name': p['name'], 'birthDate': p['birthDate'], 'reading': parse_reading(html, p), 'source': meta}

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = dict(pool.map(fetch, selectable))
    result = {'version': 1, 'season': 2026, 'asOf': day, 'players': records}
    path = ROOT / 'src/playerReadings2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'Official kana matched: {len(records)}; all selectable players covered')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    build(parser.parse_args().refresh)
