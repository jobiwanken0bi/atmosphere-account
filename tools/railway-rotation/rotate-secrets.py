#!/usr/bin/env python3
"""One credential set per invocation. Secret values are never saved locally."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import sys

CODE=Path(__file__).resolve().parent
ROOT=CODE/'state'
spec=importlib.util.spec_from_file_location('provider_helper',CODE/'replace-api-keys.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
PLAN=ROOT/'incident-plan.json'
PROGRESS=ROOT/'incident-progress.json'

def store(state):
    path=ROOT/'.incident-progress.tmp'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:
        json.dump(state,f,indent=2);f.flush();os.fsync(f.fileno())
    os.replace(path,PROGRESS)

def progress():
    return json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {'dnsMigration':'on_hold','completedSteps':[],'active':None}

def tty():
    if not sys.stdin.isatty() or not sys.stderr.isatty():raise H.SafeError('Run this in your own interactive terminal. No action was taken.')

def ssh(target,code):
    try:
        p=subprocess.run([shutil.which('railway') or 'railway','ssh','--project',target['projectId'],'--environment',target['environmentId'],'--service',target['serviceId'],'--','sh','-c',code],env=H.ENV,text=True,capture_output=True,timeout=60)
        if p.returncode:raise H.SafeError('Runtime check is unavailable; raw output withheld.')
        return p.stdout
    except (OSError,subprocess.TimeoutExpired):raise H.SafeError('Runtime check timed out; raw output withheld.') from None

def database_password(step):
    t=step['target']
    q='query($p:String!,$e:String!,$s:String){variables(projectId:$p,environmentId:$e,serviceId:$s)}'
    values=H.api(q,{'p':t['projectId'],'e':t['environmentId'],'s':t['serviceId']})['variables']
    value=values.get(step['credentialField'])
    if not isinstance(value,str) or not value:raise H.SafeError('Cannot validate the database credential safely. Stop before Regenerate.')
    return value

def database_version(step):
    t=step['target']
    q='query($e:String!){environment(id:$e){variables(first:500){edges{node{name serviceId updatedAt}} pageInfo{hasNextPage}}}}'
    d=H.api(q,{'e':t['environmentId']})['environment']['variables']
    if d['pageInfo']['hasNextPage']:raise H.SafeError('Database metadata needs pagination before rotation.')
    rows=[e['node'] for e in d['edges'] if e['node']['serviceId']==t['serviceId'] and e['node']['name']==step['credentialField']]
    if len(rows)!=1:raise H.SafeError('Database credential metadata changed; reconcile before rotation.')
    return rows[0]['updatedAt']

def database_runtime(step,password):
    field=step['credentialField']
    if field not in ('POSTGRES_PASSWORD','REDIS_PASSWORD'):raise H.SafeError('Unsupported database credential.')
    code='printf "CREDENTIAL_HASH "; printenv '+field+' | sha256sum | cut -d" " -f1; '
    if step['engine']=='postgres':
        code+='if PGPASSWORD="$POSTGRES_PASSWORD" PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$POSTGRES_USER" PGDATABASE="$POSTGRES_DB" psql -X -At -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then printf "DATABASE_AUTH_OK\\n"; fi'
    else:
        code+='if REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h 127.0.0.1 PING 2>/dev/null | tr -d "\\r" | grep -qx PONG; then printf "DATABASE_AUTH_OK\\n"; fi'
    out=ssh(step['target'],code)
    expected=hashlib.sha256((password+'\n').encode()).hexdigest()
    return 'CREDENTIAL_HASH '+expected in out and 'DATABASE_AUTH_OK' in out

def database(step,state):
    print('\nDATABASE: '+step['label'])
    print('Known Railway consumers: '+(', '.join(c['service'] for c in step['consumers']) or 'none identified'))
    if step['readiness']!='ready' or not step.get('externalConsumersReviewed'):
        print('Status: consumer/external-access review pending. Do not regenerate yet.')
        print('The supported operation is Database → Config → Connection → Regenerate.')
        print('It changes the actual database password. A variable-only edit is not a rotation.')
        for note in step.get('externalConsumerNotes',[]):print(note)
        raise H.SafeError('This database is tracked, but its coordinated rotation is not enabled until its consumer review is complete.')
    if not step.get('latestDeployment') or step['latestDeployment']['status']!='SUCCESS':raise H.SafeError('Database must be running and checked before this ceremony can proceed.')
    t=step['target'];field=step['credentialField']
    H.preflight({'fields':[field],'targets':[dict(t,sealed={field:False})]})
    active=state.get('active')
    was_awaiting_functional_check=bool(active and active.get('id')==step['id'] and active.get('phase')=='functional_check_pending')
    if active is None or active['id']!=step['id']:
        baseline=database_version(step)
        active={'id':step['id'],'kind':'database','phase':'awaiting_native_regeneration','baselineVersion':baseline,'startedAt':H.now(),'consumers':{}}
        state['active']=active;store(state)
    if active['phase']=='awaiting_native_regeneration':
        print('Open: '+step['url'])
        print('In Database → Config → Connection, click Regenerate. This restarts the database and briefly interrupts its clients.')
        print('Railway generates the password. Do not paste or manually edit a database password here.')
        if input('After Regenerate succeeds, type REGENERATED (blank to stop): ').strip()!='REGENERATED':return
        if database_version(step)==active['baselineVersion']:raise H.SafeError('Database password metadata is unchanged. No consumer redeploy was requested.')
        active['phase']='awaiting_database_runtime';active['nativeRegenerationAttestedAt']=H.now();store(state)
    password=database_password(step)
    if not database_runtime(step,password):
        print('Waiting for the database runtime to use its new credential. Do not click Regenerate again. Run this command again to check.')
        return
    del password
    active['databaseAuthVerifiedAt']=H.now();active['phase']='consumer_redeploys';store(state)
    for client in step['consumers']:
        if not client.get('serviceId'):raise H.SafeError('Shared consumer requires manual reconciliation.')
        if not client.get('latestDeployment'):continue  # Never activate an unused service during incident response.
        sid=client['serviceId'];receipt=active['consumers'].get(sid)
        if receipt is None:
            before=H.deployment(client)
            if not before or before['status']!='SUCCESS':raise H.SafeError('Consumer '+client['service']+' is not ready for a controlled redeploy.')
            receipt={'before':before,'state':'redeploy_outcome_unknown'};active['consumers'][sid]=receipt;store(state)
            try:
                q='mutation($e:String!,$s:String!){serviceInstanceRedeploy(environmentId:$e,serviceId:$s)}'
                result=H.api(q,{'e':client['environmentId'],'s':sid})
                if not result.get('serviceInstanceRedeploy'):raise H.SafeError('Redeploy not confirmed.')
            except Exception:raise H.SafeError('Consumer redeploy outcome is uncertain; do not retry it blindly. Ask for reconciliation.') from None
            receipt['state']='redeploy_requested';store(state)
            print('Redeployment requested: '+client['service'])
        current=H.deployment(client);receipt['latest']=current;store(state)
        if not current or current['id']==receipt['before']['id'] or current['status']!='SUCCESS':
            print('Waiting for '+client['service']+' to finish redeploying. Run the same command again; it will not request a duplicate.')
            return
    active['phase']='functional_check_pending';store(state)
    print('Database password changed and known deployed consumers restarted. Functional checks and session/log review remain.')
    if was_awaiting_functional_check:
        if input('After all clients work and session/log review is complete, type COMPLETE (blank to stop): ').strip()=='COMPLETE':
            state['completedSteps'].append({'id':step['id'],'at':H.now(),'evidence':'owner-attested native regeneration; database authentication verified; consumer redeployments verified; owner-attested external clients and session/log review'})
            state['active']=None;store(state)
            print('Recorded. Stop here and report completion before the next credential.')
    else:
        print('Stop here and report the non-secret result to Codex so we can verify this database before the next secret.')

def provider(step,state):
    original=json.loads(H.PLAN.read_text())['keys']
    key=next(k for k in original if k['id']==step['providerId'])
    receipts=H.load_state()
    selected=[r for r in receipts['receipts'] if r['keyId']==key['id']]
    if not selected:
        state['active']={'id':step['id'],'kind':'provider','phase':'awaiting_key','startedAt':H.now()};store(state)
        print('ONE STEP: '+step['label'])
        print('Use the same provider account, resource and environment as the current key.')
        print('Retire exposed credentials promptly. Do not leave old keys active while working through unrelated steps.')
        H.replace(key,receipts)
        if not any(r['keyId']==key['id'] for r in receipts['receipts']):
            state['active']=None;store(state);return
        state['active']['phase']='runtime_verification_pending';store(state)
        print('\nStop here. Run this same command again to check this replacement after deployment.')
        return
    state['active']={'id':step['id'],'kind':'provider','phase':'runtime_verification_pending'};store(state)
    H.verify(receipts,key_id=key['id'])
    newest={r['target']['environmentId']+':'+r['target']['serviceId']:r for r in receipts['receipts'] if r['keyId']==key['id']}
    expected={t['environmentId']+':'+t['serviceId'] for t in key['targets']}
    if set(newest)!=expected or any(r['state']!='runtime_key_verified_provider_check_pending' for r in newest.values()):
        print('This replacement is still pending. Do not start another secret yet. Report the non-secret status to Codex.')
        return
    state['active']['phase']='provider_check_and_revocation_pending';store(state)
    print('Runtime key match confirmed. Check the affected feature and provider usage, then revoke the exposed old key at its provider.')
    print('If the provider already invalidated the old key, verify that instead. Preserve useful incident evidence before deleting its history.')
    if input('Only after the feature works and the old credential is revoked, type COMPLETE (blank to stop): ').strip()=='COMPLETE':
        state['completedSteps'].append({'id':step['id'],'at':H.now(),'evidence':'runtime fingerprint match plus owner-attested provider check and old-key revocation'})
        state['active']=None;store(state)
        print('Recorded. Stop here and tell Codex this step is complete; we will choose the next step.')

def main():
    os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    from storage import prepare
    prepare()
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--step',help='Run one specific plan ID; incomplete other steps cannot be bypassed.')
    p.add_argument('--status',action='store_true');p.add_argument('--list',action='store_true')
    args=p.parse_args()
    if not PLAN.exists():raise H.SafeError('Inventory is not initialized. Run refresh-inventory.py first.')
    plan=json.loads(PLAN.read_text());state=progress()
    if plan['dnsMigration']!='on_hold' or state['dnsMigration']!='on_hold':raise H.SafeError('Expected DNS hold is missing; stop for reconciliation.')
    print('DNS migration: ON HOLD. No DNS changes are part of this workflow.')
    if args.status:
        print('Coverage: '+str(plan['namedSecretLocations'])+' named-secret locations, '+str(plan['nestedSecretLocations'])+' nested JSON secrets, '+str(sum(s['kind']=='database' for s in plan['steps']))+' database instances.')
        print('Completed credential sets: '+str(len(state['completedSteps'])))
        print('Active: '+json.dumps(state['active']) if state['active'] else 'Active: none')
        print('Remaining coordination and audit steps stay incomplete until individually verified.')
        return
    if args.list:
        for step in plan['steps']:print(step['id']+' | '+step['kind']+' | '+step['readiness']+' | '+step['label'])
        return
    inventory_status=ROOT/'inventory-status.json'
    if not inventory_status.exists() or json.loads(inventory_status.read_text()).get('status')!='ready':
        raise H.SafeError('Inventory is incomplete. Refresh or reconcile it before rotating a credential.')
    tty()
    if plan.get('uninspectedScopes'):raise H.SafeError('Some scopes could not be inventoried. Reconcile coverage before replacing credentials.')
    completed={s['id'] for s in state['completedSteps']}
    step_id=args.step or (state['active'] or {}).get('id')
    if state['active'] and step_id!=state['active']['id']:raise H.SafeError('Finish the active credential set before starting another.')
    if step_id is None:step_id=next((s['id'] for s in plan['steps'] if s['id'] not in completed and s['readiness']=='prompt_ready'),None)
    matches=[s for s in plan['steps'] if s['id']==step_id]
    if len(matches)!=1:raise H.SafeError('No automatic next step is ready. Remaining steps require coordinated review; nothing is marked complete.')
    step=matches[0]
    if step['id'] in completed:raise H.SafeError('This step is already recorded complete; it will not be repeated automatically.')
    with (ROOT/'.incident.lock').open('a') as lock, (ROOT/'.replacement.lock').open('a') as other:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise H.SafeError('Another credential ceremony is open. Finish it first.') from None
        if progress()!=state:raise H.SafeError('Another ceremony updated progress. Re-run this command to use the current active step.')
        if step['kind']=='provider':provider(step,state)
        elif step['kind']=='database':database(step,state)
        else:
            print(step.get('instructions','Review required before replacement.'))
            raise H.SafeError('This secret is included in the plan but needs its coordinated procedure prepared before replacement.')

if __name__=='__main__':
    try:main()
    except (KeyboardInterrupt,EOFError):
        print('\nStopped. Any previously confirmed actions remain recorded. Re-run the same command to resume.',file=sys.stderr);sys.exit(130)
    except Exception as exc:
        print(str(exc) if isinstance(exc,H.SafeError) else 'Stopped; raw exception details withheld to protect credentials. Reconcile the recorded step before retrying.',file=sys.stderr);sys.exit(1)
