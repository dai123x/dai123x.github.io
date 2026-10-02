"""深度代码审查：安全性 / 可访问性 / 一致性 / 代码质量 / 重复定义。"""
import io
import os
import re
import glob
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES = [p for p in sorted(glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True)) if ".git" not in p]


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def main():
    all_sources = {}
    for p in PAGES:
        all_sources[p] = io.open(p, encoding="utf-8").read()
    js_files = [p for p in glob.glob(os.path.join(ROOT, "**", "*.js"), recursive=True)
                if ".git" not in p and "three.min" not in p and "OrbitControls" not in p
                and "EffectComposer" not in p and "ShaderPass" not in p
                and "RenderPass" not in p and "UnrealBloom" not in p
                and "CopyShader" not in p and "LuminosityHighPass" not in p]
    for p in js_files:
        all_sources[p] = io.open(p, encoding="utf-8").read()
    css_files = [p for p in glob.glob(os.path.join(ROOT, "**", "*.css"), recursive=True) if ".git" not in p]
    for p in css_files:
        all_sources[p] = io.open(p, encoding="utf-8").read()

    print("=" * 66)
    print("1. 安全性：外链 target=_blank 缺少 rel=noopener")
    found = False
    for p, s in all_sources.items():
        for m in re.finditer(r'<a\s[^>]*target="_blank"[^>]*>', s):
            if "noopener" not in m.group(0):
                print(f"   {rel(p)}: {m.group(0)[:100]}")
                found = True
    if not found:
        print("   ✓ 全部已带 noopener")

    print("\n2. 可访问性：交互元素缺少可访问名称")
    for p in PAGES:
        s = all_sources[p]
        for m in re.finditer(r"<(button|a)\s([^>]*)>", s):
            tag, attrs = m.group(1), m.group(2)
            text_end = s.find("</" + tag + ">", m.end())
            inner = s[m.end():text_end] if text_end != -1 else ""
            text = re.sub(r"<[^>]+>", "", inner).strip()
            has_label = ('aria-label=' in attrs or 'aria-labelledby=' in attrs
                         or text or 'title=' in attrs)
            if not has_label:
                print(f"   {rel(p)}: <{tag} {attrs[:90]}>")

    print("\n3. 重复 id（同一页面内）")
    for p in PAGES:
        s = all_sources[p]
        ids = re.findall(r'\sid="([^"]+)"', s)
        dup = [k for k, v in Counter(ids).items() if v > 1]
        if dup:
            print(f"   {rel(p)}: {dup}")

    print("\n4. 内联 style 使用量（可维护性）")
    for p in PAGES:
        s = all_sources[p]
        n = len(re.findall(r'\sstyle="', s))
        if n:
            print(f"   {rel(p)}: {n} 处内联 style")

    print("\n5. 调试残留（console.log / debugger / TODO）")
    for p, s in all_sources.items():
        for pat in (r"console\.(log|debug|warn)\(", r"\bdebugger\b", r"TODO|FIXME|XXX"):
            for m in re.finditer(pat, s):
                line = s[:m.start()].count("\n") + 1
                print(f"   {rel(p)}:{line}  {m.group(0)[:40]}")

    print("\n6. CSS 重复定义（同选择器多次出现）")
    for p in css_files:
        s = all_sources[p]
        sels = []
        for m in re.finditer(r"([^{}]+)\{", s):
            sel = m.group(1).strip()
            sel = re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip()
            if sel and not sel.startswith("@"):
                sels.append(sel)
        dup = {k: v for k, v in Counter(sels).items() if v > 1}
        dup.pop("", None)
        if dup:
            print(f"   {rel(p)}:")
            for k, v in sorted(dup.items(), key=lambda x: -x[1])[:12]:
                print(f"      {v}x  {k[:70]}")

    print("\n7. 硬编码颜色（未走 CSS 变量）")
    for p in css_files:
        s = all_sources[p]
        hexes = re.findall(r"#[0-9a-fA-F]{3,8}\b", s)
        n = len(hexes)
        print(f"   {rel(p)}: {n} 处（其中 var() 之外的直接色值）")

    print("\n8. 页面一致性：导航与主站是否一致")
    main_nav = re.findall(r'<li><a href="#([^"]+)"', all_sources[os.path.join(ROOT, "index.html")])
    print(f"   主站导航锚点: {main_nav}")
    for p in PAGES:
        if rel(p) == "index.html":
            continue
        s = all_sources[p]
        back = re.findall(r'href="(?:\.\./|\.\./index\.html|index\.html)[^"]*"', s)
        print(f"   {rel(p)}: 返回主站链接 {len(back)} 处")

    print("\n9. 移动端细节")
    for p in PAGES:
        s = all_sources[p]
        vp = re.search(r'<meta name="viewport" content="([^"]*)"', s)
        issues = []
        if vp and "viewport-fit" not in vp.group(1):
            issues.append("viewport 缺 viewport-fit=cover（刘海屏安全区）")
        if "user-scalable=no" in (vp.group(1) if vp else ""):
            issues.append("禁用缩放（可访问性不佳）")
        if issues:
            print(f"   {rel(p)}: {'; '.join(issues)}")

    print("\n10. 图片 alt 缺失或占位")
    for p in PAGES:
        s = all_sources[p]
        for m in re.finditer(r"<img\s([^>]*)>", s):
            attrs = m.group(1)
            alt = re.search(r'alt="([^"]*)"', attrs)
            if not alt:
                print(f"   {rel(p)}: 无 alt -> {attrs[:80]}")
            elif alt.group(1) in ("", "image", "图片", "photo"):
                print(f"   {rel(p)}: 占位 alt -> {attrs[:80]}")


if __name__ == "__main__":
    main()
