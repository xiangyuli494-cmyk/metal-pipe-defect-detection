"""
检测服务 - 处理所有检测相关的业务逻辑
支持云数据库(Supabase)和本地MySQL
"""
import os
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import uuid

from backend.config.database import db_manager


class DetectionService:
    """检测服务类"""

    def __init__(self):
        self.db_type = db_manager.config.type
        self.db_manager = db_manager

    async def get_detection_records(
        self,
        user_id: Optional[str] = None,
        detection_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取检测记录列表"""
        if self.db_type == 'supabase':
            return await self._get_detection_records_supabase(
                user_id, detection_type, limit, offset
            )
        else:
            return await self._get_detection_records_mysql(
                user_id, detection_type, limit, offset
            )

    async def _get_detection_records_supabase(
        self, user_id, detection_type, limit, offset
    ) -> List[Dict[str, Any]]:
        """从Supabase获取检测记录"""
        from supabase import create_client

        config = db_manager.get_supabase_config()
        supabase = create_client(config['url'], config['key'])

        query = supabase.table('detection_records').select('*')

        if user_id:
            query = query.eq('user_id', user_id)
        if detection_type:
            query = query.eq('detection_type', detection_type)

        query = query.order('created_at', desc=True).limit(limit).offset(offset)
        result = query.execute()

        return result.data if result.data else []

    async def _get_detection_records_mysql(
        self, user_id, detection_type, limit, offset
    ) -> List[Dict[str, Any]]:
        """从MySQL获取检测记录 - 适配 metal_defect_detection 数据库"""
        import pymysql
        import json

        conn = pymysql.connect(
            host=self.db_manager.config.host,
            port=self.db_manager.config.port,
            user=self.db_manager.config.user,
            password=self.db_manager.config.password,
            database=self.db_manager.config.database,
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor
        )

        try:
            with conn.cursor() as cursor:
                # 构建查询条件
                conditions = []
                params = []
                
                if user_id:
                    conditions.append("username = %s")
                    params.append(user_id)
                
                if detection_type:
                    conditions.append("detection_type = %s")
                    params.append(detection_type)
                
                where_clause = " AND ".join(conditions) if conditions else "1=1"
                
                # 适配 metal_defect_detection 数据库的实际表结构
                sql = f"""
                    SELECT 
                        id, detection_id, filename, file_path, original_size, processed_size,
                        defect_count, defect_types, confidence_scores, defects,
                        detection_time, processing_time_ms, status, batch_id, detection_type,
                        result_image_url, original_image_url, created_at, updated_at, username
                    FROM detection_records
                    WHERE {where_clause}
                    ORDER BY id DESC
                    LIMIT %s OFFSET %s
                """
                
                params.extend([limit, offset])

                cursor.execute(sql, params)
                rows = cursor.fetchall()

                records = []
                for row in rows:
                    record = dict(row)
                    # 解析JSON字段
                    if record.get('defects'):
                        try:
                            record['defect_details'] = json.loads(record['defects'])
                        except:
                            record['defect_details'] = []
                    # 添加字段别名以兼容前端
                    record['original_filename'] = record.get('filename', '')
                    record['image_url'] = record.get('original_image_url', '')
                    record['result_image_url'] = record.get('result_image_url', '')
                    record['processing_time'] = (record.get('processing_time_ms') or 0) / 1000
                    record['created_at'] = str(record.get('detection_time'))
                    record['confidence'] = record.get('confidence_scores')
                    # 确保 detection_type 字段存在
                    record['detection_type'] = record.get('detection_type', 'single')
                    records.append(record)

                return records
        finally:
            conn.close()

    async def get_detection_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        """获取单个检测记录"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('detection_records').select('*').eq('id', record_id).single().execute()
            return result.data if result.data else None
        else:
            import pymysql

            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )

            try:
                with conn.cursor() as cursor:
                    # 适配 metal_defect_detection 数据库
                    cursor.execute(
                        "SELECT * FROM detection_records WHERE id = %s OR detection_id = %s",
                        (record_id, record_id)
                    )
                    row = cursor.fetchone()
                    if row:
                        record = dict(row)
                        # 解析JSON字段
                        if record.get('defects'):
                            try:
                                record['defect_details'] = json.loads(record['defects'])
                            except:
                                record['defect_details'] = []
                        # 添加字段别名
                        record['original_filename'] = record.get('filename', '')
                        record['image_url'] = record.get('original_image_url', '')
                        record['result_image_url'] = record.get('result_image_url', '')
                        record['processing_time'] = (record.get('processing_time_ms') or 0) / 1000
                        record['created_at'] = str(record.get('detection_time'))
                        return record
                    return None
            finally:
                # 修复：此前 finally 里写了 `return None`，会覆盖 try 中的
                # `return record`，导致所有记录详情恒返回 None（页面永远 404）
                conn.close()

    async def create_detection_record(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """创建检测记录"""
        record_id = str(uuid.uuid4())
        record_data = {
            'id': record_id,
            'user_id': data.get('user_id'),
            'detection_type': data.get('detection_type', 'single'),
            'original_filename': data.get('original_filename', ''),
            'confidence_threshold': data.get('confidence_threshold', 0.5),
            'status': 'pending',
            'created_at': datetime.now().isoformat()
        }

        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('detection_records').insert(record_data).execute()
            return result.data[0] if result.data else record_data
        else:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_manager.get_mysql_connection_string())

            with engine.connect() as conn:
                conn.execute(
                    text("""
                        INSERT INTO detection_records
                        (id, user_id, detection_type, original_filename, confidence_threshold, status, created_at)
                        VALUES (:id, :user_id, :detection_type, :original_filename, :confidence_threshold, :status, NOW())
                    """),
                    record_data
                )
                conn.commit()
                return record_data

    async def process_image(self, record_id: str, file) -> Dict[str, Any]:
        """处理上传的图片"""
        # 这里应该调用AI模型进行推理
        # 暂时返回模拟数据
        return {
            'record_id': record_id,
            'filename': file.filename,
            'status': 'processing',
            'message': '图片已接收，正在处理中'
        }

    async def delete_detection_record(self, record_id: str) -> bool:
        """删除检测记录及其关联的本地图片文件"""
        import os
        import glob
        from pathlib import Path
        
        # 获取项目根目录和上传目录
        project_root = Path(__file__).parent.parent.parent
        upload_dir = project_root / "uploads"
        
        print(f"🗑️ 准备删除检测记录: {record_id}")
        
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            supabase.table('detection_records').delete().eq('id', record_id).execute()
            print(f"✅ Supabase检测记录已删除: {record_id}")
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4'
            )

            try:
                with conn.cursor(pymysql.cursors.DictCursor) as cursor:
                    # 先获取图片路径 - 直接用 id 字段查询
                    record = None
                    
                    # 直接按 id 查询（id 可能是数字或字符串）
                    cursor.execute(
                        "SELECT id, original_image_url, result_image_url, filename FROM detection_records WHERE id = %s",
                        (record_id,)
                    )
                    record = cursor.fetchone()
                    print(f"🔍 查询结果: {record}")
                    
                    # 如果没找到，尝试把 record_id 当作数字查询
                    if not record:
                        try:
                            numeric_id = int(record_id)
                            cursor.execute(
                                "SELECT id, original_image_url, result_image_url, filename FROM detection_records WHERE id = %s",
                                (numeric_id,)
                            )
                            record = cursor.fetchone()
                            print(f"🔍 按数字ID查询结果: {record}")
                        except ValueError:
                            pass
                    
                    # 删除本地图片文件
                    if record:
                        original_url = record.get('original_image_url') or ''
                        result_url = record.get('result_image_url') or ''
                        filename = record.get('filename') or ''
                        
                        # 删除原图
                        if original_url:
                            img_path = project_root / original_url.lstrip('/')
                            if img_path.exists():
                                os.remove(img_path)
                                print(f"✅ 已删除原图: {img_path}")
                        
                        # 删除标注图
                        if result_url:
                            annotated_path = project_root / result_url.lstrip('/')
                            if annotated_path.exists():
                                os.remove(annotated_path)
                                print(f"✅ 已删除标注图: {annotated_path}")
                        
                        # 同时删除同名文件（如果有）
                        if filename:
                            for pattern in ['*' + filename, filename]:
                                for f in glob.glob(str(upload_dir / pattern)):
                                    try:
                                        os.remove(f)
                                        print(f"✅ 已删除: {f}")
                                    except:
                                        pass
                    
                    # 删除数据库记录 - 直接按 id 删除
                    deleted = cursor.execute(
                        "DELETE FROM detection_records WHERE id = %s",
                        (record_id,)
                    )
                    print(f"🗑️ DELETE影响行数: {deleted}")
                    
                    # 如果没删到，尝试数字ID
                    if deleted == 0:
                        try:
                            numeric_id = int(record_id)
                            deleted = cursor.execute(
                                "DELETE FROM detection_records WHERE id = %s",
                                (numeric_id,)
                            )
                            print(f"🗑️ 数字ID DELETE影响行数: {deleted}")
                        except ValueError:
                            print(f"⚠️ 无法将 {record_id} 转换为数字ID")
                    
                    conn.commit()
                    print(f"✅ 检测记录已从数据库删除: {record_id}")
            finally:
                conn.close()
        return True

    async def get_batch_detections(
        self, user_id: Optional[str] = None, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取批量检测任务列表"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            query = supabase.table('batch_detections').select('*')
            if user_id:
                query = query.eq('user_id', user_id)

            query = query.order('created_at', desc=True).limit(limit).offset(offset)
            result = query.execute()
            return result.data if result.data else []
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )

            try:
                with conn.cursor() as cursor:
                    sql = """
                        SELECT * FROM batch_detections
                        {}
                        ORDER BY id DESC
                        LIMIT %s OFFSET %s
                    """.format("WHERE username = %s" if user_id else "WHERE 1=1")

                    params = []
                    if user_id:
                        params.append(user_id)
                    params.extend([limit, offset])

                    cursor.execute(sql, params)
                    rows = cursor.fetchall()
                    
                    # 转换数据格式
                    results = []
                    for row in rows:
                        result = dict(row)
                        # 解析JSON字段
                        if result.get('result_summary'):
                            import json
                            try:
                                result['result_summary'] = json.loads(result['result_summary'])
                            except:
                                pass
                        results.append(result)
                    return results
            finally:
                conn.close()

    async def create_batch_detection(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """创建批量检测任务"""
        batch_id = str(uuid.uuid4())
        batch_data = {
            'id': batch_id,
            'user_id': data.get('user_id'),
            'batch_name': data.get('batch_name', ''),
            'status': 'pending',
            'created_at': datetime.now().isoformat()
        }

        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('batch_detections').insert(batch_data).execute()
            return result.data[0] if result.data else batch_data
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4'
            )

            try:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO batch_detections
                        (batch_id, username, total_files, status, start_time)
                        VALUES (%s, %s, %s, %s, NOW())
                    """, (
                        batch_id,
                        data.get('username') or data.get('user_id') or 'unknown',
                        data.get('total_files', 0),
                        'pending'
                    ))
                    # 修复：此前缺少 commit，INSERT 在连接关闭时被回滚，
                    # 批次记录从未真正入库 —— 详情接口恒 404、进度接口恒返回 null
                    conn.commit()
                    batch_data['id'] = batch_id
                    return batch_data
            finally:
                conn.close()

    async def process_batch_files(self, batch_id: str, files) -> Dict[str, Any]:
        """处理批量文件"""
        return {
            'batch_id': batch_id,
            'file_count': len(files),
            'status': 'processing',
            'message': '文件已接收，正在批量处理中'
        }

    async def get_batch_status(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """获取批量检测任务状态"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('batch_detections').select('*').eq('id', batch_id).single().execute()
            return result.data if result.data else None
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )

            try:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM batch_detections WHERE batch_id = %s",
                        (batch_id,)
                    )
                    row = cursor.fetchone()
                    return dict(row) if row else None
            finally:
                conn.close()

    async def get_camera_logs(
        self,
        user_id: Optional[str] = None,
        source_type: Optional[str] = None,
        saved_only: bool = False,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """获取摄像头检测日志"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            query = supabase.table('camera_detection_logs').select('*')

            if user_id:
                query = query.eq('user_id', user_id)
            if source_type:
                query = query.eq('source_type', source_type)
            if saved_only:
                query = query.eq('saved', True)

            query = query.order('created_at', desc=True).limit(limit).offset(offset)
            result = query.execute()
            return result.data if result.data else []
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )

            try:
                results = []
                
                # 根据 source_type 查询对应的检测记录
                # video 检测 → detection_type='video'
                # camera 检测 → detection_type='camera'
                target_type = source_type if source_type else None
                
                if target_type in ('video', 'camera'):
                    # 从 detection_records 表查询视频或摄像头检测记录
                    with conn.cursor() as cursor:
                        sql = """
                            SELECT id, detection_id, detection_type, filename, 
                                   defect_count, defects, confidence_scores, 
                                   original_image_url, result_image_url, 
                                   detection_time, created_at, username
                            FROM detection_records
                            WHERE detection_type = %s
                            ORDER BY detection_time DESC
                        """
                        cursor.execute(sql, (target_type,))
                        rows = cursor.fetchall()
                        
                        for row in rows:
                            # 解析缺陷数据
                            defects = []
                            if row.get('defects'):
                                if isinstance(row['defects'], str):
                                    try:
                                        import json
                                        defects = json.loads(row['defects'])
                                    except:
                                        defects = []
                                elif isinstance(row['defects'], list):
                                    defects = row['defects']
                            
                            # 提取主要缺陷类型和置信度
                            main_defect = defects[0] if defects else {}
                            defect_type = main_defect.get('class', 'defect')
                            confidence = float(main_defect.get('confidence', 0))
                            
                            # 确定严重程度
                            if confidence > 0.8:
                                severity = 'error'
                            elif confidence > 0.5:
                                severity = 'warning'
                            else:
                                severity = 'info'
                            
                            result = {
                                'id': str(row.get('id', '')),
                                'source_type': target_type,
                                'source_name': row.get('filename', f"{'视频' if target_type == 'video' else '摄像头'}检测"),
                                'defect_type': defect_type,
                                'confidence': confidence,
                                'severity': severity,
                                'message': f"检测到 {row.get('defect_count', 0)} 个缺陷",
                                'image_url': row.get('original_image_url') or row.get('result_image_url'),
                                'result_image_url': row.get('result_image_url'),
                                'original_image_url': row.get('original_image_url'),
                                'saved': True,
                                'defect_count': row.get('defect_count', 0),
                                'defects': defects,
                                'username': row.get('username'),
                                'created_at': str(row.get('detection_time') or row.get('created_at', ''))
                            }
                            results.append(result)
                
                # 按时间排序
                results.sort(key=lambda x: x.get('created_at', ''), reverse=True)
                
                # 应用分页
                return results[offset:offset+limit]
                        
            finally:
                conn.close()

    async def create_camera_log(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """创建摄像头检测日志"""
        log_id = str(uuid.uuid4())
        log_data = {
            'id': log_id,
            'user_id': data.get('user_id'),
            'source_type': data.get('source_type', 'camera'),
            'source_name': data.get('source_name', ''),
            'defect_type': data.get('defect_type', ''),
            'confidence': data.get('confidence', 0),
            'severity': data.get('severity', 'info'),
            'message': data.get('message', ''),
            'image_url': data.get('image_url'),
            'saved': False,
            'created_at': datetime.now().isoformat()
        }

        bbox = data.get('bbox')
        if bbox:
            log_data['bbox_x'] = bbox.get('x')
            log_data['bbox_y'] = bbox.get('y')
            log_data['bbox_width'] = bbox.get('width')
            log_data['bbox_height'] = bbox.get('height')

        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('camera_detection_logs').insert(log_data).execute()
            return result.data[0] if result.data else log_data
        else:
            import pymysql
            import json
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )

            try:
                with conn.cursor() as cursor:
                    # 保存到 camera_detections 表
                    cursor.execute("""
                        INSERT INTO camera_detections
                        (session_id, frame_index, defect_detected, defect_count, 
                         confidence, frame_path, detection_data, timestamp)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    """, (
                        data.get('source_name', 'camera'),
                        0,  # frame_index
                        1 if data.get('defect_type') else 0,  # defect_detected
                        1 if data.get('defect_type') else 0,  # defect_count
                        data.get('confidence', 0),
                        data.get('image_url', ''),
                        json.dumps({
                            'defect_type': data.get('defect_type', ''),
                            'message': data.get('message', ''),
                            'bbox': data.get('bbox', {})
                        }) if data.get('defect_type') else None
                    ))
                    conn.commit()
                    log_data['id'] = str(cursor.lastrowid)
                    return log_data
            finally:
                conn.close()

    async def save_camera_logs(self, log_ids: List[str], user_id: Optional[str] = None) -> Dict[str, Any]:
        """保存选中的摄像头检测日志（摄像头检测已自动保存到数据库）"""
        # camera_detections 表中的记录已经是已检测到的缺陷帧，无需额外保存
        return {'saved_count': len(log_ids)}

    async def delete_camera_log(self, log_id: str) -> bool:
        """删除摄像头检测日志"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            supabase.table('camera_detection_logs').delete().eq('id', log_id).execute()
        else:
            import pymysql
            
            conn = pymysql.connect(
                host=self.db_manager.config.host,
                port=self.db_manager.config.port,
                user=self.db_manager.config.user,
                password=self.db_manager.config.password,
                database=self.db_manager.config.database,
                charset='utf8mb4'
            )

            try:
                with conn.cursor() as cursor:
                    cursor.execute("DELETE FROM camera_detections WHERE id = %s", (log_id,))
                    conn.commit()
            finally:
                conn.close()
        return True

    async def get_statistics(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """获取统计数据"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            # 获取总检测数
            query = supabase.table('detection_records').select('*', count='exact')
            if user_id:
                query = query.eq('user_id', user_id)
            total_result = query.execute()
            total_count = total_result.count if hasattr(total_result, 'count') else 0

            # 获取总缺陷数
            defect_result = supabase.table('detection_records').select('defect_count')
            if user_id:
                defect_result = defect_result.eq('user_id', user_id)
            defect_data = defect_result.execute()
            total_defects = sum(d.get('defect_count', 0) for d in defect_data.data) if defect_data.data else 0

            return {
                'total_detections': total_count,
                'total_defects': total_defects,
                'total_batches': 0,
                'total_camera_logs': 0
            }
        else:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_manager.get_mysql_connection_string())

            with engine.connect() as conn:
                # 总检测数
                sql_count = "SELECT COUNT(*) as count FROM detection_records"
                sql_defects = "SELECT COALESCE(SUM(defect_count), 0) as total FROM detection_records"

                if user_id:
                    sql_count += " WHERE user_id = :user_id"
                    sql_defects += " WHERE user_id = :user_id"

                result_count = conn.execute(text(sql_count), {'user_id': user_id} if user_id else {})
                result_defects = conn.execute(text(sql_defects), {'user_id': user_id} if user_id else {})

                total_count = result_count.fetchone()[0]
                total_defects = result_defects.fetchone()[0]

                return {
                    'total_detections': total_count,
                    'total_defects': total_defects,
                    'total_batches': 0,
                    'total_camera_logs': 0
                }

    async def get_daily_statistics(self, user_id: Optional[str] = None, days: int = 7) -> List[Dict[str, Any]]:
        """获取每日统计数据"""
        # 返回模拟数据
        result = []
        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
            result.append({
                'date': date,
                'count': 0,
                'defects': 0
            })
        return result

    async def get_defect_type_statistics(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取缺陷类型统计"""
        # 返回模拟数据
        defect_types = ['裂纹', '腐蚀', '点蚀', '划痕', '凹痕', '磨损', '锈蚀', '孔洞', '变形', '其他']
        return [{'type': t, 'count': 0} for t in defect_types]

    async def get_settings(self) -> Dict[str, Any]:
        """获取系统设置"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            result = supabase.table('system_settings').select('*').execute()
            settings = {}
            for item in result.data if result.data else []:
                settings[item['setting_key']] = item['setting_value']
            return settings
        else:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_manager.get_mysql_connection_string())

            with engine.connect() as conn:
                result = conn.execute(text("SELECT setting_key, setting_value FROM system_settings"))
                rows = result.fetchall()
                return {row[0]: row[1] for row in rows}

    async def get_setting(self, key: str) -> Optional[str]:
        """获取单个设置"""
        settings = await self.get_settings()
        return settings.get(key)

    async def update_setting(self, key: str, value: str) -> bool:
        """更新设置"""
        if self.db_type == 'supabase':
            from supabase import create_client
            config = db_manager.get_supabase_config()
            supabase = create_client(config['url'], config['key'])

            supabase.table('system_settings').update({'setting_value': value}).eq('setting_key', key).execute()
        else:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_manager.get_mysql_connection_string())

            with engine.connect() as conn:
                conn.execute(
                    text("UPDATE system_settings SET setting_value = :value WHERE setting_key = :key"),
                    {'key': key, 'value': value}
                )
                conn.commit()
        return True
