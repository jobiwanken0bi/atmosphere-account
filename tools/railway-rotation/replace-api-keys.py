#!/usr/bin/env python3
"""Owner-run, hidden-input Railway key replacement. Never stores raw secrets."""
import argparse
import datetime
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import warnings

CODE = Path(__file__).resolve().parent
ROOT = CODE / "state"
PLAN = ROOT / "replacement-plan.json"
STATE = ROOT / "replacement-receipts.json"
ENV = os.environ.copy()
ENV.update(RAILWAY_CALLER="skill:use-railway@1.2.0",
           RAILWAY_AGENT_SESSION="railway-skill-20261027-durable-rotation")
for _name in ("RAILWAY_TOKEN", "RAILWAY_API_TOKEN"):
    ENV.pop(_name, None)  # Use the owner's freshly approved CLI sign-in.


class SafeError(Exception):
    pass


def api(query, variables=None):
    """Variables, including secrets, go only through a pipe, never argv or a file."""
    cmd = [shutil.which("railway") or "railway", "api", query, "--compact"]
    payload = None
    if variables is not None:
        cmd += ["--variables", "@-"]
        payload = json.dumps(variables)
    try:
        p = subprocess.run(cmd, input=payload, text=True, capture_output=True,
                           env=ENV, timeout=75)
        if p.returncode:
            raise SafeError("Railway request failed; raw output withheld. Check CLI sign-in/network.")
        result = json.loads(p.stdout)
        if result.get("errors") or "data" not in result:
            raise SafeError("Railway rejected the request; raw response withheld.")
        return result["data"]
    except (subprocess.TimeoutExpired, OSError, ValueError):
        raise SafeError("Railway response unavailable. A write may have applied; check status before retrying.") from None


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(state):
    # Only target IDs, timestamps, one-way API-key fingerprints and status.
    temp = ROOT / ".replacement-receipts.tmp"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(state, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, STATE)


def load_state():
    return json.loads(STATE.read_text()) if STATE.exists() else {"receipts": []}


def deployment(target):
    q = "query($s:String!,$e:String!){serviceInstance(serviceId:$s,environmentId:$e){latestDeployment{id status}}}"
    return api(q, {"s": target["serviceId"], "e": target["environmentId"]})["serviceInstance"]["latestDeployment"]


def preflight(key):
    seen = {}
    for t in key["targets"]:
        cache_key = (t["projectId"], t["environmentId"])
        if cache_key not in seen:
            q = "query($p:String!,$e:String!){project(id:$p){id name environments{edges{node{id name serviceInstances{edges{node{serviceId serviceName deletedAt}}}}}}} environment(id:$e){variables(first:500){edges{node{name serviceId isSealed}} pageInfo{hasNextPage}}}}"
            d = api(q, {"p": t["projectId"], "e": t["environmentId"]})
            if d["project"]["name"] != t["project"]:
                raise SafeError("Project identity changed; stop for inventory reconciliation.")
            es = [e["node"] for e in d["project"]["environments"]["edges"] if e["node"]["id"] == t["environmentId"]]
            if len(es) != 1 or es[0]["name"] != t["environment"]:
                raise SafeError("Environment identity changed; stop for inventory reconciliation.")
            v = d["environment"]["variables"]
            if v["pageInfo"]["hasNextPage"]:
                raise SafeError("Variable metadata needs pagination; stop for inventory reconciliation.")
            seen[cache_key] = (es[0], [e["node"] for e in v["edges"]])
        e, variables = seen[cache_key]
        ss = [s["node"] for s in e["serviceInstances"]["edges"] if s["node"]["serviceId"] == t["serviceId"]]
        if len(ss) != 1 or ss[0]["deletedAt"] or ss[0]["serviceName"] != t["service"]:
            raise SafeError("Service identity changed; stop for inventory reconciliation.")
        for field in key["fields"]:
            vs = [v for v in variables if v["serviceId"] == t["serviceId"] and v["name"] == field]
            if len(vs) != 1 or vs[0]["isSealed"] != t["sealed"][field]:
                raise SafeError("Variable metadata changed; stop for inventory reconciliation.")


def secret_input(field, pattern=None):
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise SafeError("Run this command in your own interactive terminal; hidden input requires a TTY.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        value = getpass.getpass("Paste NEW " + field + " (hidden; Enter to save, blank to skip): ")
    if not value:
        return None
    if len(value) < 16 or len(value) > 16384 or any(c.isspace() or ord(c) < 32 for c in value):
        raise SafeError("Key has an unexpected length or whitespace. Nothing was changed for this item.")
    if value.startswith(("${{", "Bearer ", "http://", "https://", "'", '"', field + "=")):
        raise SafeError("Paste only the credential value, without a variable name, quotes, or URL.")
    if pattern and not re.fullmatch(pattern, value):
        raise SafeError("Key does not match this provider's expected format. Nothing was changed.")
    return value


def check_railway_token(value, target):
    req = urllib.request.Request("https://backboard.railway.com/graphql/v2",
        data=b'{"query":"query { projectToken { id projectId environmentId } }"}',
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "atmosphere-railway-key-rotation/1.0",
                 "project-access-token": value})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise SafeError("Railway token validation returned HTTP " + str(exc.code) +
                        ". Token validity could not be checked; nothing was saved.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SafeError("Network or TLS failure during token validation. Token validity could not be checked; nothing was saved.") from None
    except (ValueError, TypeError):
        raise SafeError("Unexpected response during token validation; nothing was saved.") from None
    if not isinstance(result, dict):
        raise SafeError("Unexpected response during token validation; nothing was saved.")
    if result.get("errors"):
        errors = result["errors"]
        if isinstance(errors, list) and any(isinstance(e, dict) and e.get("message") == "Project Token not found" for e in errors):
            raise SafeError("Railway could not find this project token. Copy the complete NEW token value (not its name or ID); nothing was saved.")
        raise SafeError("Railway returned an API error during token validation; nothing was saved. Raw response withheld.")
    data = result.get("data")
    t = data.get("projectToken") if isinstance(data, dict) else None
    if not isinstance(t, dict) or not all(isinstance(t.get(k), str) and t[k] for k in ("id", "projectId", "environmentId")):
        raise SafeError("Unexpected response during token validation; nothing was saved.")
    if t["projectId"] != target["projectId"] or t["environmentId"] != target["environmentId"]:
        raise SafeError("Token is scoped to a different project or environment. Use ATM Moderation / staging; nothing was saved.")
    if t["id"] == "d2c33cd3-1f58-4f7a-86c9-197244bab7a4":
        raise SafeError("This is the old backup-monitor token. Paste the NEW replacement; nothing was saved.")
    return t["id"]


def check_stripe_key(value, key):
    mode = "live" if value.startswith(("sk_live_", "rk_live_")) else "test" if value.startswith(("sk_test_", "rk_test_")) else None
    if not mode or mode != key.get("expectedStripeMode"):
        raise SafeError("Replacement Stripe key must match the existing " + str(key.get("expectedStripeMode")) + " mode; nothing was saved.")
    t = key["targets"][0]
    # The API returns a collection; inspect only this specific existing credential
    # in memory, never serialize the response or print unrelated secret values.
    current = api("query($p:String!,$e:String!,$s:String){variables(projectId:$p,environmentId:$e,serviceId:$s)}",
                  {"p":t["projectId"],"e":t["environmentId"],"s":t["serviceId"]})["variables"].get("STRIPE_SECRET_KEY")
    if current == value:
        raise SafeError("That is the currently configured exposed Stripe key. Create or roll a NEW replacement; nothing was saved.")
    del current
    req = urllib.request.Request("https://api.stripe.com/v1/account",
        headers={"Authorization":"Bearer " + value, "Accept":"application/json", "User-Agent":"atmosphere-railway-key-rotation/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            account = json.load(response)
    except urllib.error.HTTPError as exc:
        raise SafeError("Stripe account verification returned HTTP " + str(exc.code) + "; nothing was saved. Raw response withheld.") from None
    except Exception:
        raise SafeError("Stripe account verification could not complete; nothing was saved. Raw response withheld.") from None
    if not isinstance(account, dict) or account.get("id") != key.get("expectedStripeAccountId"):
        raise SafeError("Replacement Stripe key belongs to a different account; nothing was saved.")


def replace(key, state):
    if any(r['keyId'] == key['id'] for r in state['receipts']):
        raise SafeError('This credential already has a receipt. Resume the guided workflow; do not paste it again.')
    if not key.get('targets') or key.get('readiness', 'prompt_ready') != 'prompt_ready':
        raise SafeError('This credential needs consumer/provider review before replacement.')
    print("\n" + key["label"])
    if key["url"]:
        print("Create the replacement here: " + key["url"])
    print(key["hint"])
    if key["id"] == "stripe":
        print("Expected Stripe account: " + str(key.get("expectedStripeAccountId")) + "; mode: " + str(key.get("expectedStripeMode")))
    for t in key["targets"]:
        print("  Updates: " + " / ".join(t[x] for x in ("project", "environment", "service")))
    print("  Variables: " + ", ".join(key["fields"]))
    print("Checking target metadata before accepting a replacement...", flush=True)
    preflight(key)
    values = {}
    for field in key["fields"]:
        value = secret_input(field, key.get("pattern"))
        if value is None:
            print("Skipped this item; none of its variables changed.")
            return
        values[field] = value
    token_id = check_railway_token(values[key["fields"][0]], key["targets"][0]) if key["id"] == "railway-monitor" else None
    if key["id"] == "stripe":
        check_stripe_key(values["STRIPE_SECRET_KEY"], key)
    for t in key["targets"]:
        before = deployment(t)
        receipt = {"keyId": key["id"], "label": key["label"], "target": t,
                   "at": now(), "state": "write_pending", "beforeDeployment": before,
                   "fingerprints": {k: hashlib.sha256((v + "\n").encode()).hexdigest() for k, v in values.items()}}
        if token_id:
            receipt["newRailwayTokenId"] = token_id
        state["receipts"].append(receipt)
        save(state)  # Record a possible write before issuing it; don't retry silently.
        try:
            d = api("mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}",
                {"input": {"projectId": t["projectId"], "environmentId": t["environmentId"],
                           "serviceId": t["serviceId"], "replace": False,
                           "skipDeploys": False, "variables": dict(values)}})
            if d.get("variableCollectionUpsert") is not True:
                raise SafeError("Railway did not confirm the update.")
        except Exception:
            receipt["state"] = "write_outcome_unknown"
            save(state)
            raise SafeError("Write outcome uncertain for " + t["service"] + ". Stop; reconcile before retrying. Raw output withheld.") from None
        receipt["state"] = "saved_deployment_pending"
        save(state)
        print("Saved to " + t["service"] + "; redeployment requested.", flush=True)
        try:
            preflight(dict(key, targets=[t]))
            receipt["metadataVerified"] = True
            save(state)
        except Exception:
            receipt["state"] = "saved_metadata_readback_pending"
            save(state)
            raise SafeError("Replacement was saved, but target/sealing metadata read-back needs reconciliation. Stop before revoking the old key.") from None
    values.clear()
    print("Old credentials have NOT been revoked. Runtime and provider checks remain.")


def verify(state, key_id=None):
    # Only the newest receipt for each target/variable controls current verification.
    latest = {}
    for r in state["receipts"]:
        if key_id is not None and r["keyId"] != key_id:
            continue
        t = r["target"]
        latest[(r["keyId"], t["environmentId"], t["serviceId"])] = r
    for r in latest.values():
        t = r["target"]
        d = deployment(t)
        r["latestDeployment"] = d
        name = r["label"] + " → " + t["service"]
        before = r["beforeDeployment"]
        if not d or (before and d["id"] == before["id"]) or d["status"] != "SUCCESS":
            print(name + ": awaiting a successful replacement deployment (" + (d or {}).get("status", "none") + ")")
            continue
        fields = sorted(r["fingerprints"])
        if not all(re.fullmatch(r"[A-Z][A-Z0-9_]*", f) for f in fields):
            raise SafeError("Invalid verification field in receipt.")
        # Key values stay inside the container. SSH returns only one-way digests.
        code = 'for key in ' + ' '.join(fields) + '; do printf "%s " "$key"; printenv "$key" | sha256sum | cut -d" " -f1; done'
        try:
            p = subprocess.run([shutil.which("railway") or "railway", "ssh", "--project", t["projectId"],
                "--environment", t["environmentId"], "--service", t["serviceId"], "--", "sh", "-c", code],
                capture_output=True, text=True, env=ENV, timeout=60)
            hashes = dict(line.split() for line in p.stdout.splitlines()
                          if len(line.split()) == 2 and line.split()[0] in fields and re.fullmatch(r"[0-9a-f]{64}", line.split()[1]))
            matched = p.returncode == 0 and all(hashes.get(f) == r["fingerprints"][f] for f in fields)
        except (subprocess.TimeoutExpired, OSError):
            matched = False
        r["state"] = "runtime_key_verified_provider_check_pending" if matched else "runtime_verification_pending"
        r["verifiedAt"] = now() if matched else None
        print(name + (": running with the pasted replacement; provider check/revocation still pending." if matched else ": runtime match not confirmed; keep old key active."))
    save(state)


def main():
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    from storage import prepare
    prepare()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", help="Replacement ID, e.g. railway-monitor. Otherwise shows a menu.")
    parser.add_argument("--list", action="store_true", help="Show the known provider ceremonies; no network or writes.")
    parser.add_argument("--verify", action="store_true", help="Check deployments and runtime fingerprints; never reads raw key values.")
    parser.add_argument("--status", action="store_true", help="Show replacement receipts without network access.")
    args = parser.parse_args()
    if not (args.list or args.status or args.verify):
        raise SafeError('Use rotate-secrets.py for replacement; it enforces one active credential set.')
    plan = json.loads(PLAN.read_text())["keys"]
    with (ROOT / ".replacement.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SafeError("Another replacement ceremony is open; finish it first.") from None
        state = load_state()
        if args.status:
            for r in state["receipts"]:
                print(r["label"], "/", r["target"]["environment"], "/", r["target"]["service"], ":", r["state"])
            if not state["receipts"]:
                print("No keys have been pasted into this helper yet.")
            return
        if args.verify:
            verify(state)
            return
        if args.list or not args.key:
            for i, key in enumerate(plan, 1):
                print(str(i).rjust(2) + ". " + key["id"] + " — " + key["label"])
            print("Internal service-auth keys require issuer/client coordination; see README.md.")
            if args.list:
                return
            if not sys.stdin.isatty():
                raise SafeError("Use an interactive terminal.")
            choice = input("Choose one number or ID (blank to exit): ").strip()
            if not choice:
                return
            if choice.isdigit() and 1 <= int(choice) <= len(plan):
                args.key = plan[int(choice)-1]["id"]
            else:
                args.key = choice
        matches = [k for k in plan if k["id"] == args.key]
        if len(matches) != 1:
            raise SafeError("Unknown key ID. Use --list.")
        replace(matches[0], state)
        print("\nLater verify with: python3 " + str(Path(__file__).resolve()) + " --verify")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nStopped. Previously confirmed writes remain recorded; no old keys were revoked.", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(str(exc) if isinstance(exc, SafeError) else "Stopped safely; raw exception details withheld to protect credentials.", file=sys.stderr)
        sys.exit(1)
