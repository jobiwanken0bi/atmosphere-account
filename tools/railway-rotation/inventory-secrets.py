#!/usr/bin/env python3
"""Read Railway config in memory; persist only names, references and secret paths."""
import concurrent.futures
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit

CODE = Path(__file__).resolve().parent
ROOT = CODE/'state'
spec = importlib.util.spec_from_file_location('keyhelper', CODE/'replace-api-keys.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
SENSITIVE = re.compile(r'SECRET|PASSWORD|TOKEN|PRIVATE.*KEY|SIGNING.*KEY|ENCRYPTION.*KEY|API_KEY|ACCESS_KEY|WAL_ARCHIVE_KEY|OAUTH_PRIVATE|SESSION_KEY|CREDENTIAL|MNEMONIC|SEED', re.I)
REF = re.compile(r'\$\{\{\s*([A-Za-z0-9_\-]+)(?:\.([A-Za-z0-9_\-]+))?\s*\}\}')
salt = secrets.token_bytes(32)

def path_part(key):
    return key if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_\-]{0,63}', str(key)) else '<entry>'

def nested(obj, path=()):
    out=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            p=path+(path_part(k),)
            if isinstance(v,(dict,list)):out.extend(nested(v,p))
            elif isinstance(v,str) and v and (re.search(r'secret|password|token|private.?key|signing.?key|encryption.?key|api.?key|credential|mnemonic|seed',str(k),re.I) or credential_url(v)):
                out.append({'path':list(p),'signature':hmac.new(salt,v.encode(),hashlib.sha256).hexdigest()})
    elif isinstance(obj,list):
        for i,v in enumerate(obj):out.extend(nested(v,path+(i,)))
    return out

def credential_url(value):
    try:return isinstance(value,str) and bool(urlsplit(value).password)
    except Exception:return False

def inspect(job):
    p,e,s=job
    scope={'project':p['name'],'projectId':p['id'],'environment':e['name'],'environmentId':e['id'],'service':s['serviceName'] if s else 'shared','serviceId':s['serviceId'] if s else None}
    q='query($p:String!,$e:String!,$s:String){variables(projectId:$p,environmentId:$e,serviceId:$s,unrendered:true)}'
    try:
        values=helper.api(q,{'p':p['id'],'e':e['id'],'s':scope['serviceId']})['variables']
        rows=[]
        for name,value in values.items():
            if name.startswith('RAILWAY_'):continue
            row={**scope,'variable':name,'references':[],'hasLiteralValue':False,'sealedOrUnavailable':value is None}
            if isinstance(value,str):
                row['references']=[{'source':m.group(1),'variable':m.group(2)} for m in REF.finditer(value)]
                row['hasLiteralValue']=bool(value) and not bool(REF.fullmatch(value))
                if SENSITIVE.search(name) and value and not REF.fullmatch(value):row['signature']=hmac.new(salt,value.encode(),hashlib.sha256).hexdigest()
                row['credentialUrl']=credential_url(value)
                if value.lstrip().startswith(('{','[')):
                    try:row['nestedSecrets']=nested(json.loads(value))
                    except Exception:row['jsonInspection']='unavailable'
            row['sensitiveName']=bool(SENSITIVE.search(name))
            rows.append(row)
        return {'scope':scope,'rows':rows}
    except Exception:return {'scope':scope,'error':'inventory_request_failed'}

def main():
    os.umask(0o077)
    import resource
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    from storage import prepare, write
    prepare()
    meta=json.loads((ROOT/'all-project-metadata.json').read_text())
    jobs=[]
    for record in meta:
        p=record['project']
        for edge in p['environments']['edges']:
            e=edge['node'];jobs.append((p,e,None))
            for edge in e['serviceInstances']['edges']:
                s=edge['node']
                if not s['deletedAt']:jobs.append((p,e,s))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(inspect,jobs))
    groups={}
    def group(obj):
        if 'signature' in obj:
            sig=obj.pop('signature')
            obj['sameValueGroup']=groups.setdefault(sig,'value-group-'+str(len(groups)+1).zfill(4))
    for result in results:
        for row in result.get('rows',[]):
            group(row)
            for entry in row.get('nestedSecrets',[]):group(entry)
    payload={'inventoryDate':helper.now(),'scope':'all potentially exposed Railway secrets; DNS migration on hold','scopes':results}
    write('full-secret-inventory.json',payload)
    errors=[r['scope'] for r in results if r.get('error')]
    print(json.dumps({'scopesInspected':len(results),'errors':errors,'namedSecretLocations':sum(r['sensitiveName'] for x in results for r in x.get('rows',[])),'nestedSecretLocations':sum(len(r.get('nestedSecrets',[])) for x in results for r in x.get('rows',[])),'rawSecretValuesSaved':False}),flush=True)

if __name__=='__main__':main()
