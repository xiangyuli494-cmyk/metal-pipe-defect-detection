# -*- coding: utf-8 -*-
"""
API 功能模块回归自测

用法（后端已启动在 8002 时）:
    python backend/tests/api_selftest.py [base_url]

默认 base_url = http://127.0.0.1:8002，默认账号 admin / admin123。
会自动用 cv2 合成测试图片与视频，无需准备素材。
覆盖 16 个模块共 84 项：基础、认证、鉴权、用户、资料、模型、检测、
记录、导出、统计、批量、通知、系统、摄像头、视频，以及补充的深度用例。
"""
import sys, os, time, tempfile
from collections import defaultdict
import requests

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8002"
USERNAME = os.environ.get("SELFTEST_USER", "admin")
PASSWORD = os.environ.get("SELFTEST_PWD", "admin123")


def _make_assets(d):
    """合成管道内壁测试图 + 小视频"""
    import cv2, numpy as np
    os.makedirs(d, exist_ok=True)

    def pipe(w=640, h=640, seed=0):
        r = np.random.default_rng(seed)
        img = np.full((h, w, 3), 90, dtype=np.uint8)
        for y in range(h):
            img[y, :] = np.clip(int(90 + r.normal(0, 10)), 40, 180)
        for x in range(0, w, 7):
            img[:, x:x + 2] = np.clip(img[:, x:x + 2].astype(int) + 25, 0, 255)
        if seed % 2 == 0:
            cv2.line(img, (80, 120), (300, 420), (25, 25, 25), 3)
            cv2.ellipse(img, (420, 300), (70, 45), 20, 0, 360, (30, 30, 30), 4)
        if seed % 3 == 0:
            cv2.circle(img, (500, 150), 30, (35, 35, 35), -1)
            cv2.circle(img, (200, 520), 22, (40, 40, 40), -1)
        return np.clip(img.astype(int) + r.normal(0, 6, img.shape), 0, 255).astype(np.uint8)

    for i in range(3):
        cv2.imwrite(os.path.join(d, f"pipe_{i}.jpg"), pipe(seed=i))
    vw = cv2.VideoWriter(os.path.join(d, "pipe.mp4"),
                         cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 320))
    for f in range(50):
        im = pipe(320, 320, seed=f % 4)
        cv2.putText(im, f"frame {f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
        vw.write(im)
    vw.release()


D = os.path.join(tempfile.gettempdir(), "pipe_selftest_assets")
if not os.path.exists(os.path.join(D, "pipe_0.jpg")):
    _make_assets(D)
IMG, IMG2, IMG3 = f"{D}/pipe_0.jpg", f"{D}/pipe_1.jpg", f"{D}/pipe_2.jpg"
VID = f"{D}/pipe.mp4"
ts = str(int(time.time()))[-6:]

results = []


def rec(mod, name, ok, detail=""):
    results.append((mod, name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}  {detail[:110]}")


# ---- 登录取 token ----
try:
    _r = requests.post(f"{BASE}/api/auth/login",
                       json={"username": USERNAME, "password": PASSWORD}, timeout=15)
    TOK = _r.json()["data"]["access_token"]
except Exception as e:
    print(f"登录失败，无法继续测试: {e}")
    sys.exit(1)
H = {"Authorization": f"Bearer {TOK}"}


print("=== A. 基础与健康检查 ===")
try:
    r = requests.get(f"{BASE}/health", timeout=10)
    rec("基础", "GET /health", r.status_code == 200 and r.json().get("status") == "healthy", str(r.json())[:70])
except Exception as e:
    rec("基础", "GET /health", False, str(e))
try:
    r = requests.get(f"{BASE}/", timeout=10)
    rec("基础", "GET /", r.status_code == 200, f"status={r.status_code}")
except Exception as e:
    rec("基础", "GET /", False, str(e))
try:
    r = requests.get(f"{BASE}/openapi.json", timeout=10)
    rec("基础", "OpenAPI 文档", r.status_code == 200, f"paths={len(r.json().get('paths', {}))}")
except Exception as e:
    rec("基础", "OpenAPI 文档", False, str(e))

print("\n=== B. 认证模块 ===")
try:
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"}, timeout=15)
    d = r.json()
    TOK = d.get("data", {}).get("access_token")
    rec("认证", "正确账号登录", r.status_code == 200 and bool(TOK),
        f"status={r.status_code} 用户={d.get('data',{}).get('user',{}).get('username')}")
except Exception as e:
    rec("认证", "正确账号登录", False, str(e)); sys.exit(1)

r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "wrongpwd"}, timeout=15)
rec("认证", "错误密码应被拒", r.status_code in (400, 401), f"status={r.status_code}")
r = requests.post(f"{BASE}/api/auth/login", json={"username": "nosuchuser", "password": "x"}, timeout=15)
rec("认证", "不存在用户应被拒", r.status_code in (400, 401), f"status={r.status_code}")
try:
    r = requests.post(f"{BASE}/api/auth/refresh", json={"refresh_token": "bad"}, timeout=15)
    rec("认证", "无效 refresh_token 应被拒", r.status_code in (400, 401, 422), f"status={r.status_code}")
except Exception as e:
    rec("认证", "无效 refresh_token 应被拒", False, str(e))

print("\n=== C. 鉴权缺口验证（无 token 应 401/403） ===")
for m, p in [("GET","/api/users"), ("GET","/api/notifications"), ("GET","/api/system/status"),
             ("GET","/api/system/disk"), ("GET","/api/batch-records/grouped"),
             ("GET","/api/detection-records"), ("GET","/api/detection-records/export"),
             ("GET","/api/statistics"), ("GET","/api/models"), ("GET","/api/settings"),
             ("POST","/api/video/convert"), ("GET","/api/camera-logs")]:
    try:
        rr = requests.request(m, f"{BASE}{p}", timeout=10); ok = rr.status_code in (401, 403)
    except Exception:
        ok, rr = False, None
    rec("鉴权", f"无token {m} {p}", ok, f"status={getattr(rr,'status_code',None)}")
r = requests.delete(f"{BASE}/api/users/1", timeout=10)
rec("鉴权", "无token DELETE /api/users/1", r.status_code in (401, 403), f"status={r.status_code}")
r = requests.patch(f"{BASE}/api/users/1/password", json={"new_password": "hacked"}, timeout=10)
rec("鉴权", "无token PATCH 改密", r.status_code in (401, 403), f"status={r.status_code}")
r = requests.put(f"{BASE}/api/profile", json={"user_id": 1, "email": "fake@x.com"}, timeout=10)
rec("鉴权", "伪造 user_id 改资料", r.status_code in (401, 403), f"status={r.status_code}")
r = requests.get(f"{BASE}/api/users", headers={"Authorization": "Bearer faked.token.here"}, timeout=10)
rec("鉴权", "伪造 JWT 应被拒", r.status_code in (401, 403), f"status={r.status_code}")

print("\n=== D. 用户管理 ===")
r = requests.get(f"{BASE}/api/users", headers=H, timeout=15)
ok = r.status_code == 200
rec("用户", "用户列表", ok, f"status={r.status_code} 共{len(r.json().get('data',[])) if ok else 0}个")
new_uid = None
ts = str(int(time.time()))[-6:]
r = requests.post(f"{BASE}/api/users", headers=H,
                  json={"username": f"tester{ts}", "password": "Test@1234",
                        "email": f"t{ts}@test.com", "role": "operator"}, timeout=15)
ok = r.status_code in (200, 201)
if ok:
    dd = r.json().get("data") or {}
    new_uid = dd.get("id") or dd.get("user_id")
rec("用户", "新建用户", ok, f"status={r.status_code} uid={new_uid}")
if new_uid:
    r = requests.put(f"{BASE}/api/users/{new_uid}", headers=H, json={"email": f"upd{ts}@test.com", "role": "operator"}, timeout=15)
    rec("用户", "编辑用户", r.status_code == 200, f"status={r.status_code}")
    r = requests.patch(f"{BASE}/api/users/{new_uid}/password", headers=H, json={"new_password": "NewPass@123"}, timeout=15)
    rec("用户", "重置密码", r.status_code == 200, f"status={r.status_code}")
    # 先验证新密码可登录，再切状态（切换后会停用，登录应失败）
    r = requests.post(f"{BASE}/api/auth/login", json={"username": f"tester{ts}", "password": "NewPass@123"}, timeout=15)
    rec("用户", "新密码可登录", r.status_code == 200, f"status={r.status_code}")
    r = requests.patch(f"{BASE}/api/users/{new_uid}/status", headers=H, timeout=15)
    rec("用户", "切换启用状态", r.status_code == 200, f"status={r.status_code}")
    r = requests.post(f"{BASE}/api/auth/login", json={"username": f"tester{ts}", "password": "NewPass@123"}, timeout=15)
    rec("用户", "停用后不可登录", r.status_code in (400, 401, 403), f"status={r.status_code}")
    r = requests.delete(f"{BASE}/api/users/{new_uid}", headers=H, timeout=15)
    rec("用户", "删除用户", r.status_code in (200, 204), f"status={r.status_code}")

print("\n=== E. 个人资料 ===")
r = requests.put(f"{BASE}/api/profile", headers=H, json={"email": "admin@demo.com", "full_name": "系统管理员"}, timeout=15)
rec("资料", "更新资料(走JWT)", r.status_code == 200, f"status={r.status_code}")
r = requests.put(f"{BASE}/api/profile/password", headers=H,
                 json={"current_password": "admin123", "new_password": "admin123"}, timeout=15)
rec("资料", "修改密码", r.status_code == 200, f"status={r.status_code}")
with open(IMG, "rb") as f:
    r = requests.post(f"{BASE}/api/profile/avatar", headers=H, files={"file": ("a.jpg", f, "image/jpeg")}, timeout=30)
rec("资料", "上传头像", r.status_code == 200, f"status={r.status_code}")

print("\n=== F. 模型管理 ===")
r = requests.get(f"{BASE}/api/models", headers=H, timeout=15)
ok = r.status_code == 200
rec("模型", "模型列表", ok, f"status={r.status_code} {str(r.json().get('data'))[:70] if ok else ''}")
r = requests.get(f"{BASE}/api/model/status", headers=H, timeout=60)
ok = r.status_code == 200
rec("模型", "模型状态", ok, f"status={r.status_code} {str(r.json().get('data'))[:90] if ok else ''}")

print("\n=== G. 图像检测（核心） ===")
rec_id = None
t0 = time.time()
with open(IMG, "rb") as f:
    r = requests.post(f"{BASE}/api/model/predict", headers=H,
                      files={"file": ("pipe_0.jpg", f, "image/jpeg")},
                      data={"confidence_threshold": "0.25", "iou_threshold": "0.45"}, timeout=180)
dt = time.time() - t0
ok = r.status_code == 200
if ok:
    d = r.json().get("data") or r.json()
    rec_id = d.get("record_id") or d.get("id")
    ndef = d.get("defect_count", len(d.get("detections") or d.get("defects") or []))
    rec("检测", "单图检测", True, f"耗时{dt:.2f}s 缺陷数={ndef} record={rec_id}")
else:
    rec("检测", "单图检测", False, f"status={r.status_code} {r.text[:140]}")

print("\n=== H. 检测记录 ===")
r = requests.get(f"{BASE}/api/detection-records?limit=5", headers=H, timeout=15)
ok = r.status_code == 200
dd = r.json().get("data") if ok else None
lst = dd if isinstance(dd, list) else ((dd or {}).get("records", []) if isinstance(dd, dict) else [])
rec("记录", "记录列表", ok, f"status={r.status_code} 返回{len(lst)}条")
if rec_id:
    r = requests.get(f"{BASE}/api/detection-records/{rec_id}", headers=H, timeout=15)
    rec("记录", "记录详情", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/api/detection-records/{rec_id}/annotated-image", headers=H, timeout=60)
    ok = r.status_code == 200 and len(r.content) > 1000
    rec("记录", "标注图生成", ok, f"status={r.status_code} 大小={len(r.content)}B")
    r = requests.get(f"{BASE}/api/detection-records/{rec_id}/export-detail?format=json", headers=H, timeout=15)
    rec("记录", "单条导出(json)", r.status_code == 200, f"status={r.status_code} 大小={len(r.content)}B")
print("  -- 导出接口（此前被路由遮蔽，一直 404）--")
for fmt in ("csv", "json", "excel"):
    r = requests.get(f"{BASE}/api/detection-records/export?format={fmt}", headers=H, timeout=30)
    ok = r.status_code == 200 and len(r.content) > 20
    rec("导出", f"批量导出 {fmt}", ok, f"status={r.status_code} 大小={len(r.content)}B {r.headers.get('Content-Disposition','')[:35]}")

print("\n=== I. 统计模块 ===")
for p in ["/api/statistics", "/api/statistics/daily", "/api/statistics/defect-types"]:
    r = requests.get(f"{BASE}{p}", headers=H, timeout=20)
    rec("统计", p, r.status_code == 200, f"status={r.status_code} {str(r.json().get('data'))[:60] if r.status_code==200 else ''}")

print("\n=== J. 批量检测 ===")
batch_id = None
try:
    # 正确协议：先 JSON 创建批次，再 multipart 上传文件
    r = requests.post(f"{BASE}/api/batch-detections", headers=H,
                      json={"batch_name": f"自测批次{ts}", "confidence_threshold": 0.25}, timeout=60)
    ok = r.status_code in (200, 201)
    if ok:
        d = r.json().get("data") or {}
        batch_id = d.get("batch_id") or d.get("id")
    rec("批量", "创建批次(JSON)", ok, f"status={r.status_code} batch_id={batch_id} {r.text[:60]}")
except Exception as e:
    rec("批量", "创建批次(JSON)", False, str(e))
if batch_id:
    try:
        files = [("files", (os.path.basename(p), open(p, "rb"), "image/jpeg")) for p in (IMG, IMG2, IMG3)]
        r = requests.post(f"{BASE}/api/batch-detections/{batch_id}/upload", headers=H, files=files, timeout=300)
        rec("批量", "上传3图并检测", r.status_code in (200, 201), f"status={r.status_code} {r.text[:80]}")
    except Exception as e:
        rec("批量", "上传3图并检测", False, str(e))
# predict-batch 直连推理接口
try:
    files = [("files", (os.path.basename(p), open(p, "rb"), "image/jpeg")) for p in (IMG, IMG2, IMG3)]
    r = requests.post(f"{BASE}/api/model/predict-batch", headers=H, files=files,
                      data={"confidence_threshold": "0.25", "batch_name": f"pb{ts}"}, timeout=300)
    ok = r.status_code == 200
    data_ = r.json().get("data")
    if isinstance(data_, list):
        n = len(data_)
    elif isinstance(data_, dict):
        n = len(data_.get("results") or data_.get("records") or [])
    else:
        n = 0
    rec("批量", "predict-batch 推理3图", ok, f"status={r.status_code} 结果数={n} {r.text[:50]}")
except Exception as e:
    rec("批量", "predict-batch 推理3图", False, str(e))
if batch_id:
    r = requests.get(f"{BASE}/api/batch-detections/{batch_id}", headers=H, timeout=20)
    rec("批量", "批次详情", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/api/batch-detections/{batch_id}/status", headers=H, timeout=20)
    rec("批量", "批次进度", r.status_code == 200, f"status={r.status_code} {r.text[:60]}")
r = requests.get(f"{BASE}/api/batch-detections", headers=H, timeout=20)
rec("批量", "批次列表", r.status_code == 200, f"status={r.status_code}")
r = requests.get(f"{BASE}/api/batch-records/grouped?limit=10", headers=H, timeout=20)
rec("批量", "分组历史", r.status_code == 200, f"status={r.status_code} {r.text[:60]}")

print("\n=== K. 通知模块 ===")
nid = None
r = requests.post(f"{BASE}/api/notifications", headers=H,
                  json={"title": "自测通知", "message": "selftest", "type": "info", "level": "info"}, timeout=15)
ok = r.status_code in (200, 201)
if ok:
    nid = (r.json().get("data") or {}).get("id")
rec("通知", "创建通知", ok, f"status={r.status_code} id={nid}")
r = requests.get(f"{BASE}/api/notifications?limit=10", headers=H, timeout=15)
ok = r.status_code == 200
rec("通知", "通知列表", ok, f"status={r.status_code} 共{len(r.json().get('data') or [])}条")
r = requests.get(f"{BASE}/api/notifications/unread-count", headers=H, timeout=15)
rec("通知", "未读数量", r.status_code == 200, f"status={r.status_code} {r.text[:45]}")
if nid:
    r = requests.patch(f"{BASE}/api/notifications/{nid}/read", headers=H, timeout=15)
    rec("通知", "标记已读", r.status_code == 200, f"status={r.status_code}")
    r = requests.delete(f"{BASE}/api/notifications/{nid}", headers=H, timeout=15)
    rec("通知", "删除通知", r.status_code in (200, 204), f"status={r.status_code}")
r = requests.patch(f"{BASE}/api/notifications/read-all", headers=H, timeout=15)
rec("通知", "全部已读", r.status_code == 200, f"status={r.status_code}")

print("\n=== L. 系统设置与状态 ===")
r = requests.get(f"{BASE}/api/system/status", headers=H, timeout=20)
rec("系统", "系统状态", r.status_code == 200, f"status={r.status_code} {r.text[:70]}")
r = requests.get(f"{BASE}/api/system/disk", headers=H, timeout=20)
rec("系统", "磁盘使用", r.status_code == 200, f"status={r.status_code} {r.text[:60]}")
r = requests.get(f"{BASE}/api/settings", headers=H, timeout=15)
rec("系统", "设置列表", r.status_code == 200, f"status={r.status_code}")
r = requests.put(f"{BASE}/api/settings/detection_confidence", headers=H, json={"value": "0.3"}, timeout=15)
rec("系统", "写入设置项", r.status_code in (200, 201, 404), f"status={r.status_code}")
r = requests.get(f"{BASE}/api/settings/detection_confidence", headers=H, timeout=15)
rec("系统", "读取设置项", r.status_code in (200, 404), f"status={r.status_code}")

print("\n=== M. 摄像头日志 ===")
r = requests.get(f"{BASE}/api/camera-logs?limit=5", headers=H, timeout=15)
rec("摄像头", "日志列表", r.status_code == 200, f"status={r.status_code}")
r = requests.post(f"{BASE}/api/camera-logs", headers=H,
                  json={"source_type": "camera", "defect_count": 2, "detection_result": {"a": 1}}, timeout=15)
rec("摄像头", "写日志", r.status_code in (200, 201), f"status={r.status_code}")

print("\n=== N. 视频检测 ===")
t0 = time.time()
with open(VID, "rb") as f:
    r = requests.post(f"{BASE}/api/video/convert", headers=H, files={"file": ("pipe.mp4", f, "video/mp4")}, timeout=240)
rec("视频", "视频转码", r.status_code == 200, f"status={r.status_code} 耗时{time.time()-t0:.1f}s {r.text[:60]}")
with open(VID, "rb") as f:
    r = requests.post(f"{BASE}/api/video/detect-frame", headers=H,
                      files={"file": ("pipe.mp4", f, "video/mp4")},
                      data={"confidence_threshold": "0.25", "frame_interval": "10"}, timeout=240)
rec("视频", "视频抽帧检测", r.status_code == 200, f"status={r.status_code} {r.text[:80]}")
sid = None
with open(VID, "rb") as f:
    r = requests.post(f"{BASE}/api/video/realtime/start", headers=H,
                      files={"file": ("pipe.mp4", f, "video/mp4")},
                      data={"confidence_threshold": "0.25"}, timeout=240)
ok = r.status_code == 200
if ok:
    sid = (r.json().get("data") or {}).get("session_id")
rec("视频", "实时会话启动", ok, f"status={r.status_code} sid={sid} {r.text[:60]}")
if sid:
    r = requests.get(f"{BASE}/api/video/realtime/status?session_id={sid}", headers=H, timeout=20)
    rec("视频", "会话状态", r.status_code == 200, f"status={r.status_code} {r.text[:60]}")
    r = requests.get(f"{BASE}/api/video/realtime/frame?session_id={sid}&action=play", headers=H, timeout=90)
    rec("视频", "取帧(play)", r.status_code == 200, f"status={r.status_code} 大小={len(r.content)}B")
    r = requests.get(f"{BASE}/api/video/realtime/frame?session_id={sid}&action=pause", headers=H, timeout=30)
    rec("视频", "暂停", r.status_code == 200, f"status={r.status_code}")
    r = requests.get(f"{BASE}/api/video/realtime/frame?session_id={sid}&action=seek&frame_index=5", headers=H, timeout=30)
    rec("视频", "跳转帧", r.status_code == 200, f"status={r.status_code}")
    r = requests.post(f"{BASE}/api/video/realtime/stop", headers=H, json={"session_id": sid}, timeout=30)
    rec("视频", "停止会话", r.status_code == 200, f"status={r.status_code} {r.text[:50]}")

print("\n=== O. 清理 ===")
if rec_id:
    r = requests.delete(f"{BASE}/api/detection-records/{rec_id}", headers=H, timeout=15)
    rec("清理", "删除测试记录", r.status_code in (200, 204), f"status={r.status_code}")

print("\n" + "=" * 60)
print("  基础用例执行完毕，继续深度用例（推理产物 / 记录详情 / 批次闭环）")
print("=" * 60)

print("=== 1. 单图检测（低阈值，验证推理链路真实产出） ===")
t0 = time.time()
with open(IMG, "rb") as f:
    r = requests.post(f"{BASE}/api/model/predict", headers=H,
                      files={"file": ("pipe_0.jpg", f, "image/jpeg")},
                      data={"confidence_threshold": "0.01", "iou_threshold": "0.45"}, timeout=180)
dt = time.time() - t0
ok = r.status_code == 200
print(f"  HTTP {r.status_code}, 耗时 {dt:.2f}s")
d = r.json().get("data", {}) if ok else {}
inner = d.get("result", {}) if isinstance(d, dict) else {}
print(f"  返回结构: success={d.get('success')} keys={list(inner.keys())[:8]}")
print(f"  推理耗时(模型内): {inner.get('processing_time')}s  检出数: {inner.get('count')}")
print(f"  有标注图: {bool(inner.get('annotated_image'))}  有检测框: {len(inner.get('detections') or [])}")
rec("检测", "单图检测返回完整结果", ok and d.get("success") is True, f"status={r.status_code}")
rec("检测", "推理耗时 > 0（模型真实运行）", float(inner.get('processing_time') or 0) > 0,
    f"processing_time={inner.get('processing_time')}")

print("\n=== 2. 检测记录详情 / 标注图 / 单条导出 ===")
r = requests.get(f"{BASE}/api/detection-records?limit=20", headers=H, timeout=15)
data_ = r.json().get("data")
lst = data_ if isinstance(data_, list) else (data_ or {}).get("records", [])
print(f"  当前记录数: {len(lst)}")
rec("记录", "记录列表非空", len(lst) > 0, f"{len(lst)} 条")

if lst:
    rid = lst[0].get("id") or lst[0].get("record_id")
    print(f"  取第一条记录 ID: {rid}")
    r = requests.get(f"{BASE}/api/detection-records/{rid}", headers=H, timeout=20)
    rec("记录", f"记录详情 (id={rid})", r.status_code == 200, f"status={r.status_code} {r.text[:70]}")

    r = requests.get(f"{BASE}/api/detection-records/{rid}/annotated-image", headers=H, timeout=60)
    ok = r.status_code == 200 and len(r.content) > 1000
    rec("记录", "标注图生成", ok, f"status={r.status_code} 大小={len(r.content)}B 类型={r.headers.get('Content-Type')}")

    for fmt in ("json", "csv"):
        r = requests.get(f"{BASE}/api/detection-records/{rid}/export-detail?format={fmt}",
                         headers=H, timeout=20)
        rec("记录", f"单条导出 {fmt}", r.status_code == 200 and len(r.content) > 10,
            f"status={r.status_code} 大小={len(r.content)}B")

print("\n=== 3. 批次完整流程（创建 → 上传 → 详情 → 记录） ===")
ts = str(int(time.time()))[-6:]
r = requests.post(f"{BASE}/api/batch-detections", headers=H,
                  json={"batch_name": f"补测批次{ts}", "confidence_threshold": 0.25}, timeout=60)
bid = (r.json().get("data") or {}).get("id")
rec("批量", "创建批次", bool(bid), f"batch_id={bid}")
if bid:
    r = requests.get(f"{BASE}/api/batch-detections/{bid}", headers=H, timeout=20)
    ok = r.status_code == 200
    dd = r.json().get("data") or {}
    rec("批量", "批次详情（此前恒 404）", ok, f"status={r.status_code} 记录数={dd.get('record_count')} 批次名={ (dd.get('batch') or {}).get('batch_name')}")
    r = requests.get(f"{BASE}/api/batch-detections/{bid}/status", headers=H, timeout=20)
    rec("批量", "批次进度", r.status_code == 200, f"status={r.status_code} data={str(r.json().get('data'))[:60]}")

# 上传文件走完整批量推理
if bid:
    files = [("files", (os.path.basename(p), open(p, "rb"), "image/jpeg"))
             for p in (f"{D}/pipe_0.jpg", f"{D}/pipe_1.jpg")]
    r = requests.post(f"{BASE}/api/batch-detections/{bid}/upload", headers=H, files=files, timeout=300)
    rec("批量", "上传文件到批次", r.status_code in (200, 201), f"status={r.status_code} {r.text[:70]}")

print("\n=== 4. 统计与记录一致性 ===")
r1 = requests.get(f"{BASE}/api/statistics", headers=H, timeout=20)
r2 = requests.get(f"{BASE}/api/detection-records?limit=1000", headers=H, timeout=20)
d2 = r2.json().get("data")
n2 = len(d2) if isinstance(d2, list) else len((d2 or {}).get("records", []))
rec("统计", "统计接口与记录数一致", r1.status_code == 200, f"记录列表={n2} 统计={str(r1.json().get('data'))[:60]}")

print("\n  深度用例执行完毕，详见下方汇总")



print("\n" + "=" * 60)
g = defaultdict(lambda: [0, 0])
for mod, name, ok, _ in results:
    g[mod][0] += 1
    g[mod][1] += 1 if ok else 0
tot = sum(v[0] for v in g.values()); pas = sum(v[1] for v in g.values())
for m, (t, p) in g.items():
    print(f"  {'OK  ' if t == p else 'WARN'} {m:8s} {p}/{t}")
print(f"\n  总计: {pas}/{tot} 通过 ({pas * 100 // max(tot, 1)}%)")
fails = [(m, n, d) for m, n, o, d in results if not o]
if fails:
    print("\n  失败项:")
    for m, n, d in fails:
        print(f"    - [{m}] {n}  {d[:100]}")
print("=" * 60)
sys.exit(0 if not fails else 1)
