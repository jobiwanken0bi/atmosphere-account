#!/usr/bin/env python3
"""Refresh all visible Railway scopes. Values exist only in memory during inspection."""
import concurrent.futures
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from storage import CODE, ROOT, prepare, write

def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,CODE/filename)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value

H=module('rotation_helper','replace-api-keys.py')

def topology(project):
    q='query($p:String!){project(id:$p){id name buckets{edges{node{id name}}} environments{edges{node{id name serviceInstances{edges{node{serviceId serviceName deletedAt latestDeployment{id status}}}}}}}} projectTokens(projectId:$p,first:100){edges{node{id name environmentId createdAt}} pageInfo{hasNextPage}}}'
    result=H.api(q,{'p':project['id']})
    if result['projectTokens']['pageInfo']['hasNextPage']:
        raise H.SafeError('Project-token metadata requires pagination. Inventory was not finalized.')
    return result

def names(job):
    p,e=job
    q='query($e:String!){environment(id:$e){variables(first:500){edges{node{id name serviceId isSealed updatedAt}} pageInfo{hasNextPage}}}}'
    d=H.api(q,{'e':e['id']})['environment']['variables']
    if d['pageInfo']['hasNextPage']:
        raise H.SafeError('Variable metadata requires pagination. Inventory was not finalized.')
    return {'project':p['name'],'projectId':p['id'],'environment':e['name'],'environmentId':e['id'],'variables':[x['node'] for x in d['edges']]}

def providers(metadata, variable_names, inventory):
    definitions=json.loads((CODE/'providers.json').read_text())
    services={(e['node']['id'],s['node']['serviceId']):s['node'] for p in metadata for e in p['project']['environments']['edges'] for s in e['node']['serviceInstances']['edges'] if not s['node']['deletedAt']}
    rows={(r['environmentId'],r['serviceId'],r['variable']):r for scope in inventory['scopes'] for r in scope.get('rows',[])}
    keys=[]
    for definition in definitions:
        key=dict(definition,targets=[],readiness='prompt_ready')
        for environment in variable_names:
            if environment['project']!=key['project'] or environment['environment']!=key['environment']:continue
            by_service={}
            for variable in environment['variables']:
                if variable['name'] in key['fields']:by_service.setdefault(variable['serviceId'],[]).append(variable)
            for sid, variables in by_service.items():
                service=services.get((environment['environmentId'],sid))
                if not service:continue
                if set(v['name'] for v in variables)!=set(key['fields']):
                    key['readiness']='credential_pair_review_required'
                target={k:environment[k] for k in ('project','projectId','environment','environmentId')}
                target.update(service=service['serviceName'],serviceId=sid,sealed={v['name']:v['isSealed'] for v in variables})
                key['targets'].append(target)
                for variable in variables:
                    row=rows.get((target['environmentId'],sid,variable['name']),{})
                    if row.get('references'):key['readiness']='reference_source_review_required'
                if not service.get('latestDeployment') or service['latestDeployment']['status']!='SUCCESS':
                    key['readiness']='deployment_review_required'
        if not key['targets']:key['readiness']='historical_credential_review_required'
        # A provider key copied to another location must be coordinated before revocation.
        known={(t['environmentId'],t['serviceId'],f) for t in key['targets'] for f in key['fields']}
        groups={rows[x].get('sameValueGroup') for x in known if x in rows}-{None}
        extra=[r for identity,r in rows.items() if identity not in known and r.get('sameValueGroup') in groups]
        nested=[r for r in rows.values() if any(n.get('sameValueGroup') in groups for n in r.get('nestedSecrets',[]))]
        if extra or nested:
            key['readiness']='additional_consumer_review_required'
            key['additionalConsumers']=[{k:r[k] for k in ('project','environment','service','variable')} for r in extra+nested]
        if key['id']=='stripe' and key['readiness']=='prompt_ready':
            target=key['targets'][0]
            current=H.api('query($p:String!,$e:String!,$s:String){variables(projectId:$p,environmentId:$e,serviceId:$s)}',{'p':target['projectId'],'e':target['environmentId'],'s':target['serviceId']})['variables'].get('STRIPE_SECRET_KEY')
            if isinstance(current,str):
                key['expectedStripeMode']='live' if current.startswith(('sk_live_','rk_live_')) else 'test' if current.startswith(('sk_test_','rk_test_')) else None
                request=urllib.request.Request('https://api.stripe.com/v1/account',headers={'Authorization':'Bearer '+current,'User-Agent':'atmosphere-railway-key-rotation/1.0','Accept':'application/json'})
                try:
                    with urllib.request.urlopen(request,timeout=25) as response:account=json.load(response)
                    if isinstance(account.get('id'),str) and account['id'].startswith('acct_'):key['expectedStripeAccountId']=account['id']
                except Exception:
                    pass
                del current,request
            if not key.get('expectedStripeMode') or not key.get('expectedStripeAccountId'):
                key['readiness']='stripe_account_review_required'
        # These issuers still require external-consumer/provider confirmation.
        if key['id'] in ('turso','draft-alerts','comail','stripe-connect'):
            key['readiness']='external_consumer_or_provider_review_required'
        keys.append(key)
    write('replacement-plan.json',{'version':2,'inventoryDate':H.now(),'keys':keys})

def main():
    os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0));prepare()
    with (ROOT/'.incident.lock').open('a') as a,(ROOT/'.replacement.lock').open('a') as b:
        try:
            fcntl.flock(a,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(b,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise H.SafeError('A rotation is open. Finish it before refreshing inventory.') from None
        progress=ROOT/'incident-progress.json';receipts=ROOT/'replacement-receipts.json'
        if (progress.exists() and (json.loads(progress.read_text()).get('active') or json.loads(progress.read_text()).get('completedSteps'))) or (receipts.exists() and json.loads(receipts.read_text()).get('receipts')):
            raise H.SafeError('Existing rotation progress must be reconciled before replacing the inventory. It was preserved.')
        write('inventory-status.json',{'status':'refreshing','at':H.now(),'dnsMigration':'on_hold'})
        result=subprocess.run([shutil.which('railway') or 'railway','project','list','--json'],capture_output=True,text=True,env=H.ENV,timeout=75)
        if result.returncode:raise H.SafeError('Project inventory unavailable. Check Railway CLI sign-in/network; raw output withheld.')
        projects=json.loads(result.stdout)
        if not projects:raise H.SafeError('No visible projects. Inventory was not finalized.')
        write('projects.json',projects)
        print('Reading topology for '+str(len(projects))+' projects...',flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:metadata=list(pool.map(topology,projects))
        write('all-project-metadata.json',metadata)
        jobs=[(p['project'],e['node']) for p in metadata for e in p['project']['environments']['edges']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:variable_names=list(pool.map(names,jobs))
        write('variable-names.json',variable_names)
        module('inventory','inventory-secrets.py').main()
        inventory=json.loads((ROOT/'full-secret-inventory.json').read_text())
        if any(s.get('error') for s in inventory['scopes']):raise H.SafeError('Some scopes could not be inspected. Inventory was not finalized.')
        providers(metadata,variable_names,inventory)
        module('incident_plan','build-incident-plan.py').main()
        write('inventory-status.json',{'status':'ready','at':H.now(),'dnsMigration':'on_hold','projectCount':len(projects),'environmentCount':len(jobs)})
        write('incident-progress.json',{'dnsMigration':'on_hold','completedSteps':[],'active':None,'restoredAt':H.now(),'historicalProgress':'unverified; previous temporary receipts unavailable'})
        print('Inventory ready. No credentials or DNS records changed.',flush=True)

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(str(exc) if isinstance(exc,H.SafeError) else 'Inventory stopped; raw error details withheld. Existing progress was preserved.',file=sys.stderr)
        sys.exit(1)
