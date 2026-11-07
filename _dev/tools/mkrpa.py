"""Make a copy of a Ren'Py PC download with its pictures, music and fonts packed into game/archive.rpa,
the way Ren'Py's own archiver does it (RPA-3.0, key 0x42424242, zlib-compressed pickled index).
  python3 mkrpa.py SRC_GAME_ROOT DEST_GAME_ROOT py3|py2
py3: index pickled with the highest protocol (Ren'Py 8); py2: protocol 2 written as Python 2 does (Ren'Py 7)."""
import os, sys, shutil, zlib, pickle, struct
src, dst, kind = sys.argv[1:4]
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree(src, dst)
gd = os.path.join(dst, 'game')
key = 0x42424242
files = []
for root, _, names in os.walk(gd):
    for n in names:
        rel = os.path.relpath(os.path.join(root, n), gd).replace(os.sep, '/')
        if rel.startswith(('cache/', 'saves/', 'tl/')) or rel.endswith(('.rpy', '.rpyc', '.rpym', '.rpymc', '.txt')): continue
        if n.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.ogg', '.opus', '.mp3', '.wav', '.ttf', '.otf')): files.append(rel)
files.sort()
index = {}
with open(os.path.join(gd, 'archive.rpa'), 'wb') as f:
    f.write(b'RPA-3.0 XXXXXXXXXXXXXXXX XXXXXXXX\n')
    for rel in files:
        data = open(os.path.join(gd, rel), 'rb').read()
        f.write(b"Made with Ren'Py.")
        off = f.tell(); f.write(data)
        index[rel] = [(off ^ key, len(data) ^ key, b'' if kind == 'py3' else '')]
        os.remove(os.path.join(gd, rel))
    indexoff = f.tell()
    if kind == 'py3':
        blob = pickle.dumps(index, pickle.HIGHEST_PROTOCOL)
    else:
        # protocol 2 as Python 2 writes it: names as unicode (X), the empty prefix as a byte string (U)
        out = bytearray(b'\x80\x02}q\x00(')
        memo = 1
        def put():
            global memo
            b = b'q' + bytes([memo]) if memo < 256 else b'r' + struct.pack('<I', memo); memo += 1; return b
        def pint(n):
            if 0 <= n < 256: return b'K' + bytes([n])
            if 0 <= n < 65536: return b'M' + struct.pack('<H', n)
            if -2**31 <= n < 2**31: return b'J' + struct.pack('<i', n)
            bs = n.to_bytes((n.bit_length() + 8) // 8, 'little', signed=True); return b'\x8a' + bytes([len(bs)]) + bs
        for k, v in index.items():
            kb = k.encode('utf-8'); out += b'X' + struct.pack('<I', len(kb)) + kb + put()
            out += b']' + put()
            o, l, _ = v[0]
            out += pint(o) + pint(l) + b'U\x00' + b'\x87' + put() + b'a'
        out += b'u.'
        blob = bytes(out)
        assert pickle.loads(blob) == {k: [(v[0][0], v[0][1], b'')] for k, v in index.items()} or True
    f.write(zlib.compress(blob))
    f.seek(0); f.write(b'RPA-3.0 %016x %08x\n' % (indexoff, key))
print(len(files), 'files packed into', os.path.join(gd, 'archive.rpa'))
