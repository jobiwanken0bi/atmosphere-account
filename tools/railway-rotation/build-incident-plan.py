"""Build a metadata-only plan covering provider, database and other secrets."""
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent/'state'

def main():
    inventory=json.loads((ROOT/'full-secret-inventory.json').read_text())
    scopes=inventory['scopes']
    rows=[r for s in scopes for r in s.get('rows',[])]
    nodes={(r['environmentId'],r['serviceId'],r['variable']):r for r in rows}
    service_ids={(s['scope']['environmentId'],s['scope']['service']):s['scope']['serviceId'] for s in scopes}
    topology=json.loads((ROOT/'all-project-metadata.json').read_text())
    deployed={(e['node']['id'],s['node']['serviceId']):s['node']['latestDeployment'] for p in topology for e in p['project']['environments']['edges'] for s in e['node']['serviceInstances']['edges']}
    def target(r):return {k:r[k] for k in ('project','projectId','environment','environmentId','service','serviceId')}
    def dependencies(key,root,seen=None):
        if key==root:return True
        seen=set() if seen is None else seen
        if key in seen:return False
        seen.add(key)
        for ref in nodes.get(key,{}).get('references',[]):
            sid=key[1] if ref['variable'] is None else (None if ref['source']=='shared' else service_ids.get((key[0],ref['source']),'unknown'))
            name=ref['source'] if ref['variable'] is None else ref['variable']
            if dependencies((key[0],sid,name),root,seen.copy()):return True
        return False
    provider_order=['stripe','bridge','privy-production','openai','stripe-connect','expo','resend-moderation','photodna','privy-sandbox','r2-read','r2-operator','draft-alerts','comail','turso','railway-monitor']
    providers=json.loads((ROOT/'replacement-plan.json').read_text())['keys']
    steps=[];covered=set();covered_groups=set()
    for id in provider_order:
        p=next((p for p in providers if p['id']==id),None)
        if p is None:continue
        steps.append({'id':'provider:'+id,'kind':'provider','label':p['label'],'providerId':id,'readiness':p.get('readiness','prompt_ready'),'targets':p['targets']})
        for t in p['targets']:
            for name in p['fields']:
                key=(t['environmentId'],t['serviceId'],name);covered.add(key)
                if nodes.get(key,{}).get('sameValueGroup'):covered_groups.add(nodes[key]['sameValueGroup'])
    for scope in scopes:
        ns={r['variable'] for r in scope.get('rows',[])}
        if {'POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD'}<=ns:engine='postgres';field='POSTGRES_PASSWORD'
        elif scope['scope']['service'].lower().startswith(('redis','coop-redis')) and 'REDIS_PASSWORD' in ns:engine='redis';field='REDIS_PASSWORD'
        else:continue
        t=scope['scope'];root=(t['environmentId'],t['serviceId'],field)
        consumers=[r for k,r in nodes.items() if k[0]==root[0] and k[1]!=root[1] and dependencies(k,root)]
        client_map={}
        for r in consumers:
            k=(r['environmentId'],r['serviceId']);entry=client_map.setdefault(k,{**target(r),'variables':[],'latestDeployment':deployed.get(k)})
            entry['variables'].append(r['variable'])
        step={'id':'database:'+t['environmentId']+':'+t['serviceId'],'kind':'database','label':' / '.join(t[k] for k in ('project','environment','service')),'engine':engine,'credentialField':field,'target':t,'consumers':list(client_map.values()),'latestDeployment':deployed.get((t['environmentId'],t['serviceId'])),'readiness':'consumer_and_external_access_review_required','externalConsumersReviewed':False,'rotationMethod':'Railway Database → Config → Connection → Regenerate','url':'https://railway.com/project/'+t['projectId']+'/service/'+t['serviceId']+'?environmentId='+t['environmentId']}
        if t['project']=='Atmosphere Account':step['externalConsumerNotes']=['Current Deno deployment may use this database. Coordinate its variables and redeployment before rotation.']
        steps.append(step)
        for k in nodes:
            if k[0]==root[0] and dependencies(k,root):covered.add(k)
        if nodes[root].get('sameValueGroup'):covered_groups.add(nodes[root]['sameValueGroup'])
    groups={}
    for r in rows:
        key=(r['environmentId'],r['serviceId'],r['variable'])
        if key not in covered and r['sensitiveName'] and (r.get('sameValueGroup') or r['sealedOrUnavailable']):
            group=r.get('sameValueGroup') or 'sealed:'+':'.join(str(x) for x in key)
            groups.setdefault(group,[]).append({**target(r),'variable':r['variable'],'path':[]})
        for n in r.get('nestedSecrets',[]):
            group=n['sameValueGroup']
            groups.setdefault(group,[]).append({**target(r),'variable':r['variable'],'path':n['path']})
    for group,locations in groups.items():
        names=' '.join(x['variable'] for x in locations)
        if re.search('ENCRYPTION|ATCASH_WEB_SESSION_KEY',names):kind='encryption_migration';reason='Preserve decryption of stored data with key versioning or re-encryption before retiring the exposed key.'
        elif re.search('PRIVATE.*KEY|SIGNING.*KEY|OAUTH_PRIVATE',names):kind='identity_or_signing_rekey';reason='Update the corresponding public keys, provider trust, or identity records before retiring the exposed private key.'
        elif 'WEBHOOK' in names:kind='webhook';reason='Rotate at the provider and update signature verification, then test event delivery and retire the exposed signing secret.'
        elif 'WAL_ARCHIVE' in names:kind='bucket_consumer_verification';reason='Check each PITR runtime against Railway-reset bucket keys; verify archival before marking complete.'
        elif 'CLICKHOUSE_PASSWORD' in names:kind='custom_database';reason='Rotate the actual ClickHouse user and configuration with every database client; a variable-only edit is insufficient.'
        elif 'SESSION' in names or 'GRAPHQL_OPAQUE' in names:kind='session_invalidation';reason='Check all shared users of the secret and invalidate affected sessions or cursors during the coordinated change.'
        else:kind='coordinated_secret';reason='Map every issuer and consumer, including those outside Railway, before changing matching standalone and JSON fields together.'
        import hashlib
        stable_id=hashlib.sha256(json.dumps(sorted((x['projectId'],x['environmentId'],str(x['serviceId']),x['variable'],json.dumps(x['path'])) for x in locations)).encode()).hexdigest()[:20]
        steps.append({'id':'secret:'+stable_id,'kind':kind,'label':locations[0]['project']+' / '+locations[0]['variable'],'locations':locations,'readiness':'coordination_required','instructions':reason})
    unresolved=[{**target(r),'variable':r['variable']} for r in rows if r.get('credentialUrl') and not r['references'] and (r['environmentId'],r['serviceId'],r['variable']) not in covered]
    steps.append({'id':'review:literal-connections','kind':'audit','label':'Review literal connection strings and external consumers','locations':unresolved,'readiness':'review_required'})
    steps.append({'id':'review:registry-github','kind':'audit','label':'Private registry credentials, GitHub reconnection and old registry-token revocation','readiness':'review_required','instructions':'Confirm all private-image credentials at the provider, including values Railway removed from its UI. Reconnect GitHub and review repository access. Never assume a public image needs a new credential.'})
    steps.append({'id':'review:audit-and-usage','kind':'audit','label':'Review Railway/provider usage, activity and unauthorized persistence','readiness':'review_required'})
    steps.append({'id':'review:unclassified-values','kind':'audit','label':'Classify remaining literal settings, credential URLs, and unusual secret names','readiness':'review_required','locations':[{**target(r),'variable':r['variable']} for r in rows if r.get('hasLiteralValue') and not r['sensitiveName']]})
    steps.append({'id':'review:historical-and-external','kind':'audit','label':'Review removed projects/variables, old deployment secrets, Deno, CI, local tools, and other external consumers','readiness':'review_required'})
    result={'version':3,'inventoryDate':inventory['inventoryDate'],'dnsMigration':'on_hold','exposureAssumption':'Treat all Railway-stored secrets as potentially exposed; affected-account status is not established.','secretValueStorage':'none','scopeCount':len(scopes),'namedSecretLocations':sum(r['sensitiveName'] for r in rows),'nestedSecretLocations':sum(len(r.get('nestedSecrets',[])) for r in rows),'uninspectedScopes':[s['scope'] for s in scopes if 'error' in s],'steps':steps}
    from storage import write
    write('incident-plan.json',result)
    print(json.dumps({'steps':len(steps),'databaseSteps':sum(s['kind']=='database' for s in steps),'otherSecretGroups':len(groups),'dnsMigration':result['dnsMigration']}))

if __name__=='__main__':main()
