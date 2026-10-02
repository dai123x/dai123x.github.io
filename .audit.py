"""站点体检脚本：扫描所有页面，输出 SEO / 资源 / 性能 / 一致性问题清单。"""
import io
import os
import re
import glob

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES = sorted(glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True))
PAGES = [p for p in PAGES if ".git" not in p]

REQUIRED_META = ["charset", "viewport", "description", "title"]
SITE = "https://daixuan.cloud"


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def check_html(path):
    issues = []
    s = io.open(path, encoding="utf-8").read()
    r = rel(path)

    # --- 基础 meta ---
    html_tag = re.search(r"<html[^>]*>", s)
    if not html_tag or 'lang="' not in html_tag.group(0):
        issues.append(("SEO", "html 缺少 lang 属性"))
    for m in REQUIRED_META:
        if m == "charset" and "charset" not in s:
            issues.append(("SEO", "缺少 charset"))
        elif m == "viewport" and 'name="viewport"' not in s:
            issues.append(("SEO", "缺少 viewport"))
        elif m == "description" and 'name="description"' not in s:
            issues.append(("SEO", "缺少 meta description"))
        elif m == "title" and "<title>" not in s:
            issues.append(("SEO", "缺少 title"))

    # --- canonical / OG ---
    if 'rel="canonical"' not in s:
        issues.append(("SEO", "缺少 canonical"))
    if 'property="og:title"' not in s:
        issues.append(("SEO", "缺少 og:title"))
    if 'name="twitter:card"' not in s:
        issues.append(("SEO", "缺少 twitter:card"))

    # --- 资源引用是否缺失 ---
    refs = set(re.findall(r'(?:src|href)="([^"#][^":]*?)"', s))
    for ref in refs:
        if ref.startswith(("http", "mailto", "data:", "javascript:", "tel:")):
            continue
        if "#" in ref:  # 锚点链接，跳过存在性校验
            continue
        target = os.path.join(os.path.dirname(path), ref.split("?")[0])
        if not os.path.exists(target):
            issues.append(("资源", f"引用不存在: {ref}"))

    # --- 图片懒加载 ---
    imgs = re.findall(r"<img\s[^>]*>", s)
    no_lazy = [i for i in imgs if "loading=" not in i]
    if no_lazy:
        issues.append(("性能", f"{len(no_lazy)}/{len(imgs)} 张图片未设置 loading"))
    no_dim = [i for i in imgs if "width=" not in i or "height=" not in i]
    if no_dim:
        issues.append(("性能", f"{len(no_dim)}/{len(imgs)} 张图片缺少显式尺寸(CLS 风险)"))

    # --- 体积 ---
    size = os.path.getsize(path)
    if size > 150 * 1024:
        issues.append(("性能", f"页面体积过大 {size/1024:.0f}KB"))
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", s, re.S)
    inline = sum(len(x) for x in scripts)
    if inline > 60 * 1024:
        issues.append(("性能", f"内联脚本过大 {inline/1024:.0f}KB（阻塞解析）"))

    # --- 外部脚本是否 defer/async ---
    for tag in re.findall(r"<script[^>]*src=[^>]*>", s):
        if "defer" not in tag and "async" not in tag and "type=" not in tag:
            issues.append(("性能", f"外部脚本未 defer: {tag[:80]}"))

    # --- 硬编码 http / 相对域名 ---
    if "http://daixuan.cloud" in s:
        issues.append(("安全", "存在 http:// 明文链接"))

    return r, size, issues


def check_css_unused():
    """列出 css 中定义但未在任何 HTML 使用的 class（仅供参考）。"""
    css = io.open(os.path.join(ROOT, "css", "style.css"), encoding="utf-8").read()
    classes = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
    used = set()
    for p in PAGES:
        s = io.open(p, encoding="utf-8").read()
        used |= set(re.findall(r'class="([^"]*)"', s))
    used_tokens = set()
    for u in used:
        used_tokens |= set(u.split())
    return sorted(classes - used_tokens)


def main():
    total = 0
    for p in PAGES:
        r, size, issues = check_html(p)
        print(f"\n【{r}】 {size/1024:.1f}KB")
        if not issues:
            print("   ✓ 无问题")
            continue
        for cat, msg in issues:
            print(f"   [{cat}] {msg}")
            total += 1

    print(f"\n{'='*60}\n共 {total} 项待处理\n")

    unused = check_css_unused()
    print(f"CSS 中疑似未使用的 class（{len(unused)} 个，仅供参考，含 JS 动态添加）:")
    print("  " + ", ".join(unused) if unused else "  无")

    # 大文件汇总
    big = []
    for dirpath, _, files in os.walk(ROOT):
        if ".git" in dirpath:
            continue
        for f in files:
            fp = os.path.join(dirpath, f)
            if os.path.getsize(fp) > 400 * 1024:
                big.append((os.path.getsize(fp), rel(fp)))
    big.sort(reverse=True)
    print(f"\n大于 400KB 的文件:")
    for sz, f in big:
        print(f"  {sz/1024:8.1f}KB  {f}")


if __name__ == "__main__":
    main()
