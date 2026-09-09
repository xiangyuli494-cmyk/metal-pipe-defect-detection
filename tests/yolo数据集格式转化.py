#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将snapshots文件夹中的标注数据转换为YOLOv11格式
"""

import os
import json
import shutil
from pathlib import Path

def convert_bbox_to_yolo(bbox_points, img_width, img_height):
    """
    将矩形框坐标转换为YOLO格式
    bbox_points: [[x1, y1], [x2, y2], [x3, y3], [x4, y4]] 矩形的四个点
    返回: (x_center, y_center, width, height) 归一化坐标
    """
    # 提取x和y坐标
    x_coords = [point[0] for point in bbox_points]
    y_coords = [point[1] for point in bbox_points]
    
    # 计算边界框
    x_min = min(x_coords)
    x_max = max(x_coords)
    y_min = min(y_coords)
    y_max = max(y_coords)
    
    # 计算中心点和宽高
    x_center = (x_min + x_max) / 2
    y_center = (y_min + y_max) / 2
    width = x_max - x_min
    height = y_max - y_min
    
    # 归一化
    x_center_norm = x_center / img_width
    y_center_norm = y_center / img_height
    width_norm = width / img_width
    height_norm = height / img_height
    
    return x_center_norm, y_center_norm, width_norm, height_norm

def create_yolo_dataset():
    """创建YOLO格式的数据集"""
    
    # 创建目录结构
    dataset_dir = Path("final_dataset")
    dataset_dir.mkdir(exist_ok=True)
    
    # 创建子目录
    (dataset_dir / "images" / "train").mkdir(parents=True, exist_ok=True)
    (dataset_dir / "images" / "val").mkdir(parents=True, exist_ok=True)
    (dataset_dir / "labels" / "train").mkdir(parents=True, exist_ok=True)
    (dataset_dir / "labels" / "val").mkdir(parents=True, exist_ok=True)
    
    # 类别映射
    class_mapping = {
        "凸起": 0,
        "焊缝": 1
    }
    
    # 处理snapshots文件夹中的文件
    snapshots_dir = Path("imges")
    json_files = list(snapshots_dir.glob("*.json"))
    
    print(f"找到 {len(json_files)} 个JSON标注文件")
    
    # 分割数据集 (80% 训练, 20% 验证)
    train_count = int(len(json_files) * 0.8)
    
    processed_count = 0
    
    for i, json_file in enumerate(json_files):
        try:
            # 读取JSON标注文件
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 获取对应的图片文件
            image_name = data.get('imagePath', '')
            if not image_name:
                print(f"警告: {json_file} 中没有找到imagePath")
                continue
                
            image_path = snapshots_dir / image_name
            if not image_path.exists():
                print(f"警告: 图片文件不存在: {image_path}")
                continue
            
            # 确定是训练集还是验证集
            if i < train_count:
                split = "train"
            else:
                split = "val"
            
            # 复制图片文件
            dest_image_path = dataset_dir / "images" / split / image_name
            shutil.copy2(image_path, dest_image_path)
            
            # 创建YOLO格式的标注文件
            txt_name = Path(image_name).stem + ".txt"
            label_path = dataset_dir / "labels" / split / txt_name
            
            # 获取图片尺寸
            img_width = data.get('imageWidth', 640)
            img_height = data.get('imageHeight', 480)
            
            # 转换标注
            yolo_annotations = []
            shapes = data.get('shapes', [])
            
            for shape in shapes:
                if shape.get('shape_type') != 'rectangle':
                    continue
                    
                label = shape.get('label', '')
                if label not in class_mapping:
                    print(f"警告: 未知类别 '{label}' 在文件 {json_file}")
                    continue
                
                class_id = class_mapping[label]
                points = shape.get('points', [])
                
                if len(points) != 4:
                    print(f"警告: 矩形框点数不正确 ({len(points)}) 在文件 {json_file}")
                    continue
                
                # 转换为YOLO格式
                x_center, y_center, width, height = convert_bbox_to_yolo(
                    points, img_width, img_height
                )
                
                yolo_annotations.append(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}")
            
            # 写入标注文件
            with open(label_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(yolo_annotations))
            
            processed_count += 1
            if processed_count % 10 == 0:
                print(f"已处理 {processed_count}/{len(json_files)} 个文件")
                
        except Exception as e:
            print(f"处理文件 {json_file} 时出错: {e}")
            continue
    
    # 创建数据集配置文件
    config_content = f"""# YOLOv11 数据集配置文件
path: {dataset_dir.absolute()}  # 数据集根目录
train: images/train  # 训练图片路径 (相对于path)
val: images/val      # 验证图片路径 (相对于path)

# 类别
nc: {len(class_mapping)}  # 类别数量
names: {list(class_mapping.keys())}  # 类别名称
"""
    
    config_path = dataset_dir / "data.yaml"
    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(config_content)
    
    print(f"\n转换完成!")
    print(f"总共处理了 {processed_count} 个文件")
    print(f"训练集: {train_count} 个文件")
    print(f"验证集: {len(json_files) - train_count} 个文件")
    print(f"数据集保存在: {dataset_dir.absolute()}")
    print(f"配置文件: {config_path.absolute()}")
    
    # 显示类别统计
    print(f"\n类别映射:")
    for class_name, class_id in class_mapping.items():
        print(f"  {class_id}: {class_name}")

if __name__ == "__main__":
    create_yolo_dataset()