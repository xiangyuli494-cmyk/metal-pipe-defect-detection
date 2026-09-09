"""
AI模型服务 - 加载和运行训练好的缺陷检测模型
"""
import os
import sys
import json
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import tempfile


class ModelService:
    """AI模型服务类"""

    def __init__(self):
        self.model = None
        self.model_path = None
        self.model_type = None  # 'yolo', 'tensorflow', 'pytorch', etc.
        self.class_names = []
        self.confidence_threshold = 0.5
        self.iou_threshold = 0.45
        self.is_loaded = False

    def get_status(self) -> Dict[str, Any]:
        """获取模型状态"""
        return {
            'is_loaded': self.is_loaded,
            'model_path': self.model_path,
            'model_type': self.model_type,
            'class_names': self.class_names,
            'confidence_threshold': self.confidence_threshold,
            'iou_threshold': self.iou_threshold
        }

    def load_model(self, model_path: str) -> Dict[str, Any]:
        """
        加载AI模型

        支持格式:
        - YOLO: .pt, .weights, .cfg
        - TensorFlow: .pb, .h5, SavedModel
        - PyTorch: .pth, .pt (非YOLO)
        - ONNX: .onnx
        """
        self.model_path = model_path
        model_file = Path(model_path)

        if not model_file.exists():
            return {
                'success': False,
                'message': f'模型文件不存在: {model_path}'
            }

        # 根据文件扩展名判断模型类型
        ext = model_file.suffix.lower()

        try:
            # 优先尝试 YOLO 方式加载（适用于 .pt 文件）
            if ext in ['.pt', '.pth', '.weights', '.cfg']:
                # 先尝试 YOLO 加载
                try:
                    self._load_yolo_model(model_path)
                    self.is_loaded = True
                    return {
                        'success': True,
                        'message': 'YOLO模型加载成功',
                        'model_type': self.model_type,
                        'class_names': self.class_names
                    }
                except Exception as yolo_error:
                    print(f"YOLO方式加载失败: {yolo_error}")
                    # 如果不是 .pt 或 .pth，重新抛出异常
                    if ext not in ['.pt', '.pth']:
                        raise yolo_error
                    # 如果是 .pt 或 .pth，尝试 PyTorch 方式加载
                    print("尝试PyTorch方式加载...")
                    self._load_pytorch_model(model_path)
            elif ext in ['.pb', '.h5']:
                self._load_tensorflow_model(model_path)
            elif ext == '.onnx':
                self._load_onnx_model(model_path)
            else:
                # 尝试自动检测模型类型
                self._load_auto_model(model_path)

            self.is_loaded = True
            return {
                'success': True,
                'message': '模型加载成功',
                'model_type': self.model_type,
                'class_names': self.class_names
            }

        except Exception as e:
            print(f"模型加载失败: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'message': f'模型加载失败: {str(e)}'
            }

    def _load_pytorch_model(self, model_path: str):
        """加载PyTorch模型"""
        import torch

        self.model_type = 'pytorch'
        
        # 尝试使用weights_only=False加载
        try:
            self.model = torch.load(model_path, map_location='cpu', weights_only=False)
        except Exception as e:
            print(f"使用weights_only=False加载失败: {e}")
            # 尝试添加安全全局变量
            try:
                import ultralytics.nn.tasks
                torch.serialization.add_safe_globals([ultralytics.nn.tasks.DetectionModel])
                self.model = torch.load(model_path, map_location='cpu', weights_only=True)
            except Exception as e2:
                print(f"添加安全全局变量加载失败: {e2}")
                raise

        # 尝试加载类别名称
        class_file = Path(model_path).parent / 'classes.txt'
        if class_file.exists():
            with open(class_file, 'r') as f:
                self.class_names = [line.strip() for line in f]
        else:
            # 根据你的YOLO模型实际支持的类别
            # 模型只能识别: 0: '凸起', 1: '焊缝'
            self.class_names = ['凸起', '焊缝']

    def _load_tensorflow_model(self, model_path: str):
        """加载TensorFlow模型"""
        import tensorflow as tf

        self.model_type = 'tensorflow'

        if Path(model_path).is_dir():
            # SavedModel格式
            self.model = tf.saved_model.load(model_path)
        else:
            # .h5或.pb格式
            self.model = tf.keras.models.load_model(model_path)

        # 尝试加载类别名称
        class_file = Path(model_path).parent / 'classes.txt'
        if class_file.exists():
            with open(class_file, 'r') as f:
                self.class_names = [line.strip() for line in f]
        else:
            self.class_names = ['裂纹', '腐蚀', '点蚀', '划痕', '凹痕', '磨损', '锈蚀', '孔洞', '变形', '其他']

    def _load_onnx_model(self, model_path: str):
        """加载ONNX模型"""
        import onnxruntime as ort

        self.model_type = 'onnx'
        self.model = ort.InferenceSession(model_path)

        # 尝试加载类别名称
        class_file = Path(model_path).parent / 'classes.txt'
        if class_file.exists():
            with open(class_file, 'r') as f:
                self.class_names = [line.strip() for line in f]
        else:
            self.class_names = ['裂纹', '腐蚀', '点蚀', '划痕', '凹痕', '磨损', '锈蚀', '孔洞', '变形', '其他']

    def _load_yolo_model(self, model_path: str):
        """加载YOLO模型 - 支持外部ultralytics库"""
        # 尝试使用ultralytics - 优先从用户指定的路径导入
        ultralytics_path = os.getenv('ULTRALYTICS_PATH', '')

        # 如果路径是相对路径，相对于 backend/ 目录解析
        if ultralytics_path:
            _p = Path(ultralytics_path)
            if not _p.is_absolute():
                _backend_dir = Path(__file__).parent.parent
                ultralytics_path = str(_backend_dir / _p)

        print(f"尝试加载YOLO模型: {model_path}")
        print(f"ULTRALYTICS_PATH: {ultralytics_path}")

        if ultralytics_path and os.path.exists(ultralytics_path):
            # 添加用户指定的ultralytics路径到Python路径
            if ultralytics_path not in sys.path:
                sys.path.insert(0, ultralytics_path)
            try:
                print(f"从指定路径导入ultralytics: {ultralytics_path}")
                from ultralytics import YOLO
                self.model_type = 'yolo'
                print(f"创建YOLO模型实例...")
                self.model = YOLO(model_path)
                print(f"模型加载成功!")
                self.class_names = list(self.model.names.values()) if hasattr(self.model, 'names') else []
                print(f"类别名称: {self.class_names}")
                return
            except ImportError as e:
                print(f"从指定路径导入ultralytics失败: {e}")
                sys.path.pop(0)

        # 尝试系统安装的ultralytics
        try:
            print("尝试导入系统ultralytics...")
            from ultralytics import YOLO
            self.model_type = 'yolo'
            self.model = YOLO(model_path)
            self.class_names = list(self.model.names.values()) if hasattr(self.model, 'names') else []
            print(f"系统ultralytics加载成功!")
        except ImportError as e:
            print(f"系统ultralytics导入失败: {e}")
            # 使用opencv的dnn模块作为备选
            import cv2
            self.model_type = 'yolo-opencv'
            # 加载.cfg和.weights文件
            cfg_path = str(Path(model_path).with_suffix('.cfg'))
            weights_path = str(Path(model_path).with_suffix('.weights'))
            self.model = cv2.dnn.readNetFromDarknet(cfg_path, weights_path)

    def _load_auto_model(self, model_path: str):
        """自动检测并加载模型"""
        # 尝试不同的加载方式
        try:
            import torch
            self._load_pytorch_model(model_path)
            return
        except:
            pass

        try:
            import tensorflow as tf
            self._load_tensorflow_model(model_path)
            return
        except:
            pass

        try:
            self._load_onnx_model(model_path)
            return
        except:
            pass

        raise ValueError(f'无法识别模型格式: {model_path}')

    async def predict(self, file) -> Dict[str, Any]:
        """
        对单张图片进行预测

        参数:
            file: 上传的图片文件

        返回:
            检测结果字典，包含标注好的图片base64
        """
        if not self.is_loaded:
            return {
                'success': False,
                'message': '模型未加载，请先加载模型'
            }

        try:
            # 保存临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
                content = await file.read()
                tmp.write(content)
                tmp_path = tmp.name

            # 根据模型类型进行推理
            if self.model_type == 'yolo':
                result = self._predict_yolo_with_annotations(tmp_path)
            elif self.model_type == 'pytorch':
                # 尝试使用YOLO方式预测
                result = self._predict_yolo_compatible_with_annotations(tmp_path)
            elif self.model_type == 'tensorflow':
                result = self._predict_tensorflow_with_annotations(tmp_path)
            elif self.model_type == 'onnx':
                result = self._predict_onnx_with_annotations(tmp_path)
            else:
                result = self._predict_mock_with_annotations(tmp_path)

            # 清理临时文件
            os.unlink(tmp_path)

            return {
                'success': True,
                'filename': file.filename,
                'result': result
            }

        except Exception as e:
            return {
                'success': False,
                'message': f'预测失败: {str(e)}'
            }

    async def predict_batch(self, files: List) -> List[Dict[str, Any]]:
        """批量预测"""
        results = []
        for file in files:
            result = await self.predict(file)
            results.append(result)
        return results
    
    async def predict_from_path(self, file_path: str, original_filename: str = "unknown") -> Dict[str, Any]:
        """
        从文件路径进行预测（用于已保存的文件）
        
        参数:
            file_path: 文件路径
            original_filename: 原始文件名
        
        返回:
            检测结果字典
        """
        if not self.is_loaded:
            return {
                'success': False,
                'message': '模型未加载，请先加载模型'
            }
        
        try:
            # 根据模型类型进行推理
            if self.model_type == 'yolo':
                result = self._predict_yolo_with_annotations(file_path)
            elif self.model_type == 'pytorch':
                # 尝试使用YOLO方式预测
                result = self._predict_yolo_compatible_with_annotations(file_path)
            elif self.model_type == 'tensorflow':
                result = self._predict_tensorflow_with_annotations(file_path)
            elif self.model_type == 'onnx':
                result = self._predict_onnx_with_annotations(file_path)
            else:
                result = self._predict_mock_with_annotations(file_path)

            return {
                'success': True,
                'filename': original_filename,
                'result': result
            }

        except Exception as e:
            return {
                'success': False,
                'message': f'预测失败: {str(e)}'
            }

    def _predict_yolo(self, image_path: str) -> Dict[str, Any]:
        """使用YOLO模型预测"""
        results = self.model(image_path, conf=self.confidence_threshold, iou=self.iou_threshold)

        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                detections.append({
                    'class': self.class_names[int(box.cls)] if int(box.cls) < len(self.class_names) else '未知',
                    'confidence': float(box.conf),
                    'bbox': {
                        'x': float(box.xyxy[0][0]),
                        'y': float(box.xyxy[0][1]),
                        'width': float(box.xyxy[0][2] - box.xyxy[0][0]),
                        'height': float(box.xyxy[0][3] - box.xyxy[0][1])
                    }
                })

        return {
            'detections': detections,
            'count': len(detections)
        }

    def _predict_pytorch(self, image_path: str) -> Dict[str, Any]:
        """使用PyTorch模型预测"""
        import torch
        from PIL import Image
        import torchvision.transforms as transforms

        # 图像预处理
        image = Image.open(image_path).convert('RGB')
        transform = transforms.Compose([
            transforms.Resize((640, 640)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        input_tensor = transform(image).unsqueeze(0)

        # 推理
        with torch.no_grad():
            outputs = self.model(input_tensor)

        # 解析结果（这里需要根据实际模型输出格式调整）
        return self._parse_detection_outputs(outputs)

    def _predict_tensorflow(self, image_path: str) -> Dict[str, Any]:
        """使用TensorFlow模型预测"""
        import tensorflow as tf
        from PIL import Image
        import numpy as np

        # 图像预处理
        image = Image.open(image_path).convert('RGB')
        image = image.resize((640, 640))
        input_array = np.array(image) / 255.0
        input_array = np.expand_dims(input_array, axis=0)

        # 推理
        outputs = self.model(input_array)

        return self._parse_detection_outputs(outputs)

    def _predict_onnx(self, image_path: str) -> Dict[str, Any]:
        """使用ONNX模型预测"""
        from PIL import Image
        import numpy as np

        # 图像预处理
        image = Image.open(image_path).convert('RGB')
        image = image.resize((640, 640))
        input_array = np.array(image).astype(np.float32) / 255.0
        input_array = np.transpose(input_array, (2, 0, 1))  # HWC to CHW
        input_array = np.expand_dims(input_array, axis=0)

        # 获取输入输出名称
        input_name = self.model.get_inputs()[0].name

        # 推理
        outputs = self.model.run(None, {input_name: input_array})

        return self._parse_detection_outputs(outputs)

    def _predict_yolo_compatible(self, image_path: str) -> Dict[str, Any]:
        """使用兼容YOLO的方式预测（针对PyTorch加载的YOLO模型）"""
        try:
            # 尝试使用ultralytics进行推理
            ultralytics_path = os.getenv('ULTRALYTICS_PATH', '')
            if ultralytics_path:
                _p = Path(ultralytics_path)
                if not _p.is_absolute():
                    _backend_dir = Path(__file__).parent.parent
                    ultralytics_path = str(_backend_dir / _p)
            if ultralytics_path and os.path.exists(ultralytics_path):
                if ultralytics_path not in sys.path:
                    sys.path.insert(0, ultralytics_path)
            
            from ultralytics import YOLO
            
            # 重新加载模型为YOLO实例
            yolo_model = YOLO(self.model_path)
            results = yolo_model(image_path, conf=self.confidence_threshold, iou=self.iou_threshold)
            
            detections = []
            for result in results:
                boxes = result.boxes
                if boxes is not None:
                    for box in boxes:
                        cls_id = int(box.cls)
                        class_name = self.class_names[cls_id] if cls_id < len(self.class_names) else f'类别{cls_id}'
                        detections.append({
                            'class': class_name,
                            'confidence': float(box.conf),
                            'bbox': {
                                'x': float(box.xyxy[0][0]),
                                'y': float(box.xyxy[0][1]),
                                'width': float(box.xyxy[0][2] - box.xyxy[0][0]),
                                'height': float(box.xyxy[0][3] - box.xyxy[0][1])
                            }
                        })
            
            return {
                'detections': detections,
                'count': len(detections),
                'note': '使用YOLO兼容模式预测'
            }
        except Exception as e:
            print(f"YOLO兼容模式预测失败: {e}")
            # 回退到模拟数据
            return self._predict_mock(image_path)

    def _predict_mock(self, image_path: str) -> Dict[str, Any]:
        """模拟预测（用于测试）"""
        import random

        # 模拟检测结果
        defect_types = self.class_names if self.class_names else ['裂纹', '腐蚀', '点蚀', '划痕', '凹痕', '磨损', '锈蚀', '孔洞', '变形', '其他']
        num_detections = random.randint(0, 5)

        detections = []
        for i in range(num_detections):
            detections.append({
                'class': random.choice(defect_types),
                'confidence': round(random.uniform(0.6, 0.99), 3),
                'bbox': {
                    'x': random.randint(50, 500),
                    'y': random.randint(50, 400),
                    'width': random.randint(30, 100),
                    'height': random.randint(30, 100)
                }
            })

        return {
            'detections': detections,
            'count': len(detections),
            'note': '这是模拟数据，请加载真实模型'
        }

    def _parse_detection_outputs(self, outputs) -> Dict[str, Any]:
        """解析检测输出（需要根据实际模型输出格式调整）"""
        # 这是一个通用的解析函数，需要根据实际模型输出格式进行调整
        return {
            'detections': [],
            'count': 0,
            'raw_outputs': str(outputs)[:200]  # 截断原始输出用于调试
        }

    def set_confidence_threshold(self, threshold: float):
        """设置置信度阈值"""
        self.confidence_threshold = threshold

    def set_iou_threshold(self, threshold: float):
        """设置IOU阈值"""
        self.iou_threshold = threshold

    def get_class_names(self) -> List[str]:
        """获取类别名称列表"""
        return self.class_names

    def set_class_names(self, class_names: List[str]):
        """设置类别名称列表"""
        self.class_names = class_names

    def _predict_yolo_with_annotations(self, image_path: str) -> Dict[str, Any]:
        """使用YOLO模型预测并生成标注图片"""
        import base64
        from PIL import Image, ImageDraw, ImageFont
        import io
        
        results = self.model(image_path, conf=self.confidence_threshold, iou=self.iou_threshold)

        detections = []
        annotated_image = None
        
        for result in results:
            # 获取原始图片
            orig_img = result.orig_img
            if orig_img is not None:
                # 转换为PIL图像
                if isinstance(orig_img, np.ndarray):
                    annotated_image = Image.fromarray(orig_img)
                else:
                    annotated_image = Image.fromarray(orig_img.cpu().numpy())
                
                draw = ImageDraw.Draw(annotated_image)
                
                # 尝试加载字体
                try:
                    font = ImageFont.truetype("/usr/share/fonts/truetype/arphic/uming.ttc", 20)
                except:
                    font = ImageFont.load_default()
                
                boxes = result.boxes
                for box in boxes:
                    cls_id = int(box.cls)
                    class_name = self.class_names[cls_id] if cls_id < len(self.class_names) else f'类别{cls_id}'
                    confidence = float(box.conf)
                    
                    # 获取边界框坐标
                    x1, y1, x2, y2 = box.xyxy[0]
                    x1, y1, x2, y2 = float(x1), float(y1), float(x2), float(y2)
                    
                    # 添加到检测结果
                    detections.append({
                        'class': class_name,
                        'confidence': confidence,
                        'bbox': {
                            'x': x1,
                            'y': y1,
                            'width': x2 - x1,
                            'height': y2 - y1
                        }
                    })
                    
                    # 在图片上绘制标注框
                    color = self._get_color_for_class(class_name)
                    draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
                    
                    # 绘制标签
                    label = f"{class_name} {confidence:.2f}"
                    text_bbox = draw.textbbox((x1, y1 - 25), label, font=font)
                    draw.rectangle(text_bbox, fill=color)
                    draw.text((x1, y1 - 25), label, fill="white", font=font)
        
        # 如果没有检测到任何目标，使用原始图片
        if annotated_image is None:
            annotated_image = Image.open(image_path)
        
        # 将标注图片转换为base64
        buffered = io.BytesIO()
        annotated_image.save(buffered, format="JPEG")
        annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

        return {
            'detections': detections,
            'count': len(detections),
            'annotated_image': f"data:image/jpeg;base64,{annotated_image_base64}"
        }

    def _predict_yolo_compatible_with_annotations(self, image_path: str) -> Dict[str, Any]:
        """使用兼容YOLO的方式预测并生成标注图片"""
        import base64
        from PIL import Image, ImageDraw, ImageFont
        import io
        
        try:
            # 尝试使用ultralytics进行推理
            ultralytics_path = os.getenv('ULTRALYTICS_PATH', '')
            if ultralytics_path:
                _p = Path(ultralytics_path)
                if not _p.is_absolute():
                    _backend_dir = Path(__file__).parent.parent
                    ultralytics_path = str(_backend_dir / _p)
            if ultralytics_path and os.path.exists(ultralytics_path):
                if ultralytics_path not in sys.path:
                    sys.path.insert(0, ultralytics_path)
            
            from ultralytics import YOLO
            
            # 重新加载模型为YOLO实例
            yolo_model = YOLO(self.model_path)
            results = yolo_model(image_path, conf=self.confidence_threshold, iou=self.iou_threshold)
            
            detections = []
            annotated_image = None
            
            for result in results:
                # 获取原始图片
                orig_img = result.orig_img
                if orig_img is not None:
                    # 转换为PIL图像
                    if isinstance(orig_img, np.ndarray):
                        annotated_image = Image.fromarray(orig_img)
                    else:
                        annotated_image = Image.fromarray(orig_img.cpu().numpy())
                    
                    draw = ImageDraw.Draw(annotated_image)
                    
                    # 尝试加载字体
                    try:
                        font = ImageFont.truetype("/usr/share/fonts/truetype/arphic/uming.ttc", 20)
                    except:
                        font = ImageFont.load_default()
                    
                    boxes = result.boxes
                    if boxes is not None:
                        for box in boxes:
                            cls_id = int(box.cls)
                            class_name = self.class_names[cls_id] if cls_id < len(self.class_names) else f'类别{cls_id}'
                            confidence = float(box.conf)
                            
                            # 获取边界框坐标
                            x1, y1, x2, y2 = box.xyxy[0]
                            x1, y1, x2, y2 = float(x1), float(y1), float(x2), float(y2)
                            
                            # 添加到检测结果
                            detections.append({
                                'class': class_name,
                                'confidence': confidence,
                                'bbox': {
                                    'x': x1,
                                    'y': y1,
                                    'width': x2 - x1,
                                    'height': y2 - y1
                                }
                            })
                            
                            # 在图片上绘制标注框
                            color = self._get_color_for_class(class_name)
                            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
                            
                            # 绘制标签
                            label = f"{class_name} {confidence:.2f}"
                            text_bbox = draw.textbbox((x1, y1 - 25), label, font=font)
                            draw.rectangle(text_bbox, fill=color)
                            draw.text((x1, y1 - 25), label, fill="white", font=font)
            
            # 如果没有检测到任何目标，使用原始图片
            if annotated_image is None:
                annotated_image = Image.open(image_path)
            
            # 将标注图片转换为base64
            buffered = io.BytesIO()
            annotated_image.save(buffered, format="JPEG")
            annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

            return {
                'detections': detections,
                'count': len(detections),
                'annotated_image': f"data:image/jpeg;base64,{annotated_image_base64}",
                'note': '使用YOLO兼容模式预测'
            }
        except Exception as e:
            print(f"YOLO兼容模式预测失败: {e}")
            # 回退到模拟数据
            return self._predict_mock_with_annotations(image_path)

    def _predict_mock_with_annotations(self, image_path: str) -> Dict[str, Any]:
        """模拟预测并生成标注图片（用于测试）"""
        import base64
        from PIL import Image, ImageDraw, ImageFont
        import io
        import random
        
        # 打开原始图片
        original_image = Image.open(image_path)
        draw = ImageDraw.Draw(original_image)
        
        # 尝试加载字体
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/arphic/uming.ttc", 20)
        except:
            font = ImageFont.load_default()
        
        # 模拟检测结果
        defect_types = self.class_names if self.class_names else ['凸起', '焊缝']
        num_detections = random.randint(0, 3)

        detections = []
        for i in range(num_detections):
            class_name = random.choice(defect_types)
            confidence = round(random.uniform(0.6, 0.99), 3)
            
            # 随机生成边界框（确保在图片范围内）
            img_width, img_height = original_image.size
            box_width = random.randint(30, 100)
            box_height = random.randint(30, 100)
            x1 = random.randint(50, img_width - box_width - 50)
            y1 = random.randint(50, img_height - box_height - 50)
            x2 = x1 + box_width
            y2 = y1 + box_height
            
            # 添加到检测结果
            detections.append({
                'class': class_name,
                'confidence': confidence,
                'bbox': {
                    'x': x1,
                    'y': y1,
                    'width': box_width,
                    'height': box_height
                }
            })
            
            # 在图片上绘制标注框
            color = self._get_color_for_class(class_name)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            
            # 绘制标签
            label = f"{class_name} {confidence:.2f}"
            text_bbox = draw.textbbox((x1, y1 - 25), label, font=font)
            draw.rectangle(text_bbox, fill=color)
            draw.text((x1, y1 - 25), label, fill="white", font=font)
        
        # 将标注图片转换为base64
        buffered = io.BytesIO()
        original_image.save(buffered, format="JPEG")
        annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

        return {
            'detections': detections,
            'count': len(detections),
            'annotated_image': f"data:image/jpeg;base64,{annotated_image_base64}",
            'note': '这是模拟数据，请加载真实模型'
        }

    def _get_color_for_class(self, class_name: str) -> str:
        """根据类别名称获取颜色"""
        # 为常见缺陷类型分配固定颜色
        color_map = {
            '凸起': '#ef4444',  # 红色
            '焊缝': '#3b82f6',  # 蓝色
            '裂纹': '#f97316',  # 橙色
            '腐蚀': '#f59e0b',  # 黄色
            '点蚀': '#8b5cf6',  # 紫色
            '划痕': '#06b6d4',  # 青色
            '凹痕': '#ec4899',  # 粉色
            '磨损': '#7c2d12',  # 棕色
            '锈蚀': '#eab308',  # 金色
            '孔洞': '#84cc16',  # 绿色
            '变形': '#64748b',  # 灰色
            '其他': '#6b7280'   # 深灰
        }
        
        return color_map.get(class_name, '#ef4444')  # 默认红色

    # 为其他模型类型添加标注功能（简化版本）
    def _predict_tensorflow_with_annotations(self, image_path: str) -> Dict[str, Any]:
        """TensorFlow模型预测并生成标注图片"""
        # 先调用原始预测函数
        result = self._predict_tensorflow(image_path)
        # 然后生成标注图片
        return self._add_annotations_to_result(image_path, result)

    def _predict_onnx_with_annotations(self, image_path: str) -> Dict[str, Any]:
        """ONNX模型预测并生成标注图片"""
        result = self._predict_onnx(image_path)
        return self._add_annotations_to_result(image_path, result)

    def _add_annotations_to_result(self, image_path: str, result: Dict[str, Any]) -> Dict[str, Any]:
        """为预测结果添加标注图片"""
        import base64
        from PIL import Image, ImageDraw, ImageFont
        import io
        
        # 打开原始图片
        original_image = Image.open(image_path)
        draw = ImageDraw.Draw(original_image)
        
        # 尝试加载字体
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/arphic/uming.ttc", 20)
        except:
            font = ImageFont.load_default()
        
        # 在图片上绘制检测框
        for detection in result.get('detections', []):
            class_name = detection['class']
            confidence = detection['confidence']
            bbox = detection['bbox']
            
            x1 = bbox['x']
            y1 = bbox['y']
            x2 = x1 + bbox['width']
            y2 = y1 + bbox['height']
            
            # 绘制标注框
            color = self._get_color_for_class(class_name)
            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
            
            # 绘制标签
            label = f"{class_name} {confidence:.2f}"
            text_bbox = draw.textbbox((x1, y1 - 25), label, font=font)
            draw.rectangle(text_bbox, fill=color)
            draw.text((x1, y1 - 25), label, fill="white", font=font)
        
        # 将标注图片转换为base64
        buffered = io.BytesIO()
        original_image.save(buffered, format="JPEG")
        annotated_image_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        # 更新结果
        result['annotated_image'] = f"data:image/jpeg;base64,{annotated_image_base64}"
        return result
