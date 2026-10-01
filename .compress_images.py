"""一次性脚本：压缩站点大图，减小 GitHub Pages 传输体积。
- PNG 图表：限制最大宽度并做调色板量化（图表类图像视觉无损）
- JPG：质量重编码
仅在本地运行，不参与站点部署（可保留作为可复现记录）。
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
TARGETS = [
    os.path.join(ROOT, "assets", "images", "applied-statistics"),
    os.path.join(ROOT, "assets", "images"),
    os.path.join(ROOT, "campus-map", "img"),
]

MAX_WIDTH = 1600
JPG_QUALITY = 82
MIN_SAVING = 0.05  # 低于 5% 收益则跳过，避免无意义重编码


def human(n):
    return f"{n/1024:.0f}KB" if n < 1024 * 1024 else f"{n/1024/1024:.2f}MB"


def shrink(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        return None
    before = os.path.getsize(path)
    if before < 80 * 1024:
        return None

    with Image.open(path) as im:
        w, h = im.size
        if w > MAX_WIDTH:
            ratio = MAX_WIDTH / w
            im = im.resize((MAX_WIDTH, int(h * ratio)), Image.LANCZOS)

        if ext == ".png":
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(path, "PNG", optimize=True, compress_level=9)
        else:
            if im.mode != "RGB":
                im = im.convert("RGB")
            im.save(path, "JPEG", quality=JPG_QUALITY, optimize=True, progressive=True)

    after = os.path.getsize(path)
    if after < before * (1 - MIN_SAVING):
        return (os.path.relpath(path, ROOT), before, after, before - after)
    return None


def main():
    total_before = total_after = 0
    rows = []
    seen = set()
    for d in TARGETS:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if not os.path.isfile(p) or p in seen:
                continue
            seen.add(p)
            total_before += os.path.getsize(p)
            r = shrink(p)
            if r:
                rows.append(r)
            total_after += os.path.getsize(p)

    print(f"{'文件':<52}{'优化前':>10}{'优化后':>10}{'节省':>10}")
    print("-" * 84)
    for rel, b, a, s in rows:
        print(f"{rel:<52}{human(b):>10}{human(a):>10}{human(s):>10}")
    print("-" * 84)
    print(f"图片总量: {human(total_before)} -> {human(total_after)} "
          f"(节省 {human(total_before - total_after)}, "
          f"{(1 - total_after / total_before) * 100:.1f}%)")


if __name__ == "__main__":
    main()
