import unittest
from update_npb_data import parse_roster, parse_stats


class OfficialDataParserTest(unittest.TestCase):
    def test_roster_keeps_registration_and_ignores_staff(self):
        header = '<h2>2026年度 選手一覧</h2><table><tr class="rosterMainHead"><th>No.</th><th>投手</th></tr>'
        def player(i, development=False):
            number = f'{i:03}' if development else str(i)
            return f'<tr class="rosterPlayer"><td>{number}</td><td><a href="/bis/players/{i:08}.html">選手　{i}</a></td><td>2000.01.01</td><td>180</td><td>80</td><td>右</td><td>左</td><td></td></tr>'
        html = header + ''.join(player(i, i > 30) for i in range(1, 41)) + '</table>'
        data = parse_roster(html, 't', 'https://npb.jp/bis/teams/rst_t.html')
        self.assertEqual(len(data), 40)
        self.assertEqual(sum(p['eligible'] for p in data), 30)
        self.assertEqual(data[-1]['registration'], '育成')
        self.assertEqual(data[0]['birthDate'], '2000-01-01')
        with self.assertRaises(ValueError):
            parse_roster(html.replace('2026年度', '2025年度'), 't', 'source')
        with self.assertRaises(ValueError):
            parse_roster(header + player(1), 't', 'source')

    def test_batting_handles_symbols_and_zero_without_inventing_stats(self):
        html = '''<title>2026年度 個人打撃成績</title><table>
        <tr><th>選手</th><th>試合</th><th>打席</th><th>打率</th><th>本塁打</th><th>打点</th><th>長打率</th><th>出塁率</th></tr>
        <tr><td>*選手　甲</td><td>10</td><td>20</td><td>.000</td><td>0</td><td>0</td><td>.000</td><td>.100</td></tr>
        <tr><td>+選手　乙</td><td>1</td><td>0</td><td>.---</td><td>0</td><td>0</td><td>.---</td><td>.---</td></tr></table>'''
        stats = parse_stats(html)
        self.assertEqual(stats['選手甲']['average'], 0)
        self.assertEqual(stats['選手甲']['ops'], .1)
        self.assertIsNone(stats['選手乙']['average'])
        self.assertIsNone(stats['選手乙']['ops'])

    def test_pitching_uses_appearances_and_preserves_baseball_innings(self):
        html = '''<title>2026年度 個人投手成績</title><table>
        <tr><th>選手</th><th>登板</th><th>勝利</th><th>敗北</th><th>セーブ</th><th>投球回</th><th>防御率</th></tr>
        <tr><td>投手　甲</td><td>7</td><td>1</td><td>0</td><td>0</td><td>11.2</td><td>0.00</td></tr></table>'''
        stats = parse_stats(html, pitching=True)['投手甲']
        self.assertEqual(stats['games'], 7)
        self.assertEqual(stats['innings'], '11.2')
        self.assertEqual(stats['era'], 0)


if __name__ == '__main__':
    unittest.main()
