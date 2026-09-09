# 模型权重说明 (models_weights/)

本目录用于存放训练好的 YOLO 权重文件、预训练权重和类别文件。

## 文件清单

| 文件名 | 大小 | 说明 |
|---|---|---|
| `best.pt` | ~5.3 MB | 自训练 YOLO 权重，可直接用于系统推理 |
| `classes.txt` | 13 B | 类别名称，每行一个 |
| `yolo26n.pt` | ~5.3 MB | YOLO26 nano 预训练（用于再训练） |
| `yolo11n.pt` | ~5.4 MB | YOLOv11 nano 预训练（用于再训练） |

> 💡 如果仓库体积受限（如 GitHub LFS 单文件 100 MB 限制），可以将 `yolo26n.pt` / `yolo11n.pt` 通过 Git LFS 或外部网盘管理；`best.pt` 是必带文件。

## 类别说明（默认）

`classes.txt` 内容：

```
凸起
焊缝
```

如需扩展更多类别（如划痕、腐蚀、凹陷），请：

1. 在 `datasets/labelimg/` 中标注新数据。
2. 使用 `tests/yolo数据集格式转化.py` 把 Labelme JSON 转成 YOLO txt。
3. 重新训练：`python tests/train_yolo26.py`。
4. 把新的 `best.pt` 拷到本目录与 `backend/models/`。

## 校验

训练完成后建议用以下命令验证权重完整：

```bash
python -c "from ultralytics import YOLO; m = YOLO('best.pt'); print(m.names)"
```

预期输出：

```python
{0: '凸起', 1: '焊缝'}
```

## 重新训练（参考）

```python
# tests/train_yolo26.py 核心配置（节选）
from ultralytics import YOLO
model = YOLO('yolo26n.pt')
model.train(
    data='datasets/final_dataset/data.yaml',  # ← 换成你的数据集 yaml
    epochs=200,
    imgsz=1280,
    batch=4,
    patience=50,
    device=0,
    workers=12,
    optimizer='MuSGD',
    lr0=0.01,
    flipud=0.5,        # 上下翻转，管道检测重要
    mosaic=0.8,        # Mosaic 增强对小目标有效
    close_mosaic=20,
    amp=True,
    cos_lr=True,
    project='runs/pipe_defect',
    name='yolo26n_exp',
)
```

## 模型元信息（建议每次训练后更新）

- 训练日期: 2026-09
- 训练集大小: 见 `docs/数据集说明.md`
- 验证集 mAP50: 0.92+
- 类别数: 2（凸起 / 焊缝）
- 输入尺寸: 1280×1280
- 推理设备: GPU 0 / CPU 均可