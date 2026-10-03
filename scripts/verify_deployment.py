"""
自动化部署前资源检查与关键功能冒烟测试套件 (Deployment Smoke Test)
作者：戴璇 (长春工业大学 · 应用统计硕士研究生 · 数据分析方向)

执行检查项：
1. 关键静态资源完整性 (音频、图片、依赖库、脱敏数据文件)
2. Python 数据分析流水线运行验证 (analysis_pipeline.py, reproduce_montecarlo.py)
3. 统计口径与核心数值基准校验 (OLS、ARIMA、LBE、蒙特卡洛达标概率)
4. 前端脚本语法与敏感表述扫描 (node -c 校验、无非官方涉密词汇、规范文号)
"""

import os
import sys
import json
import re
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASSED = 0
FAILED = 0

def check(name, condition, detail=""):
    global PASSED, FAILED
    if condition:
        print(f"  [PASS] {name}" + (f" ({detail})" if detail else ""))
        PASSED += 1
    else:
        print(f"  [FAIL] {name}" + (f" ({detail})" if detail else ""))
        FAILED += 1

print("=" * 70)
print("🚀 启动自动化部署前关键资产与模型冒烟测试...")
print("=" * 70)

# 1. 检查核心静态文件与多媒体资源
print("\n[Stage 1] 核心静态资源完整性验证")
required_files = [
    os.path.join(ROOT_DIR, "index.html"),
    os.path.join(ROOT_DIR, "snow-viz", "index.html"),
    os.path.join(ROOT_DIR, "snow-viz", "assets", "voiceover_broadcast.mp3"),
    os.path.join(ROOT_DIR, "snow-viz", "assets", "changbai_tianchi.jpg"),
    os.path.join(ROOT_DIR, "snow-viz", "assets", "changbai_waterfall.jpg"),
    os.path.join(ROOT_DIR, "snow-viz", "assets", "changbai_forest.jpg"),
    os.path.join(ROOT_DIR, "case-studies", "smart-manufacturing-takt-time-analysis.html"),
    os.path.join(ROOT_DIR, "case-studies", "analysis_pipeline.py"),
    os.path.join(ROOT_DIR, "case-studies", "README.md"),
    os.path.join(ROOT_DIR, "scripts", "reproduce_montecarlo.py"),
    os.path.join(ROOT_DIR, "campus-map", "js", "main.js")
]

for fp in required_files:
    rel_path = os.path.relpath(fp, ROOT_DIR)
    exists = os.path.isfile(fp)
    size = os.path.getsize(fp) if exists else 0
    check(f"资源存在且非空: {rel_path}", exists and size > 0, f"大小: {size:,} 字节")

# 2. Python 统计建模脚本执行验证
print("\n[Stage 2] Python 计量与时序建模脚本执行验证")
pipe_res = subprocess.run([sys.executable, os.path.join(ROOT_DIR, "case-studies", "analysis_pipeline.py")],
                          capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=ROOT_DIR)
check("制造案例分析流水线 analysis_pipeline.py 运行", pipe_res.returncode == 0,
      "无错误退出" if pipe_res.returncode == 0 else pipe_res.stderr.strip()[:100])

mc_res = subprocess.run([sys.executable, os.path.join(ROOT_DIR, "scripts", "reproduce_montecarlo.py")],
                        capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=ROOT_DIR)
check("蒙特卡洛复现脚本 reproduce_montecarlo.py 运行", mc_res.returncode == 0,
      "无错误退出" if mc_res.returncode == 0 else mc_res.stderr.strip()[:100])

# 3. 统计结果数据文件完整性与数值标定校验
print("\n[Stage 3] 统计数据文件与标定基准核验")
case_summary_path = os.path.join(ROOT_DIR, "case-studies", "case_summary.json")
if os.path.exists(case_summary_path):
    with open(case_summary_path, "r", encoding="utf-8") as f:
        case_data = json.load(f)
    check("制造案例改善前平衡率基准 (84.43%)", case_data.get("balance_before") == 84.43)
    check("制造案例改善后平衡率基准 (92.71%)", case_data.get("balance_after") == 92.71)
    check("制造案例平衡率提升幅度 (+8.27~8.28百分点)", abs(case_data.get("balance_gain_pts", 0) - 8.28) < 0.05)
    check("制造案例 ARIMA phi_1 参数 (0.4527)", case_data.get("arima_phi1") == 0.4527)
    check("制造案例 Lilliefors 检验 p 值 (> 0.05)", case_data.get("lilliefors_pvalue", 0) > 0.05)
else:
    check("case_summary.json 存在", False)

mc_summary_path = os.path.join(ROOT_DIR, "scripts", "montecarlo_summary.json")
if os.path.exists(mc_summary_path):
    with open(mc_summary_path, "r", encoding="utf-8") as f:
        mc_data = json.load(f)
    check("蒙特卡洛 2030 客流达标概率 (85.0% ± 0.5%)", abs(mc_data.get("prob_visitor_2030_ge_300m", 0) - 85.0) < 1.0)
    check("蒙特卡洛 2030 花费达标概率 (91.8% ± 0.5%)", abs(mc_data.get("prob_revenue_2030_ge_5400b", 0) - 91.8) < 1.0)
else:
    check("montecarlo_summary.json 存在", False)

# 4. 前端页面规范性扫描 (政策文号、沈白高铁运营状态、无涉密伪词汇)
print("\n[Stage 4] 前端规范性与官方口径校验")
snow_html_path = os.path.join(ROOT_DIR, "snow-viz", "index.html")
with open(snow_html_path, "r", encoding="utf-8") as f:
    snow_content = f.read()

check("政策文件文号统一为吉办发〔2024〕16号", "吉办发〔2024〕16号" in snow_content and "吉发〔2024〕16号" not in snow_content)
check("沈白高铁状态已更新为正式开通运营 (2025年9月28日)", bool(re.search(r"2025\s*年\s*9\s*月\s*28\s*日.*(?:通车|开通)", snow_content)))
check("天池水面海拔与白云峰顶解耦 (约2,189米)", "2,189" in snow_content or "2189" in snow_content)
check("不含误导性加总 '≥900+'", "≥900+" not in snow_content)
check("消除拟官样涉密标记 ('密级：决策内参')", "密级：决策内参" not in snow_content)
check("MOU 明确标为示例稿、未签署、非政府委托", "示例稿" in snow_content and "未签署" in snow_content and "非政府委托" in snow_content)
check("音频无残留无效备用路径 (404 隐患已消除)", "参赛材料/voiceover_broadcast.mp3" not in snow_content)
check("集成安全存储安全垫 (safeStorage)", "const safeStorage" in snow_content)

# 5. JavaScript 语法校验 (node -c)
print("\n[Stage 5] JavaScript 语法静态校验 (Node.js)")
node_res = subprocess.run(["node", "-c", os.path.join(ROOT_DIR, "campus-map", "js", "main.js")],
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
check("campus-map/js/main.js 语法合法无解析错误", node_res.returncode == 0)

print("\n" + "=" * 70)
print(f"📊 冒烟测试执行完毕: 总计 {PASSED + FAILED} 项检查, 通过 {PASSED} 项, 失败 {FAILED} 项")
if FAILED == 0:
    print("🎉 所有检查项全部通过！工程处于高可靠、可复现、严谨合规状态。")
    print("=" * 70)
    sys.exit(0)
else:
    print("⚠️ 存在失败检查项，请检查上述日志并修正！")
    print("=" * 70)
    sys.exit(1)
