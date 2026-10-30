"""Offline checks for one-step gating and database coordination."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('incident',Path(__file__).with_name('rotate-secrets.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FIXTURES=Path(__file__).parent/'fixtures'
PLAN=json.loads((FIXTURES/'incident-plan.json').read_text())
FAKE='FAKE_ONLY_DATABASE_PASSWORD_1234567890'

class Workflow(unittest.TestCase):
    def setUp(self):
        for obj,name,value in [(m,'PLAN',FIXTURES/'incident-plan.json'),(m.H,'PLAN',FIXTURES/'replacement-plan.json'),(m,'ROOT',FIXTURES)]:
            patcher=patch.object(obj,name,value);patcher.start();self.addCleanup(patcher.stop)
    def state(self):return {'dnsMigration':'on_hold','completedSteps':[],'active':None}
    def db(self):return next(s for s in PLAN['steps'] if s['kind']=='database' and s['target']['project']=='atcash' and s['target']['environment']=='production' and s['engine']=='postgres')
    def test_dns_hold_and_full_database_coverage(self):
        self.assertEqual(PLAN['dnsMigration'],'on_hold')
        self.assertEqual(sum(s['kind']=='database' for s in PLAN['steps']),1)
        self.assertTrue(any(s['kind']=='encryption_migration' for s in PLAN['steps']))
        self.assertTrue(any(s['kind']=='identity_or_signing_rekey' for s in PLAN['steps']))
        self.assertTrue(any(s['kind']=='webhook' for s in PLAN['steps']))
    def test_first_provider_is_stripe(self):
        self.assertEqual(next(s for s in PLAN['steps'] if s['readiness']=='prompt_ready')['id'],'provider:stripe')
    def test_database_consumers_mapped(self):
        d=self.db()
        self.assertEqual([(c['service'],c['variables']) for c in d['consumers']],[('atpay-api',['DATABASE_URL'])])
    def test_unreviewed_database_cannot_regenerate_or_read_passwords(self):
        with patch.object(m,'database_password') as pwd,patch('builtins.input') as prompt,patch.object(m.H,'api') as api,contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.H.SafeError):m.database(self.db(),self.state())
        pwd.assert_not_called();prompt.assert_not_called();api.assert_not_called()
    def test_a_second_secret_cannot_bypass_the_active_step(self):
        state=self.state();state['active']={'id':'provider:stripe','phase':'pending'}
        with patch.object(m,'progress',return_value=state),patch.object(m,'tty'),patch.object(m.sys,'argv',['helper','--step','provider:bridge']),patch.object(m,'provider') as provider,contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.H.SafeError):m.main()
        provider.assert_not_called()
    def test_skipping_provider_does_not_mark_it_complete(self):
        step=next(s for s in PLAN['steps'] if s['id']=='provider:stripe');state=self.state()
        with patch.object(m.H,'load_state',return_value={'receipts':[]}),patch.object(m.H,'replace'),patch.object(m,'store'),contextlib.redirect_stdout(io.StringIO()):m.provider(step,state)
        self.assertIsNone(state['active']);self.assertEqual(state['completedSteps'],[])
    def test_receipts_contain_no_password(self):
        with tempfile.TemporaryDirectory() as temp,patch.object(m,'ROOT',Path(temp)),patch.object(m,'PROGRESS',Path(temp)/'state.json'):
            state=self.state();m.store(state)
            self.assertNotIn(FAKE,m.PROGRESS.read_text())
            self.assertEqual(m.PROGRESS.stat().st_mode&0o777,0o600)
    def test_failed_or_unchanged_db_version_does_not_redeploy(self):
        db=dict(self.db(),readiness='ready',externalConsumersReviewed=True);state=self.state()
        with patch.object(m.H,'preflight'),patch.object(m,'store'),patch.object(m,'database_version',return_value='same-version'),patch('builtins.input',return_value='REGENERATED'),patch.object(m,'database_runtime') as run,patch.object(m.H,'api') as api,contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.H.SafeError):m.database(db,state)
        run.assert_not_called();api.assert_not_called()
    def test_uncertain_consumer_redeploy_is_never_duplicated(self):
        db=dict(self.db(),readiness='ready',externalConsumersReviewed=True);state=self.state()
        client=db['consumers'][0]
        state['active']={'id':db['id'],'kind':'database','phase':'consumer_redeploys','baselineVersion':'old','consumers':{client['serviceId']:{'before':{'id':'old','status':'SUCCESS'},'state':'redeploy_outcome_unknown'}}}
        with patch.object(m.H,'preflight'),patch.object(m,'store'),patch.object(m,'database_password',return_value=FAKE),patch.object(m,'database_runtime',return_value=True),patch.object(m.H,'deployment',return_value={'id':'old','status':'SUCCESS'}),patch.object(m.H,'api') as api,contextlib.redirect_stdout(io.StringIO()):m.database(db,state)
        api.assert_not_called();self.assertEqual(state['completedSteps'],[])

if __name__=='__main__':unittest.main()
