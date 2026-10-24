import unittest
from update_player_readings import parse_reading


class PlayerReadingsTest(unittest.TestCase):
    def profile(self, name, kana):
        return f'<li id="pc_v_name">{name}</li><li id="pc_v_kana">{kana}</li><table><tr><th>生年月日</th><td>1998年1月2日</td></tr></table>'

    def test_alias_uses_registered_name_and_kana(self):
        p = {'name': '拓也', 'birthDate': '1998-01-02'}
        self.assertEqual(parse_reading(self.profile('拓也 （矢崎 拓也）', 'たくや（やさき・たくや）'), p), 'たくや')

    def test_names_and_birthdays_must_match(self):
        html = self.profile('山田 太郎', 'やまだ・たろう')
        self.assertEqual(parse_reading(html, {'name': '山田 太郎', 'birthDate': '1998-01-02'}), 'やまだ たろう')
        for p in [{'name': '別人', 'birthDate': '1998-01-02'}, {'name': '山田 太郎', 'birthDate': '1998-01-03'}]:
            with self.assertRaises(ValueError):
                parse_reading(html, p)

    def test_missing_kana_is_not_guessed(self):
        with self.assertRaises(ValueError):
            parse_reading(self.profile('山田 太郎', ''), {'name': '山田 太郎', 'birthDate': '1998-01-02'})
