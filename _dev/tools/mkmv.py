#!/usr/bin/env python3
"""Makes a playable RPG Maker MV test game from a bare MV project (data + js, as in MikanHako1024's CatchGold test project):
adds index.html, a font, and stand-in pictures and sounds for everything the data refers to. Usage: mkmv.py PROJECT OUT"""
import json, os, sys, shutil, subprocess
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
shutil.rmtree(out, ignore_errors=True); shutil.copytree(src, out)
D = lambda n: json.load(open(os.path.join(out, 'data', n), encoding='utf-8'))
need_img, need_snd = set(), set()
def img(folder, name):
    if name: need_img.add((folder, name))
def snd(folder, a):
    if a and a.get('name'): need_snd.add((folder, a['name']))
S = D('System.json')
img('titles1', S.get('title1Name')); img('titles2', S.get('title2Name'))
for k in ('titleBgm', 'battleBgm'): snd('bgm', S.get(k))
for k in ('victoryMe', 'defeatMe', 'gameoverMe'): snd('me', S.get(k))
for a in S.get('sounds', []): snd('se', a)
for v in ('boat', 'ship', 'airship'):
    x = S.get(v) or {}; img('characters', x.get('characterName')); snd('bgm', x.get('bgm'))
img('battlebacks1', S.get('battleback1Name')); img('battlebacks2', S.get('battleback2Name')); img('sv_enemies', S.get('battlerName')); img('enemies', S.get('battlerName'))
for a in D('Actors.json'):
    if a: img('characters', a.get('characterName')); img('faces', a.get('faceName')); img('sv_actors', a.get('battlerName'))
for t in D('Tilesets.json'):
    if t:
        for i, n in enumerate(t.get('tilesetNames', [])): img('tilesets', n)
for e in D('Enemies.json'):
    if e: img('enemies', e.get('battlerName')); img('sv_enemies', e.get('battlerName'))
for a in D('Animations.json'):
    if a:
        img('animations', a.get('animation1Name')); img('animations', a.get('animation2Name'))
        for t in a.get('timings', []): snd('se', t.get('se'))
for f in os.listdir(os.path.join(out, 'data')):
    if f.startswith('Map') and f != 'MapInfos.json':
        m = D(f); snd('bgm', m.get('bgm')); snd('bgs', m.get('bgs')); img('parallaxes', m.get('parallaxName'))
        img('battlebacks1', m.get('battleback1Name')); img('battlebacks2', m.get('battleback2Name'))
        for ev in m.get('events', []):
            for pg in (ev or {}).get('pages', []): img('characters', (pg.get('image') or {}).get('characterName'))
for n in ('IconSet', 'Balloon', 'Shadow1', 'Shadow2', 'Damage', 'States', 'Weapons1', 'Weapons2', 'Weapons3', 'ButtonSet', 'Window', 'Loading', 'MadeWithMv', 'GameOver'):
    img('system', n)
SIZES = {'tilesets': (768, 768), 'characters': (576, 384), 'faces': (576, 288), 'titles1': (816, 624), 'titles2': (816, 624), 'system': (512, 512)}
for i, (folder, name) in enumerate(sorted(need_img)):
    p = os.path.join(out, 'img', folder, name + '.png')
    if os.path.exists(p): continue
    os.makedirs(os.path.dirname(p), exist_ok=True)
    w, h = SIZES.get(folder, (256, 256))
    if folder == 'system' and name == 'Window': w, h = 192, 192
    im = Image.new('RGBA', (w, h), ((i * 53) % 256, (i * 97) % 256, (i * 31) % 256, 255))
    dr = ImageDraw.Draw(im)
    for k in range(0, max(w, h), 24): dr.line([(k, 0), (0, k)], fill=(255, 255, 255, 120), width=3)
    dr.text((10, 10), name, fill=(255, 255, 255, 255))
    im.save(p)
for folder, name in sorted(need_snd):
    p = os.path.join(out, 'audio', folder, name + '.ogg')
    if os.path.exists(p): continue
    os.makedirs(os.path.dirname(p), exist_ok=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=%s' % ('3' if folder in ('bgm', 'bgs') else '0.3'), '-c:a', 'libvorbis', p], check=True)
os.makedirs(os.path.join(out, 'fonts'), exist_ok=True)
open(os.path.join(out, 'fonts', 'gamefont.css'), 'w').write('@font-face {\n    font-family: GameFont;\n    src: url("mplus-1m-regular.ttf");\n}\n')
font = sys.argv[3] if len(sys.argv) > 3 else None
if font: shutil.copy(font, os.path.join(out, 'fonts', 'mplus-1m-regular.ttf'))
# no skipping the title (the test goes through it)
pj = open(os.path.join(out, 'js', 'plugins.js'), encoding='utf-8').read().replace('"name":"Yami_SkipTitle","status":true', '"name":"Yami_SkipTitle","status":false')
open(os.path.join(out, 'js', 'plugins.js'), 'w', encoding='utf-8').write(pj)
scripts = ['libs/pixi.js', 'libs/pixi-tilemap.js', 'libs/pixi-picture.js', 'libs/fpsmeter.js', 'libs/lz-string.js', 'libs/iphone-inline-video.browser.js', 'rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js', 'rpg_sprites.js', 'rpg_windows.js', 'plugins.js', 'main.js']
open(os.path.join(out, 'index.html'), 'w').write('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<link rel="stylesheet" type="text/css" href="fonts/gamefont.css">\n<title>Catch Gold</title>\n</head>\n<body style="background-color: black">\n' + ''.join('<script type="text/javascript" src="js/%s"></script>\n' % s for s in scripts) + '</body>\n</html>\n')
open(os.path.join(out, 'Game.exe'), 'wb').write(b'MZ')  # a launcher, as in a real deployed game
print(len(need_img), 'pictures,', len(need_snd), 'sounds')
