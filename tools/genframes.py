import struct, zlib, os

def png(path, w, h, rgb):
    r,g,b = rgb
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            # simple vertical band tint so frames look distinct, not flat
            shade = 1.0 - (y / h) * 0.35
            raw += bytes((int(r*shade), int(g*shade), int(b*shade)))
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

d = "/home/user/personal/browser-activity-capture/sample-bundle/frames"
os.makedirs(d, exist_ok=True)
png(f"{d}/0000002500.png", 320, 200, (44, 90, 160))    # login screen
png(f"{d}/0000016000.png", 320, 200, (38, 132, 96))    # order detail
png(f"{d}/0000021000.png", 320, 200, (168, 92, 48))    # refund confirm
print("frames written:", sorted(os.listdir(d)))
