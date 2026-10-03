r"""
吉林省冰雪经济目标预测：几何布朗运动 (GBM) 蒙特卡洛 10,000 次随机模拟复现脚本
作者：戴璇 (长春工业大学 · 应用统计硕士研究生 · 数据分析方向)

数理模型定义：
几何布朗运动 (Geometric Brownian Motion, GBM):
    dS_t = \mu * S_t * dt + \sigma * S_t * dW_t
解析解：
    S_t = S_0 * exp( (\mu - 0.5 * \sigma^2) * t + \sigma * W_t )
其中 W_t ~ N(0, t)，\mu 为年化漂移率，\sigma 为年化波动率。

基准参数设定：
1. 游客人次序列：S_0 = 1.25 亿人次 (2023—2024 雪季实绩)
   - 2027—2028 雪季中期目标：2.30 亿人次
   - 2029—2030 雪季最终目标：3.00 亿人次
2. 旅游花费序列：S_0 = 2,419 亿元 (2023—2024 雪季实绩)
   - 2027—2028 雪季中期目标：4,200 亿元
   - 2029—2030 雪季最终目标：5,400 亿元
3. 模拟设定：
   - 年化漂移率 \mu = 0.184 (18.4%)
   - 年化波动率 \sigma = 0.082 (8.2%)
   - 随机种子 seed = 42
   - 模拟路径数 N = 10,000
   - 时间跨度 T = 6 年 (2024—2030, dt = 1.0)
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from scipy.stats import norm

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# 1. 参数定义
SEED = 42
N_PATHS = 10000
MU = 0.184
SIGMA = 0.082
YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030]
DT = 1.0
T_STEPS = len(YEARS) - 1

S0_VIS = 1.25      # 亿人次
S0_REV = 2419.0    # 亿元

TARGET_2028_VIS = 2.30
TARGET_2030_VIS = 3.00
TARGET_2028_REV = 4200.0
TARGET_2030_REV = 5400.0

# 2. 蒙特卡洛随机模拟 (固定种子)
np.random.seed(SEED)

paths_vis = np.zeros((N_PATHS, T_STEPS + 1))
paths_rev = np.zeros((N_PATHS, T_STEPS + 1))
paths_vis[:, 0] = S0_VIS
paths_rev[:, 0] = S0_REV

for step in range(1, T_STEPS + 1):
    z_vis = np.random.normal(0, 1, N_PATHS)
    z_rev = np.random.normal(0, 1, N_PATHS)
    
    # 离散步长步进 (Exact GBM discretization)
    drift = (MU - 0.5 * SIGMA**2) * DT
    diff_vis = SIGMA * np.sqrt(DT) * z_vis
    diff_rev = SIGMA * np.sqrt(DT) * z_rev
    
    paths_vis[:, step] = paths_vis[:, step - 1] * np.exp(drift + diff_vis)
    paths_rev[:, step] = paths_rev[:, step - 1] * np.exp(drift + diff_rev)

# 3. 分位数与理论解析分位数计算
quantiles = [0.10, 0.25, 0.50, 0.75, 0.90]
rows = []

print("=== 1. 蒙特卡洛 10,000 次模拟客流预测分位数表 (亿人次) ===")
print("年份 | P10(悲观) | P25(下四分) | P50(中枢) | P75(上四分) | P90(乐观) | 理论解析P50")
print("-" * 75)

for idx, yr in enumerate(YEARS):
    t = yr - 2024
    emp_q = np.percentile(paths_vis[:, idx], [q * 100 for q in quantiles])
    
    if t == 0:
        ana_p50 = S0_VIS
    else:
        ana_p50 = S0_VIS * np.exp((MU - 0.5 * SIGMA**2) * t + SIGMA * np.sqrt(t) * norm.ppf(0.50))
    
    print(f"{yr} | {emp_q[0]:8.2f} | {emp_q[1]:9.2f} | {emp_q[2]:8.2f} | {emp_q[3]:9.2f} | {emp_q[4]:8.2f} | {ana_p50:9.2f}")
    
    prob_vis_str = "—"
    prob_rev_str = "—"
    if yr == 2028:
        p_vis_2028 = np.mean(paths_vis[:, idx] >= TARGET_2028_VIS) * 100
        p_rev_2028 = np.mean(paths_rev[:, idx] >= TARGET_2028_REV) * 100
        prob_vis_str = f"P(≥2.3亿) = {p_vis_2028:.1f}%"
        prob_rev_str = f"P(≥4200亿) = {p_rev_2028:.1f}%"
    elif yr == 2030:
        p_vis_2030 = np.mean(paths_vis[:, idx] >= TARGET_2030_VIS) * 100
        p_rev_2030 = np.mean(paths_rev[:, idx] >= TARGET_2030_REV) * 100
        prob_vis_str = f"P(≥3.0亿) = {p_vis_2030:.1f}%"
        prob_rev_str = f"P(≥5400亿) = {p_rev_2030:.1f}%"

    rows.append({
        "年份": yr,
        "P10_悲观": round(float(emp_q[0]), 2),
        "P25_下四分": round(float(emp_q[1]), 2),
        "P50_中枢": round(float(emp_q[2]), 2),
        "P75_上四分": round(float(emp_q[3]), 2),
        "P90_乐观": round(float(emp_q[4]), 2),
        "客流政策达标概率": prob_vis_str,
        "花费政策达标概率": prob_rev_str
    })

# 4. 政策达标置信度汇总
prob_vis_2028 = np.mean(paths_vis[:, 4] >= TARGET_2028_VIS) * 100
prob_vis_2030 = np.mean(paths_vis[:, 6] >= TARGET_2030_VIS) * 100
prob_rev_2028 = np.mean(paths_rev[:, 4] >= TARGET_2028_REV) * 100
prob_rev_2030 = np.mean(paths_rev[:, 6] >= TARGET_2030_REV) * 100

print("\n=== 2. 政策目标达成概率量化总结 ===")
print(f"2027—2028 雪季客流目标 (≥ 2.30 亿人次) 达成概率: {prob_vis_2028:.1f}%")
print(f"2029—2030 雪季客流目标 (≥ 3.00 亿人次) 达成概率: {prob_vis_2030:.1f}%")
print(f"2027—2028 雪季花费目标 (≥ 4,200 亿元) 达成概率: {prob_rev_2028:.1f}%")
print(f"2029—2030 雪季花费目标 (≥ 5,400 亿元) 达成概率: {prob_rev_2030:.1f}%")

# 5. 导出数据结果
df_res = pd.DataFrame(rows)
base_dir = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(base_dir, "montecarlo_quantiles.csv")
json_path = os.path.join(base_dir, "montecarlo_summary.json")

df_res.to_csv(csv_path, index=False, encoding='utf-8-sig')

summary_data = {
    "model": "Geometric Brownian Motion (GBM)",
    "formula": "dS_t = mu * S_t * dt + sigma * S_t * dW_t",
    "seed": SEED,
    "n_simulations": N_PATHS,
    "annual_drift_mu": MU,
    "annual_volatility_sigma": SIGMA,
    "base_visitor_2024": S0_VIS,
    "base_revenue_2024": S0_REV,
    "prob_visitor_2028_ge_230m": round(prob_vis_2028, 2),
    "prob_visitor_2030_ge_300m": round(prob_vis_2030, 2),
    "prob_revenue_2028_ge_4200b": round(prob_rev_2028, 2),
    "prob_revenue_2030_ge_5400b": round(prob_rev_2030, 2),
    "quantiles_visitor": rows
}

with open(json_path, "w", encoding="utf-8") as f:
    json.dump(summary_data, f, ensure_ascii=False, indent=2)

print(f"\n复现数据已导出：\n1. {csv_path}\n2. {json_path}")
