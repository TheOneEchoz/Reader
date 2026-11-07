#!/usr/bin/env python3
"""Builds the website from app.html + changelog.json.
   python3 build.py beta     -> ../beta/ (the site's experimental folder)   (experimental: every changelog entry, EXP features on)
   python3 build.py stable   -> ../ (the site's root)        (normal: entries marked "beta" left out)
   python3 build.py beta OUT -> OUT/ (for testing)
The version is the newest changelog entry the channel shows. Other files (scripts, icons, wasm) are copied from
the existing site folder unless they already exist in OUT."""
import json, os, re, shutil, sys
ch = sys.argv[1]; assert ch in ('beta', 'stable')
here = os.path.dirname(os.path.abspath(__file__))
site = os.path.join(here, '..') if os.path.isdir(os.path.join(here, '..', 'beta')) else os.path.join(here, '..', 'reader')  # the website: this repo's root
out = sys.argv[2] if len(sys.argv) > 2 else (os.path.join(site, 'beta') if ch == 'beta' else site)
src = open(os.path.join(here, 'app.html'), encoding='utf-8').read()
log = json.load(open(os.path.join(here, 'changelog.json'), encoding='utf-8'))
if ch == 'stable': log = [c for c in log if not c.get('beta')]
top = log[0]; v = top['v']
assert bool(top.get('beta')) == (ch == 'beta'), 'the newest changelog entry must match the channel'
def rep(pat, new):
    global src
    src, n = re.subn(pat, lambda m: new, src, count=1, flags=re.S); assert n == 1, pat
rep(r"const APP_VERSION = 0; //", f"const APP_VERSION = {v}; //")
rep(r"const CHANGELOG = \[\]; // replaced", "const CHANGELOG = " + json.dumps(log, ensure_ascii=False) + "; // replaced")
rep(r"const APP_CHANNEL = 'stable'; //", f"const APP_CHANNEL = '{ch}'; //")
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(src)
# shared files: take them from the site folder of the same channel if missing
base = os.path.join(site, 'beta') if ch == 'beta' else site
shell = ['Sortable.min.js', 'apple-touch-icon.png', 'capacitor.js', 'icon-192.png', 'icon-512.png', 'jbig2.wasm', 'jsQR.js', 'jszip.min.js',
         'manifest.webmanifest', 'maskable-512.png', 'openjpeg.wasm', 'p2p.js', 'pdf.min.js', 'pdf.worker.min.js', 'qcms_bg.wasm', 'qrcode.js']
extra = os.path.join(here, 'files')  # new or changed shared files live here
for f in shell + (os.listdir(extra) if os.path.isdir(extra) else []):
    dst = os.path.join(out, f)
    if os.path.isdir(extra) and os.path.exists(os.path.join(extra, f)): shutil.copy(os.path.join(extra, f), dst)
    elif not os.path.exists(dst) and os.path.abspath(base) != os.path.abspath(out): shutil.copy(os.path.join(base, f), dst)
files = sorted(set(shell + (os.listdir(extra) if os.path.isdir(extra) else []) + ['index.html']))
pre = 'tankobon-beta-' if ch == 'beta' else 'tankobon-v'
sw = open(os.path.join(here, 'sw.js'), encoding='utf-8').read()
sw = sw.replace('__CACHE__', f"{'tankobon-beta-v' if ch == 'beta' else 'tankobon-v'}{v}").replace('__PREFIX__', pre)
sw = sw.replace('__SHELL__', ', '.join("'./" + f + "'" for f in ['', 'index.html'] + [f for f in files if f != 'index.html']).replace("'./'", "'./'"))
open(os.path.join(out, 'sw.js'), 'w', encoding='utf-8').write(sw)
json.dump({'version': v, 'name': top['name'], 'channel': ch, 'files': files, 'notes': top['items']}, open(os.path.join(out, 'version.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if ch == 'stable' and os.path.abspath(out) == os.path.abspath(site):
    shutil.copy(os.path.join(here, 'changelog.json'), os.path.join(site, 'changelog.json'))
print(f'{ch} {top["name"]} (v{v}) -> {out}')
