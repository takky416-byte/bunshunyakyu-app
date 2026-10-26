#!/usr/bin/env python3
"""Build an auditable 2026 salary-proxy snapshot. Never invent missing salaries."""
import concurrent.futures
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import urllib.request
from html.parser import HTMLParser
from update_npb_data import rows, normal_name

ROOT = Path(__file__).resolve().parents[1]
MAPPING = {1: 'g', 2: 'd', 3: 's', 4: 'c', 5: 't', 6: 'db', 7: 'f', 8: 'l', 9: 'h', 10: 'e', 11: 'm', 12: 'b'}
PREFECTURES = '北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄'.split()


def salary_man_yen(text):
    match = re.fullmatch(r'(?:(\d+)億)?(?:(\d+(?:\.\d+)?)万)?円', text.replace(',', ''))
    if not match or not any(match.groups()):
        return None
    return float(match[1] or 0) * 10000 + float(match[2] or 0)


def status_name(name):
    return normal_name(unicodedata.normalize('NFKC', name)).translate(str.maketrans({'髙': '高', '﨑': '崎', '邉': '辺', '邊': '辺', '濱': '浜', '當': '当'}))


def parse_departures(html):
    teams = {'阪神': 't', '巨人': 'g', 'DeNA': 'db', '広島': 'c', 'ヤクルト': 's', '中日': 'd', 'ソフトバンク': 'h', '日本ハム': 'f', 'ロッテ': 'm', '楽天': 'e', 'オリックス': 'b', '西武': 'l'}
    class Paragraphs(HTMLParser):
        def __init__(self):
            super().__init__(); self.tag = None; self.text = ''; self.team = None; self.items = []; self.seen = set()
            self.span_depth = 0; self.bio_depth = None; self.report_start = None
        def handle_starttag(self, tag, attrs):
            if tag in ('h2', 'p'):
                self.tag = tag; self.text = ''; self.span_depth = 0; self.bio_depth = None; self.report_start = None
            if tag == 'span' and self.tag == 'p':
                self.span_depth += 1
                if {'black', 'bold'} <= set((dict(attrs).get('class') or '').split()):
                    self.bio_depth = self.span_depth
        def handle_data(self, data):
            if self.tag: self.text += data
        def handle_endtag(self, tag):
            if tag == 'span' and self.tag == 'p':
                if self.bio_depth == self.span_depth:
                    if self.report_start is None: self.report_start = len(self.text)
                    self.bio_depth = None
                self.span_depth = max(0, self.span_depth - 1)
            if tag != self.tag: return
            if tag == 'h2':
                self.team = teams.get(self.text.strip())
                if self.team: self.seen.add(self.team)
            elif self.team: self.items.append((self.team, self.text, self.report_start))
            self.tag = None
    parser = Paragraphs(); parser.feed(html)
    departing = set(); fa_history = set()
    for team, text, report_start in parser.items:
        match = re.match(r'^\s*※?\s*(.+?)(?:投手|捕手|内野手|外野手|選手)[（(]', text)
        if not match: continue
        if report_start is not None and report_start >= match.end():
            # The source marks player biographies separately from the outcome.
            # Preserve this boundary even when a closing parenthesis is missing.
            history = text[match.end():report_start]
            outcome = text[report_start:]
        else:
            tail = re.match(r'([^）)]*)[）)](.*)$', text[match.end():], re.S)
            if not tail: continue
            history, outcome = tail.groups()
        key = (team, status_name(match[1]))
        if re.search(r'戦力外|現役引退|自由契約|退団|契約解除', outcome): departing.add(key)
        if re.search(r'FAで|FA移籍', history): fa_history.add(key)
    if len(parser.seen) != 12 or len(departing) < 20:
        raise ValueError('Departure article layout changed; refusing update')
    return departing, fa_history


def fetch_source(cache, name, url, day, refresh=False):
    path = cache / name
    if refresh or not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
        temporary = path.with_suffix('.tmp')
        temporary.write_bytes(raw)
        temporary.replace(path)
    raw = path.read_bytes()
    return name, {'url': url, 'retrievedAt': day, 'sha256': hashlib.sha256(raw).hexdigest()}, raw.decode('utf8')


def individual_departures(cache, day, roster, refresh=False):
    """Validate reviewed reports by official ID, even before roundup updates."""
    manifest = json.loads((ROOT / 'scripts/departure_reports2026.json').read_text())
    if manifest.get('version') != 1:
        raise ValueError('Unsupported departure report manifest')
    by_id = {p['id']: p for p in roster['players']}
    found = {}
    sources = []
    seen_keys = set()

    class ArticleText(HTMLParser):
        def __init__(self):
            super().__init__(); self.skip = 0; self.parts = []
        def handle_starttag(self, tag, attrs):
            if tag in ('script', 'style'): self.skip += 1
        def handle_endtag(self, tag):
            if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        def handle_data(self, data):
            if not self.skip: self.parts.append(data)

    for report in manifest['reports']:
        key = report['key']
        if not re.fullmatch(r'[a-z0-9-]+', key) or key in seen_keys:
            raise ValueError('Invalid or duplicate departure report key')
        seen_keys.add(key)
        if (report['team'] not in MAPPING.values() or
                not report['url'].startswith('https://') or
                datetime.date.fromisoformat(report['reportedAt']) > datetime.date.fromisoformat(day) or
                not report['requiredText'] or not report['players']):
            raise ValueError(f'{key}: incomplete departure report')
        _, meta, html = fetch_source(cache, f'departure-{key}.html', report['url'], day, refresh)
        parser = ArticleText(); parser.feed(html)
        text = status_name(' '.join(parser.parts))
        if not all(status_name(t) in text for t in report['requiredText']):
            raise ValueError(f'{key}: report date or departure statement missing; refusing update')
        ids = set()
        for player in report['players']:
            p = by_id.get(player['id'])
            if (not p or p['team'] != report['team'] or p['name'] != player['name'] or
                    p['id'] in ids or not player['reportedName'] or
                    status_name(player['reportedName']) not in text):
                raise ValueError(f'{key}: player identity or reported name mismatch; refusing update')
            ids.add(p['id'])
            found[(p['team'], status_name(p['name']))] = meta['url']
        sources.append(meta)
    return found, sources


def update_departures(refresh=False):
    """Refresh sourced departure exclusions without re-fetching salary/FA facts."""
    day = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    cache = ROOT / '.cache' / 'eligibility' / day
    cache.mkdir(parents=True, exist_ok=True)
    _, meta, html = fetch_source(cache, 'departures.html', 'https://www.nikkansports.com/baseball/news/202609280000276.html', day, refresh)
    departing, fa_history = parse_departures(html)
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())
    path = ROOT / 'src/eligibility2026.json'
    output = json.loads(path.read_text())
    if {p['id'] for p in roster['players']} != set(output['players']):
        raise ValueError('Roster and eligibility IDs differ; refusing departure-only update')
    individual, report_sources = individual_departures(cache, day, roster, refresh)
    added = []
    for p in roster['players']:
        key = (p['team'], status_name(p['name']))
        reasons = []
        if key in departing or key in individual: reasons.append('戦力外・退団・引退の報道あり')
        if key in fa_history: reasons.append('FA行使による移籍歴の報道あり')
        facts = output['players'][p['id']]
        for reason in reasons:
            if not any(e['reason'] == reason for e in facts['exclusions']):
                source = individual.get(key, meta['url']) if reason == '戦力外・退団・引退の報道あり' else meta['url']
                facts['exclusions'].append({'reason': reason, 'source': source})
                facts['checkedAt'] = day
                added.append((p['team'], p['name'], reason))
    # A temporarily missing article row must not silently reinstate a player.
    refreshed = {m['url']: m for m in [meta, *report_sources]}
    output['sources'] = [m for m in output['sources'] if m['url'] not in refreshed] + list(refreshed.values())
    output['asOf'] = day
    path.with_suffix('.tmp').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    path.with_suffix('.tmp').replace(path)
    print(f'Departure-only refresh: {len(added)} new exclusions; salary, FA IDs and other exclusions retained')
    for team, name, reason in added: print(f'{team}: {name} ({reason})')


def build(refresh=False):
    day = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    cache = ROOT / '.cache' / 'eligibility' / day
    cache.mkdir(parents=True, exist_ok=True)
    def fetch(item):
        name, url = item
        return fetch_source(cache, name, url, day, refresh)
    urls = [(f'salary-{i}.html', f'https://www.gurazeni.com/team/{i}') for i in MAPPING]
    urls += [('fa-2026.html', 'https://npb.jp/announcement/2026/fa_qualified.html'), ('draft-2025.html', 'https://c.npb.jp/geneki_draft/2025/')]
    urls += [('departures.html', 'https://www.nikkansports.com/baseball/news/202609280000276.html')]
    corrections = json.loads((ROOT / 'scripts/eligibility_overrides2026.json').read_text())['domesticDraftPlayers']
    urls += [(f'domestic-draft-{p["year"]}-{p["team"]}.html', f'https://draft.npb.jp/draft/{p["year"]}/draftlist_{p["team"]}.html') for p in corrections]
    urls = list(dict.fromkeys(urls))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pages = {name: (meta, html) for name, meta, html in pool.map(fetch, urls)}
    fa_meta, fa_html = pages['fa-2026.html']
    # Match official player IDs, never fuzzy name-only FA exclusions.
    fa_ids = set(re.findall(r'/bis/players/(\d+)\.html', fa_html))
    dr_meta, dr_html = pages['draft-2025.html']
    dr_ids = set(re.findall(r'/bis/players/(\d+)\.html', dr_html))
    if not 50 <= len(fa_ids) <= 200 or len(dr_ids) != 12:
        raise ValueError('Unexpected official FA/draft layout; refusing update')
    dep_meta, dep_html = pages['departures.html']
    departing, fa_history = parse_departures(dep_html)
    domestic = {}
    for player in corrections:
        meta, html = pages[f'domestic-draft-{player["year"]}-{player["team"]}.html']
        if not any(status_name(player['draftName']) in status_name(' '.join(row['cells'])) for row in rows(html)):
            raise ValueError(f'{player["name"]}: official draft name missing; refusing update')
        domestic[player['id']] = meta['url']
    salaries = {}
    for i, team in MAPPING.items():
        meta, html = pages[f'salary-{i}.html']
        title = re.search(r'<title>(.*?)</title>', html).group(1)
        if '2026年' not in title:
            raise ValueError('Salary source is not labeled 2026')
        for row in rows(html):
            c = row['cells']
            if len(c) != 7 or not c[0].isdigit():
                continue
            birth = re.fullmatch(r'(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', c[2])
            amount = salary_man_yen(c[6])
            if not birth or amount is None:
                continue
            dob = f'{birth[1]}-{int(birth[2]):02}-{int(birth[3]):02}'
            salaries.setdefault(team, []).append({'name': c[1], 'number': c[0], 'dob': dob, 'position': c[3], 'birthplace': c[5], 'salary': amount, 'source': meta['url']})
        if len(salaries.get(team, [])) < 40:
            raise ValueError(f'{team}: insufficient salary rows; refusing update')
    roster = json.loads((ROOT / 'src/npb2026.json').read_text())
    individual, report_sources = individual_departures(cache, day, roster, refresh)
    facts = {}
    for p in roster['players']:
        candidates = [r for r in salaries[p['team']] if r['dob'] == p['birthDate'] and (normal_name(r['name']) == normal_name(p['name']) or (r['number'] == p['number'] and r['position'] == p['position']))]
        salary = candidates[0] if len(candidates) == 1 else None
        exclusions = []
        holds = []
        if p['registration'] == '育成':
            exclusions.append({'reason': '育成登録', 'source': p['sourceUrl']})
        if p['id'][4:] in fa_ids:
            exclusions.append({'reason': '2026年FA資格保有者', 'source': fa_meta['url']})
        if p['id'][4:] in dr_ids:
            exclusions.append({'reason': '2025年現役ドラフトで獲得', 'source': dr_meta['url']})
        departure_key = (p['team'], status_name(p['name']))
        if departure_key in departing or departure_key in individual:
            exclusions.append({'reason': '戦力外・退団・引退の報道あり', 'source': individual.get(departure_key, dep_meta['url'])})
        if (p['team'], status_name(p['name'])) in fa_history:
            exclusions.append({'reason': 'FA行使による移籍歴の報道あり', 'source': dep_meta['url']})
        if not salary:
            holds.append('2026年推定年俸の照合待ち')
        elif p['id'] not in domestic and not any(salary['birthplace'].startswith(pref) for pref in PREFECTURES):
            # Birthplace does NOT prove foreign-player status. Withhold unknown
            # cases instead of classifying foreign-born Japanese as foreigners.
            holds.append('外国出身：外国人区分の照合待ち')
        facts[p['id']] = {'salaryYear': 2026, 'salaryManYen': salary['salary'] if salary else None, 'salarySource': salary['source'] if salary else None, 'checkedAt': day, 'exclusions': exclusions, 'holds': holds, 'unresolved': ['複数年契約・過去FA行使・開催時保留名簿は選手別照合待ち']}
        if p['id'] in domestic:
            facts[p['id']]['foreignPlayerTreatment'] = 'domestic'
            facts[p['id']]['treatmentSource'] = domestic[p['id']]
    if sum(p['salaryManYen'] is not None for p in facts.values()) < 900:
        raise ValueError('Salary matching coverage unexpectedly low; refusing update')
    output = {'version': 1, 'salaryPolicy': '2026年推定年俸を使用する仮判定', 'asOf': day, 'sources': [meta for meta, _ in pages.values()] + report_sources, 'players': facts}
    path = ROOT / 'src/eligibility2026.json'
    path.with_suffix('.tmp').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    path.with_suffix('.tmp').replace(path)
    print(f'Salary matched {sum(p["salaryManYen"] is not None for p in facts.values())}/{len(facts)}; FA IDs {len(fa_ids)}; previous-draft IDs {len(dr_ids)}')
    print(f'Departure reports: {len(departing)}; verified domestic treatment: {len(domestic)}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='Refresh cached source pages, including same-day report updates')
    parser.add_argument('--departures-only', action='store_true', help='Update departure reports while retaining salary and other eligibility facts')
    args = parser.parse_args()
    (update_departures if args.departures_only else build)(args.refresh)
