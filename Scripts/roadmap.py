#!/usr/bin/env python3
"""Roadmap status for map #131: beats in order, their spec, blockers, open tickets, and open decisions."""
import json, re, subprocess
def gh(*a): return subprocess.run(["gh",*a],capture_output=True,text=True,check=True).stdout
def key(t):
    m=re.match(r"beat\((\d+)([a-z]?)\)",t); return (int(m.group(1)), m.group(2))
beats=json.loads(gh("issue","list","--label","beat","--state","all","--limit","50","--json","number,title,state"))
beats.sort(key=lambda b:key(b["title"]))
allopen=json.loads(gh("issue","list","--state","open","--limit","200","--json","number,title,labels,assignees,body"))
specs=json.loads(gh("issue","list","--state","all","--limit","100","--search","spec in:title","--json","number,title,state,body"))
def spec_for(b):
    k="".join(map(str,key(b["title"])))
    return [s for s in specs if re.search(rf"beat\s*\(?{k}\)?\b", s["title"], re.I) or f"#{b['number']}" in (s["body"] or "")]
for b in beats:
    n=b["number"]
    if b["state"]=="CLOSED": print(f"✓ #{n} {b['title']}"); continue
    dep=json.loads(gh("api",f"repos/tacomancy/vitrine/issues/{n}","--jq",".issue_dependencies_summary") or "{}")
    bb=dep.get("blocked_by",0)
    print(f"{'▶' if bb==0 else '·'} #{n} {b['title']}" + ("" if bb==0 else f"  — blocked by {bb}"))
    for s in spec_for(b): print(f"     spec #{s['number']} ({s['state'].lower()}): {s['title']}")
print("\nTickets in flight (open, not a beat, not a wayfinder decision):")
for i in allopen:
    names=[l["name"] for l in i["labels"]]
    if "beat" in names or any(x.startswith("wayfinder:") for x in names): continue
    if i["title"].startswith("spec("): continue
    print(f"  #{i['number']} {i['title']}" + ("  [claimed]" if i["assignees"] else ""))
print("\nWayfinder decisions still open:")
for c in json.loads(gh("api","repos/tacomancy/vitrine/issues/131/sub_issues")):
    if c["state"]=="open": print(f"  #{c['number']} {c['title']}  blocked_by={c['issue_dependencies_summary']['blocked_by']}")
