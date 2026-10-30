"""Offline regression checks for recovery, coverage and secret-safe inventory."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import storage

CODE=Path(__file__).resolve().parent

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,CODE/filename)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

inventory=load('inventory_test','inventory-secrets.py')
refresh=load('refresh_test','refresh-inventory.py')
workflow=load('workflow_test','rotate-secrets.py')
FAKE='FAKE_ONLY_CREDENTIAL_VALUE_1234567890'

class Durable(unittest.TestCase):
    def test_storage_permissions_and_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as temporary,patch.object(storage,'ROOT',Path(temporary)/'state'):
            storage.write('progress.json',{'completedSteps':[]})
            storage.write('progress.json',{'completedSteps':['one']})
            self.assertEqual(storage.ROOT.stat().st_mode&0o777,0o700)
            p=storage.ROOT/'progress.json'
            self.assertEqual(p.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(p.read_text()),{'completedSteps':['one']})
            self.assertEqual([x.name for x in storage.ROOT.iterdir()],['progress.json'])

    def test_state_path_cannot_escape(self):
        with tempfile.TemporaryDirectory() as temporary,patch.object(storage,'ROOT',Path(temporary)/'state'):
            with self.assertRaises(ValueError):storage.write('../outside.json',{})

    def test_inventory_keeps_values_out_of_metadata(self):
        p={'name':'fixture','id':'p'};e={'name':'staging','id':'e'};s={'serviceName':'api','serviceId':'s'}
        values={'API_KEY':FAKE,'UNUSUAL_CONFIG':json.dumps({'nested':{'token':FAKE}}),'DATABASE_URL':'postgres://user:'+FAKE+'@example.invalid/db','REFERENCE':'${{Postgres.DATABASE_URL}}'}
        with patch.object(inventory.helper,'api',return_value={'variables':values}):result=inventory.inspect((p,e,s))
        self.assertNotIn(FAKE,json.dumps(result))
        by={r['variable']:r for r in result['rows']}
        self.assertEqual(by['UNUSUAL_CONFIG']['nestedSecrets'][0]['path'],['nested','token'])
        self.assertTrue(by['DATABASE_URL']['credentialUrl'])
        self.assertEqual(by['REFERENCE']['references'],[{'source':'Postgres','variable':'DATABASE_URL'}])

    def test_inventory_errors_do_not_leak_response(self):
        with patch.object(inventory.helper,'api',side_effect=Exception(FAKE)):
            result=inventory.inspect(({'name':'fixture','id':'p'},{'name':'staging','id':'e'},None))
        self.assertEqual(result['error'],'inventory_request_failed')
        self.assertNotIn(FAKE,json.dumps(result))

    def test_refresh_cannot_overwrite_active_or_completed_progress(self):
        for progress in ({'active':{'id':'provider:stripe'}},{'completedSteps':[{'id':'provider:stripe'}]}):
            with self.subTest(progress=progress),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);(root/'incident-progress.json').write_text(json.dumps(progress))
                with patch.object(refresh,'ROOT',root),patch.object(refresh,'prepare'),patch.object(refresh,'write') as write,patch.object(refresh.subprocess,'run') as command:
                    with self.assertRaises(refresh.H.SafeError):refresh.main()
                write.assert_not_called();command.assert_not_called()
                self.assertEqual(json.loads((root/'incident-progress.json').read_text()),progress)

    def test_refresh_cannot_overwrite_a_write_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'replacement-receipts.json').write_text('{"receipts":[{"state":"write_outcome_unknown"}]}')
            with patch.object(refresh,'ROOT',root),patch.object(refresh,'prepare'),patch.object(refresh,'write') as write,patch.object(refresh.subprocess,'run') as command:
                with self.assertRaises(refresh.H.SafeError):refresh.main()
            write.assert_not_called();command.assert_not_called()

    def test_partial_inventory_prevents_prompt_or_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);plan=root/'plan.json'
            plan.write_text((CODE/'fixtures'/'incident-plan.json').read_text())
            (root/'inventory-status.json').write_text('{"status":"refreshing"}')
            with patch.object(workflow,'ROOT',root),patch.object(workflow,'PLAN',plan),patch.object(workflow,'progress',return_value={'dnsMigration':'on_hold','completedSteps':[],'active':None}),patch.object(storage,'prepare'),patch.object(sys,'argv',['rotate']),patch.object(workflow,'tty') as tty,patch.object(workflow,'provider') as provider,contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(workflow.H.SafeError):workflow.main()
            tty.assert_not_called();provider.assert_not_called()

    def test_duplicate_paste_is_blocked_before_input(self):
        helper=workflow.H
        key={'id':'example'}
        with patch.object(helper,'secret_input') as secret,patch.object(helper,'api') as api:
            with self.assertRaises(helper.SafeError):helper.replace(key,{'receipts':[{'keyId':'example'}]})
        secret.assert_not_called();api.assert_not_called()

if __name__=='__main__':unittest.main()
