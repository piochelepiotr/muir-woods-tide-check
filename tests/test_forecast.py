import datetime as dt
import unittest
from scripts.fetch_forecast import parse_station

class ForecastParserTests(unittest.TestCase):
    def test_exceedance_columns_are_mapped_to_correct_percentile_bounds(self):
        cycle=dt.datetime(2026,11,12,18,tzinfo=dt.timezone.utc)
        header='TIME,TIDE,OB,SURGE,BIAS,TWL,SURGE90p,TWL90p,SURGE10p,TWL10p\n'
        rows=[]
        for h in range(-2,25):
            t=cycle+dt.timedelta(hours=h)
            rows.append(t.strftime('%Y%m%d%H%M')+',5.0,9999,1.0,0.5,6.5,0.8,6.3,1.2,6.7')
        result=parse_station(header+'\n'.join(rows),cycle)
        self.assertEqual(len(result),25)
        self.assertEqual(result[0]['lower'],6.3) # 90% exceedance = low bound
        self.assertEqual(result[0]['upper'],6.7) # 10% exceedance = high bound
        self.assertEqual(result[0]['mean'],6.5)
        self.assertEqual(result[0]['t'],cycle.isoformat())

    def test_missing_sentinel_bounds_do_not_become_a_forecast(self):
        cycle=dt.datetime(2026,11,12,18,tzinfo=dt.timezone.utc)
        raw='TIME,TIDE,OB,SURGE,BIAS,TWL,SURGE90p,TWL90p,SURGE10p,TWL10p\n202611121800,5,9999,1,.5,6.5,.8,9999,1.2,9999\n'
        with self.assertRaises(ValueError):parse_station(raw,cycle)

if __name__=='__main__':unittest.main()
