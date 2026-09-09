#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件夹图片批量处理脚本
对指定文件夹中的所有图片应用缺陷检测处理，并保存到新文件夹
"""

import os
import cv2
import numpy as np
import shutil
from pathlib import Path
import argparse

class ImageProcessor:
    """图片处理类"""

    def __init__(self):
        self.processed_count = 0
        self.failed_count = 0

    def detect_defects_auto_mask(self, image_path, output_path):
        """
        对单张图片进行缺陷检测处理
        Args:
            image_path: 输入图片路径
            output_path: 输出图片路径
        Returns:
            bool: 处理是否成功
        """
        try:
            # 1. 读取图像并转为灰度图
            img = cv2.imread(str(image_path))
            if img is None:
                print(f"无法加载图片: {image_path}")
                return False

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

            # 2. 高斯模糊，减少噪声，帮助霍夫圆检测
            blurred = cv2.GaussianBlur(gray, (9, 9), 2)

            # 3. 自动检测中间的圆圈 (霍夫圆变换)
            circles = cv2.HoughCircles(blurred,
                                       cv2.HOUGH_GRADIENT,
                                       dp=1.5,
                                       minDist=gray.shape[0] / 2,
                                       param1=100,
                                       param2=50,
                                       minRadius=30,
                                       maxRadius=100)

            # 创建一个白色遮罩
            mask = np.ones_like(gray) * 255

            if circles is not None:
                circles = np.uint16(np.around(circles))
                # 取检测到的第一个（最显著的）圆
                cx, cy, r = circles[0, 0]
                # 在遮罩上画一个黑色的实心圆
                cv2.circle(mask, (cx, cy), r + 5, 0, -1)
                # print(f"检测到圆心: ({cx}, {cy}), 半径: {r}")
            else:
                print(f"未检测到圆形: {image_path.name}")

            # 4. 应用遮罩屏蔽中间区域
            masked_gray = cv2.bitwise_and(gray, mask)

            # 5. 形态学顶帽变换 (核心步骤，提取微小反光)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
            tophat = cv2.morphologyEx(masked_gray, cv2.MORPH_TOPHAT, kernel)

            # 6. 增强对比度（线性拉伸）
            processed_image = cv2.normalize(tophat, None, 0, 255, cv2.NORM_MINMAX)

            # 7. 保存处理后的图片
            cv2.imwrite(str(output_path), processed_image)

            return True

        except Exception as e:
            print(f"处理图片 {image_path} 时出错: {e}")
            return False

    def process_folder(self, input_folder, output_folder, prefix="processed_", copy_labels=True):
        """
        批量处理文件夹中的图片
        Args:
            input_folder: 输入文件夹路径
            output_folder: 输出文件夹路径
            prefix: 输出文件名前缀
            copy_labels: 是否复制对应的标签文件
        """
        input_path = Path(input_folder)
        output_path = Path(output_folder)

        # 检查输入文件夹是否存在
        if not input_path.exists():
            print(f"错误: 输入文件夹不存在: {input_path}")
            return

        # 创建输出文件夹
        output_path.mkdir(parents=True, exist_ok=True)

        # 支持的图片格式
        image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']

        # 获取所有图片文件
        image_files = []
        for ext in image_extensions:
            image_files.extend(input_path.glob(f"*{ext}"))
            image_files.extend(input_path.glob(f"*{ext.upper()}"))

        if not image_files:
            print(f"在文件夹 {input_path} 中未找到图片文件")
            return

        print(f"找到 {len(image_files)} 张图片，开始处理...")
        print(f"输入文件夹: {input_path.absolute()}")
        print(f"输出文件夹: {output_path.absolute()}")
        print("-" * 50)

        self.processed_count = 0
        self.failed_count = 0

        for i, image_file in enumerate(image_files, 1):
            # 生成输出文件名
            output_filename = f"{prefix}{image_file.name}"
            output_file_path = output_path / output_filename

            print(f"[{i}/{len(image_files)}] 处理: {image_file.name}", end=" ... ")

            # 处理图片
            if self.detect_defects_auto_mask(image_file, output_file_path):
                self.processed_count += 1
                print("成功")
            else:
                self.failed_count += 1
                print("失败")

        # 输出统计信息
        print("-" * 50)
        print(f"处理完成！")
        print(f"成功处理: {self.processed_count} 张")
        print(f"处理失败: {self.failed_count} 张")
        print(f"处理后的图片保存在: {output_path.absolute()}")

        # 复制标签文件（如果存在且需要复制）
        if copy_labels:
            self.copy_labels(input_path, output_path, prefix)

    def copy_labels(self, input_folder, output_folder, prefix):
        """
        复制对应的标签文件
        Args:
            input_folder: 输入文件夹路径
            output_folder: 输出文件夹路径
            prefix: 文件名前缀
        """
        input_path = Path(input_folder)
        output_path = Path(output_folder)

        # 查找标签文件
        label_files = list(input_path.glob("*.txt"))

        if not label_files:
            print("未找到标签文件(.txt)，跳过标签复制")
            return

        print(f"\n找到 {len(label_files)} 个标签文件，开始复制...")

        copied_count = 0
        for label_file in label_files:
            try:
                # 检查是否有对应的图片文件
                image_name_base = label_file.stem

                # 查找对应的图片文件
                image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']
                corresponding_image = None

                for ext in image_extensions:
                    potential_image = input_path / f"{image_name_base}{ext}"
                    if potential_image.exists():
                        corresponding_image = potential_image
                        break
                    potential_image = input_path / f"{image_name_base}{ext.upper()}"
                    if potential_image.exists():
                        corresponding_image = potential_image
                        break

                if corresponding_image:
                    # 生成输出标签文件名
                    output_label_name = f"{prefix}{label_file.name}"
                    output_label_path = output_path / output_label_name

                    # 复制标签文件
                    shutil.copy2(label_file, output_label_path)
                    copied_count += 1
                else:
                    print(f"警告: 标签文件 {label_file.name} 没有对应的图片文件")

            except Exception as e:
                print(f"复制标签文件 {label_file} 时出错: {e}")

        print(f"成功复制 {copied_count} 个标签文件")

def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='批量处理文件夹中的图片')
    parser.add_argument('input_folder', help='输入文件夹路径')
    parser.add_argument('-o', '--output', help='输出文件夹路径', default='processed_images')
    parser.add_argument('-p', '--prefix', help='输出文件名前缀', default='processed_')
    parser.add_argument('--no-labels', action='store_true', help='不复制标签文件')

    args = parser.parse_args()

    # 如果没有提供命令行参数，使用交互式输入
    if len(os.sys.argv) == 1:
        print("=" * 60)
        print("文件夹图片批量处理工具")
        print("=" * 60)

        # 交互式输入
        input_folder = input("请输入要处理的图片文件夹路径: ").strip()
        if not input_folder:
            print("错误: 必须提供输入文件夹路径")
            return

        output_folder = input("请输入输出文件夹路径 (默认: processed_images): ").strip()
        if not output_folder:
            output_folder = "processed_images"

        prefix = input("请输入输出文件名前缀 (默认: processed_): ").strip()
        if not prefix:
            prefix = "processed_"

        copy_labels = True  # 默认复制标签文件
    else:
        input_folder = args.input_folder
        output_folder = args.output
        prefix = args.prefix
        copy_labels = not args.no_labels

    # 创建处理器并开始处理
    processor = ImageProcessor()
    processor.process_folder(input_folder, output_folder, prefix, copy_labels)

if __name__ == "__main__":
    main()