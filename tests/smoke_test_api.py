# -*- coding: utf-8 -*-
"""后端 API 冒烟测试：登录 -> 加载模型 -> 单张预测"""
import requests, json, shutil, os, sys

BASE = "http://localhost:8002"
MODEL = r"E:\yuanma\3 源码\1 源代码\系统源代码\backend\models\best.pt"
IMG = r"E:\yuanma\3 源码\1 源代码\模型训练源代码\yolo26\videos\final_dataset\images\train\frame_000000.bmp"
TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_smoke_test.bmp")

def main():
    # 1. 登录
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"username": "admin", "password": "admin123"}, timeout=15)
    r.raise_for_status()
    token = r.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[1] 登录 OK, user:", r.json()["data"]["username"])

    # 2. 加载模型
    r = requests.post(f"{BASE}/api/model/load", json={"model_path": MODEL},
                      headers=headers, timeout=300)
    print("[2] 加载模型:", r.status_code, json.dumps(r.json(), ensure_ascii=False)[:300])

    # 3. 复制测试图片
    shutil.copy(IMG, TMP)
    with open(TMP, "rb") as f:
        r = requests.post(f"{BASE}/api/model/predict",
                          files={"file": ("frame_000000.bmp", f, "image/bmp")},
                          headers=headers, timeout=300)
    print("[3] 单张预测:", r.status_code)
    data = r.json()
    print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])

    # 清理
    if os.path.exists(TMP):
        os.remove(TMP)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("测试失败:", e)
        sys.exit(1)
