from ultralytics import YOLO

# 必须加上这一行判断
if __name__ == '__main__':
    # 加载模型
    model = YOLO("yolo11n.pt")

    # 开始训练
    results = model.train(
        data=r"D:\GraduationProjec\GWF\Metal_inner_wall_defect_detection\yolo_dataset2\data.yaml",
        epochs=100,
        imgsz=640,
        workers=2,
        # --- 针对小数据集的建议参数 ---
        degrees=10.0,  # 旋转角度
        flipud=0.5,  # 上下翻转（内壁检测通常是全向的，上下翻转很有用）
        fliplr=0.5,  # 左右翻转
        mosaic=1.0,  # 开启马赛克增强，把4张图拼成1张
        mixup=0.1
    )
# from ultralytics import YOLO
#
# model = YOLO(r"D:\GraduationProjec\GWF\Metal_inner_wall_defect_detection\yolo_dataset2\runs\detect\train5\weights\best.pt")
#
# # 关键参数：simplify=True 和 imgsz=640
# model.export(format="onnx", imgsz=640, simplify=True, opset=12)

