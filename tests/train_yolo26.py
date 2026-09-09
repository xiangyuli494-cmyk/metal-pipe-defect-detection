import warnings

warnings.filterwarnings('ignore')
from ultralytics import YOLO

if __name__ == '__main__':
    # 加载 YOLO26 模型（nano版适合边缘设备，s/m版精度更高）
    # model = YOLO('yolo26n.yaml')  # 可选: yolo26s.yaml, yolo26m.yaml, yolo26l.yaml, yolo26x.yaml

    # 如使用预训练权重（推荐迁移学习）
    model = YOLO('yolo26n.pt')

    # 训练配置
    results = model.train(
        data='D:\GraduationProjec\GWF\yolo26\\ultralytics\\videos\\final_dataset\data.yaml',  # 数据集配置路径
        epochs=200,  # 训练轮次（工业检测建议200-300）
        imgsz=1280,  # 输入尺寸（内窥镜图像可尝试 1280 提升小目标检测）
        batch=4,  # 批次大小（根据显存调整，YOLO26更省显存）
        patience=50,  # 早停耐心值
        device=0,  # GPU设备，cpu或0,1,2...
        workers=12,  # 数据加载线程

        # YOLO26 特色优化配置
        optimizer='MuSGD',  # YOLO26新优化器（或 'Adam', 'AdamW', 'SGD'）
        lr0=0.01,  # 初始学习率（MuSGD建议稍高）
        lrf=0.01,  # 最终学习率系数
        momentum=0.937,  # 动量
        weight_decay=0.0005,  # 权重衰减

        # 损失函数配置（YOLO26移除DFL，使用ProgLoss+STAL）
        box=7.5,  # 边界框损失增益
        cls=0.5,  # 分类损失增益
        dfl=0.0,  # YOLO26已移除DFL，设为0

        # 小目标检测优化（STAL策略）
        nbs=64,  # 名义批次大小
        overlap_mask=True,  # 分割掩码重叠（如做分割）

        # 数据增强（针对管道检测调优）
        hsv_h=0.015,  # 色调（管道环境光照固定）
        hsv_s=0.5,
        hsv_v=0.3,
        translate=0.1,
        scale=0.2,
        shear=5.0,
        perspective=0.001,
        flipud=0.5,  # 上下翻转（管道检测重要）
        fliplr=0.5,
        mosaic=0.8,  # Mosaic增强（小目标有效）
        mixup=0.1,
        copy_paste=0.0,  # 缺陷检测不建议复制粘贴

        # 训练策略
        close_mosaic=20,  # 最后20轮关闭mosaic（稳定训练）
        amp=True,  # 混合精度训练（节省显存）
        cos_lr=True,  # 余弦学习率调度

        # 项目配置
        project='runs/pipe_defect',  # 项目保存路径
        name='yolo26n_exp2',  # 实验名称
        exist_ok=False,  # 覆盖已存在实验

        # 验证与保存
        val=True,  # 训练时验证
        save=True,  # 保存模型
        save_period=10,  # 每10轮保存检查点

        # 日志
        verbose=True,  # 详细输出
        seed=42,  # 随机种子（保证可复现）
    )

    # 验证最佳模型
    metrics = model.val()
    print(f"mAP50-95: {metrics.box.map}")
    print(f"mAP50: {metrics.box.map50}")