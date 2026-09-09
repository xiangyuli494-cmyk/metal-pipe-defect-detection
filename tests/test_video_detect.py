#!/usr/bin/env python3
"""
测试视频检测功能
"""
import requests
import time
from pathlib import Path

# 配置
API_BASE = "http://localhost:8002"
TEST_VIDEO = "test/test_video.mp4"  # 需要你提供一个测试视频

def test_video_detect():
    """测试视频检测API"""
    
    # 检查测试视频是否存在
    if not Path(TEST_VIDEO).exists():
        print(f"❌ 测试视频不存在: {TEST_VIDEO}")
        print("请修改 TEST_VIDEO 变量为你的视频文件路径")
        return
    
    print(f"📹 使用测试视频: {TEST_VIDEO}")
    
    # 1. 检查模型状态
    print("\n1. 检查模型状态...")
    resp = requests.get(f"{API_BASE}/api/model/status")
    status_data = resp.json()
    print(f"   状态: {status_data}")
    
    # 如果模型未加载，尝试加载
    if not status_data.get('success') or not status_data.get('data', {}).get('is_loaded'):
        print("⚠️ 模型未加载，正在加载模型...")
        model_path = "/home/gwf/code/front2/models/best.pt"  # 修改为你的模型路径
        resp = requests.post(f"{API_BASE}/api/model/load", params={"model_path": model_path})
        print(f"   加载结果: {resp.json()}")
        
        if not resp.json().get('success'):
            print("❌ 模型加载失败，请检查模型路径")
            return
    
    # 2. 上传视频并检测
    print("\n2. 上传视频并检测...")
    with open(TEST_VIDEO, 'rb') as f:
        files = {'file': (Path(TEST_VIDEO).name, f, 'video/mp4')}
        data = {
            'frame_interval': 10,  # 降低抽帧间隔，每10帧检测一次
            'max_frames': 300,
            'confidence_threshold': 0.25,  # 降低置信度阈值
            'iou_threshold': 0.45
        }
        
        start = time.time()
        resp = requests.post(f"{API_BASE}/api/video/detect", files=files, data=data)
        elapsed = time.time() - start
    
    print(f"   耗时: {elapsed:.1f}s")
    print(f"   状态码: {resp.status_code}")
    
    if resp.status_code == 200:
        result = resp.json()
        print(f"   成功: {result.get('success')}")
        if result.get('success'):
            data = result.get('data', {})
            print(f"   总帧数: {data.get('video_info', {}).get('total_frames')}")
            print(f"   检测帧数: {data.get('total_detected')}")
            print(f"   处理时间: {data.get('processing_time')}s")
            print(f"   帧间隔: {data.get('frame_interval')}")
            
            frames = data.get('frames', [])
            print(f"   返回帧数: {len(frames)}")
            if frames:
                print(f"   第一帧缺陷数: {frames[0].get('defect_count')}")
    else:
        print(f"   错误: {resp.text}")
    
    print("\n✅ 测试完成")

if __name__ == '__main__':
    test_video_detect()
