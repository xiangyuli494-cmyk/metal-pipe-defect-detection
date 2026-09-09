#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量图片处理流水线（修正版）：
1. 保持目录结构符合 YOLO 要求：images/train, images/val
2. 保持文件名与标签名完全一致，不添加前缀
"""

import os
import cv2
import numpy as np
import shutil
from pathlib import Path


class ImageProcessor:
    """图片处理类"""

    def __init__(self):
        pass

    def detect_defects_auto_mask(self, image_path, output_path=None):
        """对单张图片进行缺陷检测处理"""
        img = cv2.imread(str(image_path))
        if img is None:
            print(f"无法加载图片: {image_path}")
            return None

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (9, 9), 2)

        # 自动检测中间的圆圈
        circles = cv2.HoughCircles(blurred,
                                   cv2.HOUGH_GRADIENT,
                                   dp=1.5,
                                   minDist=gray.shape[0] / 2,
                                   param1=100,
                                   param2=50,
                                   minRadius=30,
                                   maxRadius=100)

        mask = np.ones_like(gray) * 255
        if circles is not None:
            circles = np.uint16(np.around(circles))
            cx, cy, r = circles[0, 0]
            cv2.circle(mask, (cx, cy), r + 5, 0, -1)

        masked_gray = cv2.bitwise_and(gray, mask)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
        tophat = cv2.morphologyEx(masked_gray, cv2.MORPH_TOPHAT, kernel)
        processed_image = cv2.normalize(tophat, None, 0, 255, cv2.NORM_MINMAX)

        if output_path:
            cv2.imwrite(str(output_path), processed_image)

        return processed_image


def process_yolo_dataset_images():
    """处理YOLO数据集中的图片"""
    yolo_dataset_dir = Path("final_dataset")
    if not yolo_dataset_dir.exists():
        print("错误: yolo_dataset 文件夹不存在！")
        return

    # 1. 创建输出根目录
    output_dir = Path("processed_images")
    # 2. 创建 images 子目录 (YOLO 规范)
    images_output_base = output_dir / "images"

    # 递归创建目录
    (images_output_base / "train").mkdir(parents=True, exist_ok=True)
    (images_output_base / "val").mkdir(parents=True, exist_ok=True)

    processor = ImageProcessor()

    for split in ["train", "val"]:
        images_src_dir = yolo_dataset_dir / "images" / split
        # 输出目标：processed_images/images/train
        output_split_dir = images_output_base / split

        if not images_src_dir.exists():
            print(f"警告: {images_src_dir} 不存在，跳过")
            continue

        image_files = []
        for ext in ['*.jpg', '*.jpeg', '*.png', '*.bmp']:
            image_files.extend(images_src_dir.glob(ext))

        print(f"\n开始处理 {split} 集，共 {len(image_files)} 张图片...")

        processed_count = 0
        for image_path in image_files:
            try:
                # 注意：这里直接用 image_path.name，不加任何前缀
                output_path = output_split_dir / image_path.name

                result = processor.detect_defects_auto_mask(image_path, output_path)

                if result is not None:
                    processed_count += 1
                    if processed_count % 20 == 0:
                        print(f"进度: {processed_count}/{len(image_files)}")
            except Exception as e:
                print(f"处理 {image_path.name} 出错: {e}")

        print(f"{split} 集处理完成: 成功 {processed_count} 张")

    # 自动处理标签和配置文件
    copy_labels_and_cfg(yolo_dataset_dir, output_dir)


def copy_labels_and_cfg(yolo_dataset_dir, output_dir):
    """复制标签并更新配置文件"""
    print("\n正在同步标签文件...")

    labels_out_base = output_dir / "labels"
    (labels_out_base / "train").mkdir(parents=True, exist_ok=True)
    (labels_out_base / "val").mkdir(parents=True, exist_ok=True)

    for split in ["train", "val"]:
        labels_src = yolo_dataset_dir / "labels" / split
        labels_dst = labels_out_base / split

        if labels_src.exists():
            txt_files = list(labels_src.glob("*.txt"))
            for txt_file in txt_files:
                shutil.copy2(txt_file, labels_dst / txt_file.name)
            print(f"已同步 {split} 标签: {len(txt_files)} 个")

    # 处理 data.yaml
    config_src = yolo_dataset_dir / "data.yaml"
    if config_src.exists():
        config_dst = output_dir / "data_processed.yaml"
        with open(config_src, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        with open(config_dst, 'w', encoding='utf-8') as f:
            for line in lines:
                # 更新根路径配置
                if line.strip().startswith("path:"):
                    f.write(f"path: {output_dir.absolute()}\n")
                else:
                    f.write(line)
        print(f"配置文件已更新: {config_dst}")


def main():
    print("=" * 50)
    print("金属内壁缺陷检测 - 数据预处理流水线")
    print("=" * 50)
    process_yolo_dataset_images()
    print("\n所有任务已完成！现在可以使用 data_processed.yaml 进行训练了。")


if __name__ == "__main__":
    main()