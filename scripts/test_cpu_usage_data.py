import unittest
from update_cpu_usage_data import parse_usage

PLAYER = {'name': 'テスト 選手', 'birthDate': '1998-08-07', 'position': '投手'}


def profile(body):
    return ('<li id="pc_v_name">テスト 選手</li><table>'
            '<tr><th>生年月日</th><td>1998年8月7日</td></tr>'
            '<tr><th>ドラフト</th><td>2020年ドラフト4位</td></tr></table>' + body)


def table(header, data):
    return '<table><tr>' + ''.join(f'<th>{c}</th>' for c in header) + '</tr>' + ''.join(
        '<tr>' + ''.join(f'<td>{c}</td>' for c in row) + '</tr>' for row in data) + '</table>'


class CpuUsageTest(unittest.TestCase):
    batting_header = ['年度', '所属球団', '試合', '打席', '本塁打']
    pitching_header = ['年度', '所属球団', '登板', '勝利', 'セーブ', 'H', '投球回']

    def test_two_way_usage_transfer_totals_and_fractional_innings(self):
        innings = '<table class="table_inning"><tr><th>29</th><td>.2</td></tr></table>'
        body = table(self.pitching_header, [
            ['2024', '球団A', '10', '2', '0', '3', innings],
            ['2024', '球団B', '5', '1', '0', '2', '10.2'],
            ['2024', '計', '15', '3', '0', '5', '40.1'],
            ['2025', '球団B', '1', '0', '0', '0', '+'],
        ]) + table(self.batting_header, [
            ['2024', '球団A', '15', '40', '1'],
            ['2025', '球団B', '60', '180', '3'],
            ['2026', '球団B', '90', '280', '8'],
        ])
        usage = parse_usage(profile(body), PLAYER)
        self.assertEqual(usage['2024']['outs'], 121)
        self.assertEqual(usage['2024']['pitchingGames'], 15)
        self.assertEqual(usage['2024']['holds'], 5)
        self.assertEqual(usage['2025']['outs'], 0)
        self.assertEqual(usage['2025']['plateAppearances'], 180)
        self.assertEqual(usage['2026']['plateAppearances'], 280)

    def test_explicit_no_appearances_is_distinct_from_missing_or_wrong_profile(self):
        html = profile('<p id="dnp">（公式戦出場機会なし）</p>')
        self.assertEqual(parse_usage(html, PLAYER)['2025']['plateAppearances'], 0)
        for broken in [profile(''), html.replace('テスト 選手', '別の 選手'), html.replace('1998年8月7日', '1998年8月8日')]:
            with self.assertRaises(ValueError):
                parse_usage(broken, PLAYER)

    def test_newcomer_requires_verified_draft_year(self):
        html = profile('<p id="dnp">（新入団）</p>')
        with self.assertRaises(ValueError):
            parse_usage(html, PLAYER)
        self.assertEqual(parse_usage(html.replace('2020年ドラフト', '2025年ドラフト'), PLAYER)['2024']['outs'], 0)

    def test_malformed_pitching_data_fails_instead_of_looking_like_zero_usage(self):
        for innings in ['29.3', '不明']:
            body = table(self.pitching_header, [['2024', '球団A', '10', '2', '0', '3', innings]])
            with self.assertRaises(ValueError):
                parse_usage(profile(body), PLAYER)
