import unittest
import io
import tempfile
from pathlib import Path
from unittest.mock import patch
from update_eligibility_data import salary_man_yen, parse_departures, fetch_source, status_name


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


if __name__ == '__main__':
    unittest.main()
