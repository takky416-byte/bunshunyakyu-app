import unittest
from update_player_career_data import parse_profile


def profile(draft):
    return '<table><tr><th>生年月日</th><td>2000年8月7日</td></tr>' + (f'<tr><th>ドラフト</th><td>{draft}</td></tr>' if draft is not None else '') + '</table>'


class PlayerCareerTest(unittest.TestCase):
    def test_regular_development_and_undrafted_entries(self):
        for text, expected in [('2024年ドラフト1位', 2024), ('2017年育成選手ドラフト3位', 2017), ('1998年ドラフト外', 1998), ('2006年高校生ドラフト1巡目', 2006), ('2005年大学・社会人ドラフト希望枠', 2005), ('2003年ドラフト自由獲得枠', 2003), ('2001年ドラフト自由枠', 2001), ('2007年大学生・社会人ドラフト3巡目', 2007)]:
            self.assertEqual(parse_profile(profile(text), '2000-08-07'), expected)

    def test_no_draft_is_not_guessed_from_first_team_debut(self):
        for text in [None, '']:
            self.assertIsNone(parse_profile(profile(text), '2000-08-07'))

    def test_wrong_identity_and_unexpected_draft_data_are_rejected(self):
        for html, birthday in [(profile('2024年ドラフト1位'), '2000-08-08'), (profile('来年ドラフト'), '2000-08-07'), (profile('2026年ドラフト1位'), '2000-08-07')]:
            with self.assertRaises(ValueError):
                parse_profile(html, birthday)
