#!/usr/bin/env python3
"""Join NPB draft years to current player IDs for display-only career length."""
import argparse
import concurrent.futures
import datetime as dt
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from update_npb_data import ROOT, rows
from update_eligibility_data import fetch_source


def parse_profile(html, expected_birth_date):
    table = [r['cells'] for r in rows(html)]
    birthdays = [c[1] for c in table if len(c) == 2 and c[0] == '生年月日']
    if len(birthdays) != 1:
        raise ValueError('Player profile birthday is missing or duplicated')
    match = re.fullmatch(r'(\d{4})年(\d{1,2})月(\d{1,2})日', birthdays[0])
    if not match or dt.date(*map(int, match.groups())).isoformat() != expected_birth_date:
        raise ValueError('Profile does not match the roster birthday')
    draft = [c[1] for c in table if len(c) == 2 and c[0] == 'ドラフト']
    if not draft or draft == ['']:
        return None
    if len(draft) != 1:
        raise ValueError('Duplicate draft field')
    match = re.fullmatch(r'(\d{4})年(?:育成選手|高校生|大学生?・社会人)?ドラフト(?:\d+(?:位|巡目)|外|希望枠|自由獲得枠|自由枠|逆指名)', draft[0])
    if not match:
        raise ValueError(f'Unrecognized NPB draft field: {draft[0]}')
    year = int(match[1])
    if not 1965 <= year <= 2025:
        raise ValueError('Draft year outside the 2026 simulation range')
    return year


def build(refresh=False):
    day = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())['players']
    recent = json.loads((ROOT / 'src/cpuDraft2026.json').read_text())
    cache = ROOT / '.cache/player-career' / day
    cache.mkdir(parents=True, exist_ok=True)
    def fetch(p):
        if p['id'] in recent['players']:
            draft = recent['players'][p['id']]
            if draft['name'] != p['name']:
                raise ValueError('Recent draft ID/name mismatch')
            return p['id'], {'name': p['name'], 'birthDate': p['birthDate'], 'firstNpbSeason': draft['year'] + 1, 'source': draft['source']}, None
        name = f'{p["id"]}.html'
        for attempt in range(3):
            try:
                _, meta, html = fetch_source(cache, name, f'https://npb.jp/bis/players/{p["id"][4:]}.html', day, refresh)
                break
            except HTTPError as error:
                if error.code not in (429, 502, 503, 504) or attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        draft_year = parse_profile(html, p['birthDate'])
        return p['id'], {'name': p['name'], 'birthDate': p['birthDate'], 'firstNpbSeason': draft_year + 1 if draft_year is not None else None, 'source': meta['url']}, meta
    players = {}; sources = list(recent['sources'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for i, (player_id, facts, meta) in enumerate(pool.map(fetch, roster), 1):
            players[player_id] = facts
            if meta: sources.append(meta)
            if i % 100 == 0: print(f'Career records checked: {i}/{len(roster)}', flush=True)
    # Every selectable official player must have a verified entry year.
    eligibility = json.loads((ROOT / 'src/eligibility2026.json').read_text())['players']
    for p in roster:
        f = eligibility[p['id']]
        if p['eligible'] and not f['exclusions'] and not f['holds'] and f['salaryManYen'] is not None and f['salaryManYen'] < 10000 and players[p['id']]['firstNpbSeason'] is None:
            raise ValueError(f'Selectable player needs an entry-year source: {p["name"]}')
    output = {'version': 1, 'season': 2026, 'asOf': day, 'sources': sources, 'players': players}
    path = ROOT / 'src/playerCareer2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    known = sum(p['firstNpbSeason'] is not None for p in players.values())
    print(f'Career years matched: {known}/{len(players)}; all selectable players covered', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    build(parser.parse_args().refresh)
