#!/usr/bin/env python3
"""Record official recent draft history for CPU judgement, not legal eligibility."""
import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path
import re
from update_npb_data import ROOT, TEAMS, rows
from update_eligibility_data import fetch_source, status_name


def parse_draft(html, year, team):
    if not re.search(rf'<span class="year">\s*{year}年', html) or not re.search(rf'<li id="tab_{team}" class="current">', html):
        raise ValueError('Unexpected draft season or selected club')
    blocks = re.split(r'<h4[^>]*>(.*?)</h4>', html, flags=re.S)
    result = []
    for heading, body in zip(blocks[1::2], blocks[2::2]):
        heading = re.sub('<[^>]*>', '', heading).strip()
        if heading not in ('新人選手選択会議', '育成選手選択会議'):
            continue
        development = heading.startswith('育成')
        for row in rows(body):
            cells = row['cells']
            if len(cells) == 4 and re.fullmatch(r'\d+位', cells[0]):
                result.append({'name': cells[1], 'round': int(cells[0][:-1]), 'development': development})
    if len([p for p in result if not p['development']]) < 4:
        raise ValueError('Draft table is incomplete')
    return result


def build(refresh=False):
    day = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    cache = ROOT / '.cache' / 'cpu-draft' / day
    cache.mkdir(parents=True, exist_ok=True)
    jobs = [(year, team) for year in (2023, 2024, 2025) for team in TEAMS]
    def fetch(job):
        year, team = job
        _, meta, html = fetch_source(cache, f'{year}-{team}.html', f'https://draft.npb.jp/draft/{year}/draftlist_{team}.html', day, refresh)
        return year, team, meta, parse_draft(html, year, team)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pages = list(pool.map(fetch, jobs))
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())['players']
    names = {}
    for p in roster:
        names.setdefault(status_name(p['name']), []).append(p)
    aliases = json.loads((ROOT / 'scripts/eligibility_overrides2026.json').read_text())['domesticDraftPlayers']
    aliases += json.loads((ROOT / 'scripts/cpu_draft_aliases2026.json').read_text())
    alias_sources = []
    players = {}; unmatched = []
    for year, team, meta, drafted in pages:
        for entry in drafted:
            found = names.get(status_name(entry['name']), [])
            alias = next((p for p in aliases if p['year'] == year and p['team'] == team and status_name(p['draftName']) == status_name(entry['name'])), None)
            if alias:
                found = [p for p in roster if p['id'] == alias['id']]
                if len(found) != 1 or found[0]['name'] != alias['name']:
                    raise ValueError('Draft alias no longer matches the official roster')
                _, profile_meta, profile = fetch_source(cache, f'profile-{alias["id"]}.html', f'https://npb.jp/bis/players/{alias["id"][4:]}.html', day, refresh)
                expected = f'{year}年' + ('育成選手' if entry['development'] else '') + f'ドラフト{entry["round"]}位'
                if not any(cells['cells'] == ['ドラフト', expected] for cells in rows(profile)):
                    raise ValueError('Draft alias does not match the official player profile')
                alias_sources.append(profile_meta)
            if len(found) > 1:
                raise ValueError(f'Ambiguous drafted name: {entry["name"]}')
            if not found:
                unmatched.append(f'{year}-{team}:{entry["name"]}')
                continue
            player = found[0]
            if player['id'] in players:
                raise ValueError(f'Duplicate draft record: {player["id"]}')
            players[player['id']] = {'name': player['name'], 'year': year, 'round': entry['round'], 'development': entry['development'], 'source': meta['url']}
    # Do not silently omit an entire cohort, especially the current rookies.
    for year in (2023, 2024, 2025):
        if sum(p['year'] == year for p in players.values()) < 60:
            raise ValueError(f'Unexpectedly low draft matching coverage: {year}')
    result = {'version': 1, 'season': 2026, 'asOf': day, 'sources': [p[2] for p in pages] + alias_sources, 'players': players}
    path = ROOT / 'src/cpuDraft2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'Official draft pages: {len(pages)}; matched roster records: {len(players)}')
    print(f'Names absent from current roster: {len(unmatched)}')
    for entry in unmatched: print(entry)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    build(parser.parse_args().refresh)
