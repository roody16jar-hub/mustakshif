"""Write PNG app icons without any image library: dark rounded square, green ring and dot."""
import os, struct, zlib
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(os.path.dirname(HERE), "icons")

def png(size):
    bg, fg = (15, 23, 42), (34, 197, 94); c = size / 2; r = size * 0.29; ring = size * 0.055; dot = size * 0.08; rad = size * 0.19
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx, dy = x - c, y - c; d = (dx * dx + dy * dy) ** 0.5
            # rounded corners -> transparent
            cx = min(max(x, rad), size - rad); cy = min(max(y, rad), size - rad)
            if (x - cx) ** 2 + (y - cy) ** 2 > rad * rad: row += bytes((0, 0, 0, 0)); continue
            col = bg
            if abs(d - r) <= ring / 2 or d <= dot: col = fg
            elif (abs(dx) <= ring / 2 and r + ring < d <= r + ring * 2.6) or (abs(dy) <= ring / 2 and r + ring < d <= r + ring * 2.6): col = fg
            row += bytes(col) + b"\xff"
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

for s in (180, 192, 512):
    open(os.path.join(OUT, f"icon-{s}.png"), "wb").write(png(s)); print("icon", s)
