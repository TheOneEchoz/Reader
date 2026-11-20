#!/usr/bin/env python3
"""Cuts the engine out of the app's source (_dev/app.html) into js/*.js, word for word.
   usage: python3 tools/parts.py extract /path/to/app.html     (app -> engine)
          python3 tools/parts.py back    /path/to/app.html     (engine -> app, writes app.html.new)
A part is a list of regions; a region starts at the line that begins with `start` and stops before the line that begins with `stop`
(or at the end of the file for stop=None). Every region is wrapped in  //>> name  and  //<<  marker lines, so `back` can find it."""
import sys, re, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PARTS = json.load(open(os.path.join(HERE, 'parts.json')))

def find(lines, prefix, after=0):
    for i in range(after, len(lines)):
        if lines[i].startswith(prefix): return i
    raise SystemExit('not found: ' + prefix)

def regions(lines):
    for part in PARTS:
        for k, (start, stop) in enumerate(part['regions']):
            a = find(lines, start)
            b = a + int(stop[1:]) if stop and stop[0] == '+' else find(lines, stop, a + 1) if stop else len(lines)
            yield part['file'], f"{part['file']}#{k}", a, b

def extract(app):
    lines = open(app, encoding='utf8').read().split('\n')
    out = {}
    for f, name, a, b in regions(lines):
        body = lines[a:b]
        while body and not body[-1].strip(): body.pop()
        out.setdefault(f, []).append(f'//>> {name}\n' + '\n'.join(body) + '\n//<<\n')
    for f, chunks in out.items():
        head = next(p['about'] for p in PARTS if p['file'] == f)
        open(os.path.join(ROOT, f), 'w', encoding='utf8').write(f'/* {head} */\n' + '\n'.join(chunks))
        print('wrote', f, sum(c.count('\n') for c in chunks), 'lines')

def back(app):
    text = open(app, encoding='utf8').read(); lines = text.split('\n')
    done = 0
    for f, name, a, b in sorted(regions(lines), key=lambda r: -r[2]):
        src = open(os.path.join(ROOT, f), encoding='utf8').read()
        m = re.search(r'^//>> ' + re.escape(name) + r'\n(.*?)^//<<$', src, re.S | re.M)
        if not m: print('missing in engine:', name); continue
        new = m.group(1).rstrip('\n').split('\n')
        old = lines[a:b]; trail = []
        while old and not old[-1].strip(): trail.append(old.pop())
        if new != old: done += 1
        lines[a:b] = new + trail
    open(app + '.new', 'w', encoding='utf8').write('\n'.join(lines))
    print('regions changed:', done, '->', app + '.new')

if __name__ == '__main__':
    {'extract': extract, 'back': back}[sys.argv[1]](sys.argv[2])
