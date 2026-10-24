import unittest
from update_cpu_draft_data import parse_draft


class DraftHistoryTest(unittest.TestCase):
    def html(self):
        regular = ''.join(f'<tr><th>{i}位</th><td>選手{i}</td><td>投手</td><td>大学</td></tr>' for i in range(1, 5))
        return '<span class="year">2025年</span><li id="tab_t" class="current"></li><h4>新人選手選択会議</h4><table>' + regular + '</table><h4>育成選手選択会議</h4><table><tr><th>1位</th><td>育成選手</td><td>捕手</td><td>高校</td></tr></table>'

    def test_distinguishes_the_first_pick_from_the_development_first_pick(self):
        result = parse_draft(self.html(), 2025, 't')
        self.assertEqual(len(result), 5)
        self.assertEqual(result[0], {'name': '選手1', 'round': 1, 'development': False})
        self.assertEqual(result[-1], {'name': '育成選手', 'round': 1, 'development': True})

    def test_wrong_year_wrong_club_and_incomplete_tables_are_rejected(self):
        for html, year, team in [(self.html(), 2024, 't'), (self.html(), 2025, 'g'), (self.html().replace('新人選手選択会議', '別の表'), 2025, 't')]:
            with self.subTest(year=year, team=team):
                with self.assertRaises(ValueError):
                    parse_draft(html, year, team)
