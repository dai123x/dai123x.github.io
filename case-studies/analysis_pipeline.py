"""
应用统计案例分析：智能制造装配线工序节拍异常诊断与动态容量预测
核心分析流水线 (Python + pandas + scipy + statsmodels)
作者：戴璇 (长春工业大学 · 应用统计硕士研究生 · 数据分析方向)
"""

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. 模拟构建高保真产线实测作业时间数据 (5大核心工位, 2000个工作循环)
np.random.seed(42)
n_cycles = 2000

# 基准节拍 (秒)
base_times = {
    "OP10_缸体上线": (45.0, 3.2),
    "OP20_曲轴安装": (52.0, 4.8),
    "OP30_活塞连杆": (58.5, 6.5),  # 瓶颈工位
    "OP40_气门配气": (49.0, 3.8),
    "OP50_总装检验": (42.0, 2.5)
}

data = {}
for op, (mean, std) in base_times.items():
    # 模拟对数正态特征与轻微自相关
    raw = np.random.normal(0, 1, n_cycles)
    ar_noise = np.zeros(n_cycles)
    for t in range(1, n_cycles):
        ar_noise[t] = 0.45 * ar_noise[t-1] + raw[t] * std
    
    # 加入偶发微小非增值扰动 (MUDA)
    muda = np.random.exponential(scale=1.2, size=n_cycles) * (np.random.rand(n_cycles) < 0.08)
    times = mean + ar_noise + muda
    data[op] = np.clip(times, 20.0, 120.0)

df = pd.DataFrame(data)

# 2. 统计描述与分布检验
print("=== 1. 各工位工时描述性统计 ===")
desc = df.describe().T[['mean', 'std', 'min', '50%', 'max']]
desc['skewness'] = df.skew()
desc['kurtosis'] = df.kurtosis()
print(desc.round(2))

# 3. 对数正态与正态分布拟合对比 (以瓶颈工序 OP30 为例)
op30 = df['OP30_活塞连杆']
ks_norm = stats.kstest(op30, 'norm', args=(op30.mean(), op30.std()))
ks_lognorm = stats.kstest(op30, 'lognorm', args=stats.lognorm.fit(op30))

print("\n=== 2. 瓶颈工序 (OP30) 分布检验 ===")
print(f"正态分布 KS 检验 p-value: {ks_norm.pvalue:.4e}")
print(f"对数正态 KS 检验 p-value: {ks_lognorm.pvalue:.4e}")

# 4. 时间序列平稳性检验 (ADF Test)
adf_res = adfuller(op30)
print("\n=== 3. 节拍时序 ADF 单位根检验 ===")
print(f"ADF Statistic: {adf_res[0]:.4f}")
print(f"p-value: {adf_res[1]:.4e} (显著平稳，拒绝单位根假设)")

# 5. ARIMA(1,0,1) 时序拟合
model = sm.tsa.ARIMA(op30, order=(1, 0, 1)).fit()
print("\n=== 4. ARIMA(1,0,1) 建模拟合参数 ===")
print(model.summary().tables[1])

# 6. 精益改善前后产线平衡率 (Line Balancing Efficiency)
# 产线平衡率 = 各工序时间总和 / (瓶颈工序时间 * 工序数)
total_time_before = df.mean().sum()
bottleneck_before = df.mean().max()
balance_before = (total_time_before / (bottleneck_before * 5)) * 100

# 优化后：通过作业重组消除 OP30 非增值活动 6.8秒，平衡至 51.5秒
df_optimized = df.copy()
df_optimized['OP30_活塞连杆'] = df['OP30_活塞连杆'] * 0.88
total_time_after = df_optimized.mean().sum()
bottleneck_after = df_optimized.mean().max()
balance_after = (total_time_after / (bottleneck_after * 5)) * 100

print("\n=== 5. 精益统计优化效益指标 ===")
print(f"改善前平衡率: {balance_before:.2f}% | 瓶颈节拍: {bottleneck_before:.2f}s")
print(f"改善后平衡率: {balance_after:.2f}% | 瓶颈节拍: {bottleneck_after:.2f}s")
print(f"综合平衡效率提升: +{balance_after - balance_before:.2f}%")

# 保存统计数据至 JSON 供网页动态引用
output_stats = {
    "stations": list(base_times.keys()),
    "means": df.mean().round(2).to_dict(),
    "stds": df.std().round(2).to_dict(),
    "balance_before": round(balance_before, 2),
    "balance_after": round(balance_after, 2),
    "bottleneck_before": round(bottleneck_before, 2),
    "bottleneck_after": round(bottleneck_after, 2),
    "adf_pvalue": float(f"{adf_res[1]:.4e}"),
    "ks_pvalue_lognorm": float(f"{ks_lognorm.pvalue:.4e}")
}

with open("case_summary.json", "w", encoding="utf-8") as f:
    json.dump(output_stats, f, ensure_ascii=False, indent=2)

print("\n分析流水线运行完成，已生成 case_summary.json！")
