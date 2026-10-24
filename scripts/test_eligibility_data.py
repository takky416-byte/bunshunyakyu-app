import unittest
from update_eligibility_data import salary_man_yen


class SalaryParserTest(unittest.TestCase):
    def test_currency_units_and_exception_boundaries(self):
        for text, expected in [('4999万円', 4999), ('5000万円', 5000), ('9999万円', 9999), ('1億円', 10000), ('1億2000万円', 12000), ('2億5000万円', 25000), ('720万円', 720), ('450.5万円', 450.5)]:
            with self.subTest(text=text):
                self.assertEqual(salary_man_yen(text), expected)

    def test_unknown_or_unexpected_amounts_are_not_zero(self):
        for text in ['', '非公表', '不明', '5000', '5000ドル', '万円']:
            with self.subTest(text=text):
                self.assertIsNone(salary_man_yen(text))


if __name__ == '__main__':
    unittest.main()
