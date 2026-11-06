#!/usr/bin/env python3
"""Record 2024–2026 first-team usage for CPU judgement, not legal eligibility."""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
from update_npb_data import ROOT, rows
from update_eligibility_data import fetch_source, status_name
from update_player_career_data import parse_profile
from update_player_readings import Names

SEASONS = (2024, 2025)


def parse_usage(html, player):
    draft_year = parse_profile(html, player['birthDate'])
    names = Names()
    names.feed(html)
    if status_name(re.split('[（(]', names.values.get('pc_v_name', ''))[0]) != status_name(player['name']):
        raise ValueError('Profile name does not match roster')

    # Profile pitching cells contain nested tables for whole/fractional innings.
    # Flatten those before TableRows, which intentionally reads flat tables.
    def inning(match):
        cells = rows(match[0])
        if len(cells) != 1 or len(cells[0]['cells']) != 2:
            raise ValueError('Unexpected nested innings table')
        value = ''.join(cells[0]['cells'])
        if value == '+':
            return '0'
        if value and not re.fullmatch(r'\d+(?:\.[12])?\+?', value):
            raise ValueError('Unexpected innings value')
        return value
    flat = re.sub(r'<table class="table_inning">.*?</table>', inning, html, flags=re.S)
    header = None
    seen = set()
    usage = {str(y): {'battingGames': 0, 'plateAppearances': 0, 'homeRuns': 0,
                      'pitchingGames': 0, 'outs': 0, 'wins': 0, 'saves': 0, 'holds': 0}
             for y in (*SEASONS, 2026)}
    for row in rows(flat):
        c = row['cells']
        if c and c[0] == '年度':
            header = c
            if '打席' in c: seen.add('batting')
            if '投球回' in c: seen.add('pitching')
            continue
        if not c or c[0] not in usage:
            continue
        if not header or len(c) != len(header):
            raise ValueError('Career statistics layout changed')
        values = dict(zip(header, c))
        # A midseason transfer has one row per club plus an aggregate row.
        # Sum club rows only, across both clubs, without double counting totals.
        if status_name(values['所属球団']) == '計':
            continue
        target = usage[c[0]]
        def count(key):
            value = values[key]
            if not re.fullmatch(r'\d+', value):
                raise ValueError(f'Invalid count: {key}')
            return int(value)
        if '打席' in values:
            fields = {'battingGames': '試合', 'plateAppearances': '打席', 'homeRuns': '本塁打'}
        else:
            fields = {'pitchingGames': '登板', 'wins': '勝利', 'saves': 'セーブ', 'holds': 'H'}
            value = '0' if values['投球回'] == '+' else values['投球回']
            match = re.fullmatch(r'(\d+)(?:\.([12]))?\+?', value)
            if not match:
                raise ValueError('Invalid career innings')
            target['outs'] += int(match[1]) * 3 + int(match[2] or 0)
        for field, key in fields.items():
            target[field] += count(key)
    if not seen and re.search(r'<p id="dnp">\s*（公式戦出場機会なし）\s*</p>', html):
        return usage
    if not seen and draft_year == 2025 and re.search(r'<p id="dnp">\s*（新入団）\s*</p>', html):
        return usage
    if 'batting' not in seen or (player['position'] == '投手' and 'pitching' not in seen):
        raise ValueError('Career statistics headers are missing')
    return usage


def build(refresh=False, verified_cache=None):
    day = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())['players']
    facts = json.loads((ROOT / 'src/eligibility2026.json').read_text())['players']
    selectable = [p for p in roster if p['eligible'] and not facts[p['id']]['exclusions']
                  and not facts[p['id']]['holds'] and facts[p['id']]['salaryManYen'] is not None
                  and facts[p['id']]['salaryManYen'] < 10000]
    cache = ROOT / '.cache/cpu-usage' / day
    cache.mkdir(parents=True, exist_ok=True)
    # Completed past seasons can reuse an already verified profile, retaining
    # its original retrieval date and checksum rather than relabeling it today.
    readings = json.loads((ROOT / 'src/playerReadings2026.json').read_text())['players']
    def fetch(p):
        url = f'https://npb.jp/bis/players/{p["id"][4:]}.html'
        if verified_cache is not None:
            raw = (verified_cache / (p['id'] + '.html')).read_bytes()
            meta = readings[p['id']]['source']
            if meta['url'] != url or meta['sha256'] != hashlib.sha256(raw).hexdigest():
                raise ValueError('Cached profile does not match verified provenance')
            html = raw.decode('utf8')
        else:
            _, meta, html = fetch_source(cache, p['id'] + '.html', url, day, refresh)
        return p['id'], {'name': p['name'], 'birthDate': p['birthDate'],
                         'seasons': parse_usage(html, p), 'source': meta}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = dict(pool.map(fetch, selectable))
    result = {'version': 1, 'season': 2026, 'asOf': day, 'historySeasons': list(SEASONS), 'players': records}
    path = ROOT / 'src/cpuUsage2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'CPU usage histories matched: {len(records)}; all selectable players covered')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--refresh', action='store_true')
    group.add_argument('--verified-profile-cache', type=Path)
    args = parser.parse_args()
    build(args.refresh, args.verified_profile_cache)
