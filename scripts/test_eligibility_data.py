import unittest
import io
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
from update_eligibility_data import salary_man_yen, parse_departures, fetch_source, status_name, update_departures


class SalaryParserTest(unittest.TestCase):
    def test_currency_units_and_exception_boundaries(self):
        for text, expected in [('4999万円', 4999), ('5000万円', 5000), ('9999万円', 9999), ('1億円', 10000), ('1億2000万円', 12000), ('2億5000万円', 25000), ('720万円', 720), ('450.5万円', 450.5)]:
            with self.subTest(text=text):
                self.assertEqual(salary_man_yen(text), expected)

    def test_unknown_or_unexpected_amounts_are_not_zero(self):
        for text in ['', '非公表', '不明', '5000', '5000ドル', '万円']:
            with self.subTest(text=text):
                self.assertIsNone(salary_man_yen(text))

    def test_status_reports_are_team_scoped_and_ignore_past_departures_in_biographies(self):
        teams = ['阪神', '巨人', 'DeNA', '広島', 'ヤクルト', '中日', 'ソフトバンク', '日本ハム', 'ロッテ', '楽天', 'オリックス', '西武']
        html = ''.join(f'<h2>{team}</h2><p>高橋一投手（25）→戦力外</p><p>佐藤二捕手（30）→退団</p><p>鈴木三投手（過去に退団）→加入</p><p>田中四コーチ（50）→退任</p>' for team in teams)
        departing, _ = parse_departures(html)
        self.assertEqual(len(departing), 24)
        self.assertIn(('t', status_name('髙橋 一')), departing)
        self.assertNotIn(('t', status_name('鈴木 三')), departing)
        self.assertNotIn(('t', status_name('田中 四')), departing)
        with self.assertRaises(ValueError):
            parse_departures('<p>高橋一投手（25）→戦力外</p>')

    def test_same_day_source_cache_is_refreshed_only_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'reports.html').write_bytes(b'old report')
            with patch('urllib.request.urlopen', return_value=io.BytesIO(b'new report')) as request:
                self.assertEqual(fetch_source(path, 'reports.html', 'https://example.com/report', '2026-10-24')[2], 'old report')
                request.assert_not_called()
                self.assertEqual(fetch_source(path, 'reports.html', 'https://example.com/report', '2026-10-24', True)[2], 'new report')
                request.assert_called_once()

    def test_report_markup_handles_missing_biography_parentheses_without_matching_old_history(self):
        teams = ['阪神', '巨人', 'DeNA', '広島', 'ヤクルト', '中日', 'ソフトバンク', '日本ハム', 'ロッテ', '楽天', 'オリックス', '西武']
        html = ''.join(f'<h2>{team}</h2><p>高橋一投手（25）→戦力外</p><p>佐藤二捕手（30）→退団</p>' for team in teams)
        html += '''<h2>中日</h2>
        <p><span class="black bold">川越誠司外野手（33＝16年2位で西武→23年トレードで中日</span>→<span class="black bold">戦力外</span></p>
        <p><span class="black bold">宇佐見真吾捕手（33＝巨人→日本ハム→中日</span>→戦力外</p>
        <p><span class="black bold">過去太郎投手（30＝23年戦力外→24年FA移籍</span>→加入</p>
        <h2>広島</h2><p>羽月隆太郎内野手（26）→契約解除</p>'''
        departing, fa_history = parse_departures(html)
        self.assertEqual(len(departing), 27)
        self.assertIn(('d', '川越誠司'), departing)
        self.assertIn(('d', '宇佐見真吾'), departing)
        self.assertIn(('c', '羽月隆太郎'), departing)
        self.assertNotIn(('d', '過去太郎'), departing)
        self.assertIn(('d', '過去太郎'), fa_history)

    def test_report_name_variants_match_full_roster_names(self):
        self.assertEqual(status_name('濱 将乃介'), status_name('浜将乃介'))
        self.assertEqual(status_name('日當 直喜'), status_name('日当直喜'))
        self.assertNotEqual(status_name('日當 直喜'), status_name('日当太郎'))

    def test_departure_only_refresh_retains_other_facts_and_never_reinstates_missing_reports(self):
        teams = ['阪神', '巨人', 'DeNA', '広島', 'ヤクルト', '中日', 'ソフトバンク', '日本ハム', 'ロッテ', '楽天', 'オリックス', '西武']
        html = ''.join(f'<h2>{team}</h2><p>高橋一投手（25）→戦力外</p><p>佐藤二捕手（30）→退団</p>' for team in teams)
        html += '<h2>中日</h2><p>川越誠司外野手（33）→戦力外</p>'
        meta = {'url': 'https://example.com/report', 'retrievedAt': '2026-10-25', 'sha256': 'f' * 64}
        facts = {'salaryYear': 2026, 'salaryManYen': 1400, 'salarySource': 'https://example.com/salary', 'checkedAt': '2026-10-24', 'exclusions': [], 'holds': [], 'unresolved': []}
        original = {'version': 1, 'asOf': '2026-10-24', 'sources': [{'url': 'https://example.com/salary'}], 'players': {'one': facts, 'two': {**facts, 'exclusions': [{'reason': '戦力外・退団・引退の報道あり', 'source': 'https://example.com/old'}]}}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'src').mkdir()
            (root / 'src/npb2026.json').write_text(json.dumps({'players': [{'id': 'one', 'team': 'd', 'name': '川越 誠司'}, {'id': 'two', 'team': 'd', 'name': '過去の確認済み選手'}]}))
            path = root / 'src/eligibility2026.json'; path.write_text(json.dumps(original))
            with patch('update_eligibility_data.ROOT', root), patch('update_eligibility_data.fetch_source', return_value=('departures.html', meta, html)):
                update_departures(True)
            updated = json.loads(path.read_text())
            self.assertEqual(updated['players']['two'], original['players']['two'])
            expected = {**facts, 'checkedAt': updated['asOf'], 'exclusions': [{'reason': '戦力外・退団・引退の報道あり', 'source': meta['url']}]}
            self.assertEqual(updated['players']['one'], expected)
            self.assertIn(original['sources'][0], updated['sources'])
            before = path.read_bytes()
            with patch('update_eligibility_data.ROOT', root), patch('update_eligibility_data.fetch_source', return_value=('departures.html', meta, '<p>invalid</p>')):
                with self.assertRaises(ValueError): update_departures(True)
            self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
