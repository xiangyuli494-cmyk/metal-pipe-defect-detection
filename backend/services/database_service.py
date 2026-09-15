"""
数据库服务 - 保存检测记录到真实数据库
"""
import os
import sys
import json
import pymysql
from datetime import datetime
from typing import Dict, Any, List, Optional
import uuid

# 导入数据库管理器
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.config.database import db_manager

class DatabaseService:
    """数据库服务类"""
    
    def __init__(self):
        self.connection = None
        self._db_manager = None
        self.connect()
    
    @property
    def db_manager(self):
        """延迟加载 db_manager 以避免循环导入问题"""
        if self._db_manager is None:
            from backend.config.database import db_manager
            self._db_manager = db_manager
        return self._db_manager
    
    def connect(self):
        """连接到MySQL数据库 - 使用db_manager配置"""
        try:
            if self.db_manager.config.type == 'mysql':
                self.connection = pymysql.connect(
                    host=self.db_manager.config.host,
                    port=self.db_manager.config.port,
                    user=self.db_manager.config.user,
                    password=self.db_manager.config.password,
                    database=self.db_manager.config.database,
                    charset='utf8mb4',
                    cursorclass=pymysql.cursors.DictCursor
                )
                print(f"✅ MySQL数据库连接成功: {self.db_manager.config.database}")
            else:
                print("⚠️ DatabaseService 仅支持 MySQL 数据库")
                self.connection = None
        except Exception as e:
            print(f"❌ 数据库连接失败: {e}")
            self.connection = None
    
    def is_connected(self) -> bool:
        """检查数据库连接状态"""
        return self.connection is not None and self.connection.open
    
    def save_detection_record(self, record_data: Dict[str, Any]) -> Optional[int]:
        """
        保存检测记录到数据库
        
        参数:
            record_data: 检测记录数据，包含以下字段:
                - user_id: 用户ID (可选)
                - username: 用户名 (如果无user_id)
                - detection_type: 检测类型 ('single', 'batch', 'camera', 'video')
                - original_filename: 原始文件名
                - defect_count: 缺陷数量
                - defect_details: 缺陷详情 (JSON格式)
                - original_image_url: 原始图片URL
                - result_image_url: 结果图片URL
                - processing_time: 处理时间(秒)
                - confidence_threshold: 置信度阈值
                - iou_threshold: IOU阈值
                - batch_id: 批次ID (批量检测时使用)
        
        返回:
            记录ID (成功) 或 None (失败)
        """
        if not self.is_connected():
            print("❌ 数据库未连接")
            return None
        
        try:
            # 如果提供了用户名但无user_id，尝试获取user_id
            user_id = record_data.get('user_id')
            if not user_id and 'username' in record_data:
                user_id = self._get_user_id_by_username(record_data['username'])
            
            # 准备插入数据
            with self.connection.cursor() as cursor:
                # 使用现有的表结构
                sql = """
                    INSERT INTO detection_records (
                        detection_id, filename, username, defect_count,
                        defects, original_image_url, result_image_url,
                        processing_time_ms, detection_time, status, batch_id, detection_type
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """
                
                # 处理JSON数据
                defect_details = record_data.get('defect_details', [])
                defects = json.dumps(defect_details, ensure_ascii=False)
                
                # 生成唯一的检测ID
                import uuid
                detection_id = str(uuid.uuid4())
                
                values = (
                    detection_id,
                    record_data.get('original_filename', ''),
                    record_data.get('username', '未知'),
                    record_data.get('defect_count', 0),
                    defects,
                    record_data.get('original_image_url', ''),
                    record_data.get('result_image_url', ''),  # 保存标注图片路径
                    int(record_data.get('processing_time', 0.0) * 1000),  # 转换为毫秒
                    datetime.now(),  # 检测时间
                    'completed',
                    record_data.get('batch_id'),
                    record_data.get('detection_type', 'single')  # 检测类型
                )
                
                cursor.execute(sql, values)
                record_id = cursor.lastrowid
                
                # 更新统计信息
                self._update_statistics(user_id, record_data.get('defect_count', 0), defect_details)
                
                self.connection.commit()
                print(f"✅ 检测记录保存成功，ID: {record_id}")
                return record_id
                
        except Exception as e:
            print(f"❌ 保存检测记录失败: {e}")
            if self.connection:
                self.connection.rollback()
            return None
    
    def save_batch_detection(self, batch_data: Dict[str, Any]) -> Optional[int]:
        """
        保存批量检测记录
        
        参数:
            batch_data: 批量检测数据，包含以下字段:
                - user_id: 用户ID (可选)
                - username: 用户名 (如果无user_id)
                - batch_name: 批次名称
                - total_files: 总文件数
                - file_list: 文件列表 (JSON格式)
        
        返回:
            批次ID (成功) 或 None (失败)
        """
        if not self.is_connected():
            print("❌ 数据库未连接")
            return None
        
        try:
            # 如果提供了用户名但无user_id，尝试获取user_id
            user_id = batch_data.get('user_id')
            if not user_id and 'username' in batch_data:
                user_id = self._get_user_id_by_username(batch_data['username'])
            
            with self.connection.cursor() as cursor:
                # 使用现有的表结构
                sql = """
                    INSERT INTO batch_detections (
                        batch_id, username, total_files, start_time, status
                    ) VALUES (%s, %s, %s, %s, %s)
                """
                
                # 生成批次ID
                import uuid
                batch_id = str(uuid.uuid4())
                
                values = (
                    batch_id,
                    batch_data.get('username', '未知'),
                    batch_data.get('total_files', 0),
                    datetime.now(),  # 开始时间
                    'processing'
                )
                
                cursor.execute(sql, values)
                batch_id = cursor.lastrowid
                
                self.connection.commit()
                print(f"✅ 批量检测记录保存成功，ID: {batch_id}")
                return batch_id
                
        except Exception as e:
            print(f"❌ 保存批量检测记录失败: {e}")
            if self.connection:
                self.connection.rollback()
            return None
    
    def update_batch_detection(self, batch_id: int, update_data: Dict[str, Any]) -> bool:
        """
        更新批量检测记录
        
        参数:
            batch_id: 批次ID
            update_data: 更新数据，可包含:
                - processed_files: 已处理文件数
                - total_defects: 总缺陷数
                - status: 状态 ('processing', 'completed', 'failed')
        
        返回:
            True (成功) 或 False (失败)
        """
        if not self.is_connected():
            print("❌ 数据库未连接")
            return False
        
        try:
            with self.connection.cursor() as cursor:
                # 构建更新语句
                update_fields = []
                values = []
                
                if 'processed_files' in update_data:
                    update_fields.append("processed_files = %s")
                    values.append(update_data['processed_files'])
                
                if 'total_defects' in update_data:
                    update_fields.append("total_defects = %s")
                    values.append(update_data['total_defects'])
                
                if 'status' in update_data:
                    update_fields.append("status = %s")
                    values.append(update_data['status'])
                    
                    if update_data['status'] == 'completed':
                        update_fields.append("end_time = NOW()")
                
                if not update_fields:
                    return False
                
                sql = f"UPDATE batch_detections SET {', '.join(update_fields)} WHERE batch_id = %s"
                values.append(batch_id)
                
                cursor.execute(sql, values)
                self.connection.commit()
                
                print(f"✅ 批量检测记录更新成功，ID: {batch_id}")
                return True
                
        except Exception as e:
            print(f"❌ 更新批量检测记录失败: {e}")
            if self.connection:
                self.connection.rollback()
            return False
    
    def get_detection_records(self, user_id: Optional[int] = None, detection_type: Optional[str] = None, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """
        获取检测记录
        
        参数:
            user_id: 用户ID (可选)
            detection_type: 检测类型 ('single', 'batch', 'camera')
            limit: 返回记录数
            offset: 偏移量
        
        返回:
            检测记录列表
        """
        if not self.is_connected():
            print("❌ 数据库未连接")
            return []
        
        try:
            with self.connection.cursor() as cursor:
                # 构建查询条件
                conditions = []
                params = []
                
                if user_id:
                    # detection_records 表没有 user_id 列，只有 username。
                    # 数字 ID 经子查询映射到 username，避免非管理员统计接口查空。
                    try:
                        int(user_id)
                        conditions.append("username = (SELECT username FROM users WHERE id = %s)")
                    except (TypeError, ValueError):
                        conditions.append("username = %s")
                    params.append(user_id)
                
                if detection_type:
                    conditions.append("detection_type = %s")
                    params.append(detection_type)
                
                where_clause = " AND ".join(conditions) if conditions else "1=1"
                
                sql = f"""
                    SELECT * FROM detection_records
                    WHERE {where_clause}
                    ORDER BY id DESC
                    LIMIT %s OFFSET %s
                """
                params.extend([limit, offset])
                cursor.execute(sql, params)
                
                records = cursor.fetchall()
                
                # 解析JSON字段
                for record in records:
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
                    record['created_at'] = record.get('detection_time')
                
                return records
                
        except Exception as e:
            print(f"❌ 获取检测记录失败: {e}")
            return []
    
    def get_batch_detections(self, user_id: Optional[int] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """
        获取批量检测记录
        
        参数:
            user_id: 用户ID (可选)
            limit: 返回记录数
            offset: 偏移量
        
        返回:
            批量检测记录列表
        """
        if not self.is_connected():
            print("❌ 数据库未连接")
            return []
        
        try:
            with self.connection.cursor() as cursor:
                # 注意：batch_detections 表只有 username，没有 user_id 列。
                # 修复前的 SQL 用 `ON bd.user_id = u.id` 会抛 Unknown column，
                # 整个查询被 except 吞掉返回 []，导致批量详情永远 404。
                # 这里改为按 username 关联 users 表。
                if user_id:
                    sql = """
                        SELECT bd.*, u.username, u.full_name
                        FROM batch_detections bd
                        LEFT JOIN users u ON u.username = bd.username
                        WHERE u.id = %s
                        ORDER BY bd.created_at DESC
                        LIMIT %s OFFSET %s
                    """
                    cursor.execute(sql, (user_id, limit, offset))
                else:
                    sql = """
                        SELECT bd.*, u.username, u.full_name
                        FROM batch_detections bd
                        LEFT JOIN users u ON u.username = bd.username
                        ORDER BY bd.created_at DESC
                        LIMIT %s OFFSET %s
                    """
                    cursor.execute(sql, (limit, offset))
                
                batches = cursor.fetchall()
                
                # 解析JSON字段
                for batch in batches:
                    if batch.get('file_list'):
                        try:
                            batch['file_list'] = json.loads(batch['file_list'])
                        except:
                            batch['file_list'] = []
                
                return batches
                
        except Exception as e:
            print(f"❌ 获取批量检测记录失败: {e}")
            return []
    
    def _get_user_id_by_username(self, username: str) -> Optional[int]:
        """根据用户名获取用户ID"""
        if not self.is_connected():
            return None
        
        try:
            with self.connection.cursor() as cursor:
                sql = "SELECT id FROM users WHERE username = %s"
                cursor.execute(sql, (username,))
                result = cursor.fetchone()
                return result['id'] if result else None
        except Exception as e:
            print(f"❌ 获取用户ID失败: {e}")
            return None
    
    def _update_statistics(self, user_id: Optional[int], defect_count: int, defect_details: str):
        """更新统计信息"""
        if not self.is_connected():
            return
        
        try:
            today = datetime.now().date()
            
            with self.connection.cursor() as cursor:
                # 检查今日统计是否存在
                sql = "SELECT id FROM statistics WHERE user_id = %s AND date = %s"
                cursor.execute(sql, (user_id, today))
                result = cursor.fetchone()
                
                if result:
                    # 更新现有统计
                    sql = """
                        UPDATE statistics 
                        SET total_detections = total_detections + 1,
                            total_defects = total_defects + %s,
                            updated_at = NOW()
                        WHERE id = %s
                    """
                    cursor.execute(sql, (defect_count, result['id']))
                else:
                    # 创建新统计
                    sql = """
                        INSERT INTO statistics (user_id, date, total_detections, total_defects)
                        VALUES (%s, %s, 1, %s)
                    """
                    cursor.execute(sql, (user_id, today, defect_count))
                
                self.connection.commit()
                
        except Exception as e:
            print(f"❌ 更新统计信息失败: {e}")
            if self.connection:
                self.connection.rollback()
    
    def close(self):
        """关闭数据库连接"""
        if self.connection and self.connection.open:
            self.connection.close()
            print("数据库连接已关闭")

    # ============ 用户管理方法 ============

    def _ensure_user_columns(self):
        """确保 users 表有必要的字段"""
        if not self.is_connected():
            return
        try:
            with self.connection.cursor() as cursor:
                # 检查字段是否存在
                cursor.execute("DESCRIBE users")
                columns = [row[0] for row in cursor.fetchall()]
                
                if 'email' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
                if 'full_name' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN full_name VARCHAR(100)")
                if 'is_active' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1")
                if 'phone' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN phone VARCHAR(50)")
                if 'department' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN department VARCHAR(100)")
                if 'avatar_url' not in columns:
                    cursor.execute("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)")
                
                self.connection.commit()
        except Exception as e:
            print(f"⚠️ 确保用户字段失败: {e}")
            if self.connection:
                self.connection.rollback()

    def get_users(self, search: str = None, role: str = None, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """获取用户列表"""
        if not self.is_connected():
            print("❌ 数据库未连接")
            return []

        try:
            # 确保字段存在
            self._ensure_user_columns()
            
            with self.connection.cursor() as cursor:
                conditions = ["1=1"]
                params = []

                if search:
                    conditions.append("(username LIKE %s OR COALESCE(email, '') LIKE %s OR COALESCE(full_name, '') LIKE %s)")
                    search_term = f"%{search}%"
                    params.extend([search_term, search_term, search_term])

                if role:
                    conditions.append("role = %s")
                    params.append(role)

                where_clause = " AND ".join(conditions)

                sql = f"""
                    SELECT id, username, COALESCE(email, '') as email, 
                           COALESCE(full_name, '') as full_name, 
                           COALESCE(is_active, 1) as is_active,
                           COALESCE(phone, '') as phone,
                           COALESCE(department, '') as department,
                           COALESCE(avatar_url, '') as avatar_url,
                           role, created_at, updated_at
                    FROM users
                    WHERE {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """
                params.extend([limit, offset])
                cursor.execute(sql, params)
                users = cursor.fetchall()

                # 格式化输出
                for u in users:
                    u['display_name'] = u.get('full_name') or u.get('username')
                    # 如果没有自定义头像，使用默认头像
                    if not u.get('avatar_url'):
                        u['avatarUrl'] = f"https://api.dicebear.com/7.x/avataaars/svg?seed={u['username']}"
                    else:
                        u['avatarUrl'] = u.get('avatar_url')

                return users

        except Exception as e:
            print(f"❌ 获取用户列表失败: {e}")
            return []

    def create_user(self, user_data: Dict[str, Any]) -> Optional[int]:
        """创建用户"""
        if not self.is_connected():
            print("❌ 数据库未连接")
            return None

        try:
            from services.password_util import hash_password
            password_hash = hash_password(user_data['password'])

            with self.connection.cursor() as cursor:
                sql = """
                    INSERT INTO users (username, password_hash, role, email, full_name, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """
                cursor.execute(sql, (
                    user_data['username'],
                    password_hash,
                    user_data.get('role', 'viewer'),
                    user_data.get('email'),
                    user_data.get('full_name', ''),
                    user_data.get('is_active', True)
                ))
                user_id = cursor.lastrowid
                self.connection.commit()
                print(f"✅ 用户创建成功，ID: {user_id}")
                return user_id

        except Exception as e:
            print(f"❌ 创建用户失败: {e}")
            if self.connection:
                self.connection.rollback()
            return None

    def update_user(self, user_id: int, update_data: Dict[str, Any]) -> bool:
        """更新用户信息"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                fields = []
                values = []

                # 基本字段
                for key in ['full_name', 'email', 'role']:
                    if key in update_data:
                        fields.append(f"{key} = %s")
                        values.append(update_data[key])

                # 新增字段
                if 'phone' in update_data:
                    fields.append("phone = %s")
                    values.append(update_data['phone'])
                if 'department' in update_data:
                    fields.append("department = %s")
                    values.append(update_data['department'])
                if 'avatar_url' in update_data:
                    fields.append("avatar_url = %s")
                    values.append(update_data['avatar_url'])

                if 'is_active' in update_data:
                    fields.append("is_active = %s")
                    values.append(1 if update_data['is_active'] else 0)

                if not fields:
                    return False

                fields.append("updated_at = NOW()")
                values.append(user_id)

                sql = f"UPDATE users SET {', '.join(fields)} WHERE id = %s"
                cursor.execute(sql, values)
                self.connection.commit()
                print(f"✅ 用户更新成功，ID: {user_id}")
                return True

        except Exception as e:
            print(f"❌ 更新用户失败: {e}")
            if self.connection:
                self.connection.rollback()
            return False

    def delete_user(self, user_id: int) -> bool:
        """删除用户"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
                self.connection.commit()
                print(f"✅ 用户删除成功，ID: {user_id}")
                return True

        except Exception as e:
            print(f"❌ 删除用户失败: {e}")
            if self.connection:
                self.connection.rollback()
            return False

    def reset_user_password(self, user_id: int, new_password: str) -> bool:
        """重置用户密码"""
        if not self.is_connected():
            return False

        try:
            from services.password_util import hash_password
            password_hash = hash_password(new_password)

            with self.connection.cursor() as cursor:
                sql = "UPDATE users SET password_hash = %s, updated_at = NOW() WHERE id = %s"
                cursor.execute(sql, (password_hash, user_id))
                self.connection.commit()
                print(f"✅ 密码重置成功，用户ID: {user_id}")
                return True

        except Exception as e:
            print(f"❌ 重置密码失败: {e}")
            if self.connection:
                self.connection.rollback()
            return False

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """根据用户名获取用户信息（不包含密码哈希）"""
        if not self.is_connected():
            return None
        
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """SELECT id, username, COALESCE(email, '') as email, 
                       COALESCE(full_name, '') as full_name, 
                       COALESCE(is_active, 1) as is_active,
                       COALESCE(phone, '') as phone,
                       COALESCE(department, '') as department,
                       COALESCE(avatar_url, '') as avatar_url,
                       role, created_at, updated_at
                       FROM users WHERE username = %s""",
                    (username,)
                )
                user = cursor.fetchone()
                return user
        except Exception as e:
            print(f"❌ 获取用户失败: {e}")
            return None

    def verify_user_password(self, user_id: int, current_password: str) -> bool:
        """验证用户当前密码（bcrypt为主，MD5兼容回退）"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    "SELECT id, password_hash FROM users WHERE id = %s",
                    (user_id,)
                )
                row = cursor.fetchone()
                if not row:
                    return False

                stored_hash = row['password_hash']

                # bcrypt（$2a/$2b/$2y）为主，MD5 为历史遗留回退
                from services.password_util import verify_password
                return verify_password(current_password, stored_hash)

        except Exception as e:
            print(f"❌ 验证密码失败: {e}")
            return False

    def authenticate_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """验证用户名和密码（bcrypt为主，MD5兼容回退），返回用户信息如果验证成功"""
        if not self.is_connected():
            return None

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    """SELECT id, username, password_hash,
                       COALESCE(email, '') as email,
                       COALESCE(full_name, '') as full_name,
                       COALESCE(is_active, 1) as is_active,
                       COALESCE(phone, '') as phone,
                       COALESCE(department, '') as department,
                       COALESCE(avatar_url, '') as avatar_url,
                       role, created_at, updated_at
                       FROM users WHERE username = %s AND COALESCE(is_active, 1) = 1""",
                    (username,)
                )
                user = cursor.fetchone()
                if not user:
                    return None

                stored_hash = user['password_hash']

                from services.password_util import verify_password, hash_password, needs_upgrade
                verified = verify_password(password, stored_hash)

                # 旧格式（MD5）校验通过后，自动升级为 bcrypt
                if verified and needs_upgrade(stored_hash):
                    try:
                        new_hash = hash_password(password)
                        cursor.execute(
                            "UPDATE users SET password_hash = %s WHERE id = %s",
                            (new_hash, user['id'])
                        )
                        self.connection.commit()
                        print(f"🔑 用户 {username} 的密码哈希已升级为 bcrypt")
                    except Exception as upgrade_err:
                        print(f"⚠️ 密码哈希升级失败（不影响本次登录）: {upgrade_err}")

                if not verified:
                    return None

                return user
        except Exception as e:
            print(f"❌ 认证用户失败: {e}")
            return None

    def toggle_user_status(self, user_id: int) -> Optional[bool]:
        """切换用户启用/停用状态"""
        if not self.is_connected():
            return None

        try:
            # 确保字段存在
            self._ensure_user_columns()
            
            with self.connection.cursor() as cursor:
                # 先查询当前状态
                cursor.execute("SELECT COALESCE(is_active, 1) as is_active FROM users WHERE id = %s", (user_id,))
                result = cursor.fetchone()
                if not result:
                    return None

                new_status = not result['is_active']
                cursor.execute(
                    "UPDATE users SET is_active = %s, updated_at = NOW() WHERE id = %s",
                    (int(new_status), user_id)
                )
                self.connection.commit()
                print(f"✅ 用户状态切换成功，ID: {user_id}, 新状态: {'活跃' if new_status else '停用'}")
                return new_status

        except Exception as e:
            print(f"❌ 切换用户状态失败: {e}")
            return None

    # ============ 通知管理方法 ============

    def get_notifications(self, user_id: Optional[int] = None, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """获取通知列表"""
        if not self.is_connected():
            print("❌ 数据库未连接")
            return []

        try:
            with self.connection.cursor() as cursor:
                conditions = ["1=1"]
                params = []

                if user_id:
                    conditions.append("(user_id = %s OR user_id IS NULL)")
                    params.append(user_id)

                where_clause = " AND ".join(conditions)

                sql = f"""
                    SELECT id, user_id, type, title, message, is_read, link, created_at
                    FROM notifications
                    WHERE {where_clause}
                    ORDER BY is_read ASC, created_at DESC
                    LIMIT %s OFFSET %s
                """
                params.extend([limit, offset])
                cursor.execute(sql, params)
                notifications = cursor.fetchall()
                
                # 格式化日期
                for n in notifications:
                    if n.get('created_at'):
                        n['created_at'] = n['created_at'].isoformat() if hasattr(n['created_at'], 'isoformat') else str(n['created_at'])
                
                return notifications

        except Exception as e:
            print(f"❌ 获取通知列表失败: {e}")
            return []

    def create_notification(self, notification_data: Dict[str, Any]) -> Optional[int]:
        """创建通知"""
        if not self.is_connected():
            print("❌ 数据库未连接")
            return None

        try:
            with self.connection.cursor() as cursor:
                sql = """
                    INSERT INTO notifications (user_id, type, title, message, link)
                    VALUES (%s, %s, %s, %s, %s)
                """
                cursor.execute(sql, (
                    notification_data.get('user_id'),
                    notification_data.get('type', 'info'),
                    notification_data.get('title', ''),
                    notification_data.get('message', ''),
                    notification_data.get('link')
                ))
                notification_id = cursor.lastrowid
                self.connection.commit()
                print(f"✅ 通知创建成功，ID: {notification_id}")
                return notification_id

        except Exception as e:
            print(f"❌ 创建通知失败: {e}")
            if self.connection:
                self.connection.rollback()
            return None

    def mark_notification_read(self, notification_id: int) -> bool:
        """标记通知为已读"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE notifications SET is_read = 1 WHERE id = %s",
                    (notification_id,)
                )
                self.connection.commit()
                return True

        except Exception as e:
            print(f"❌ 标记通知已读失败: {e}")
            return False

    def mark_all_notifications_read(self, user_id: Optional[int] = None) -> bool:
        """标记所有通知为已读"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                if user_id:
                    cursor.execute(
                        "UPDATE notifications SET is_read = 1 WHERE user_id = %s OR user_id IS NULL",
                        (user_id,)
                    )
                else:
                    cursor.execute("UPDATE notifications SET is_read = 1")
                self.connection.commit()
                return True

        except Exception as e:
            print(f"❌ 标记所有通知已读失败: {e}")
            return False

    def delete_notification(self, notification_id: int) -> bool:
        """删除通知"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                cursor.execute("DELETE FROM notifications WHERE id = %s", (notification_id,))
                self.connection.commit()
                return True

        except Exception as e:
            print(f"❌ 删除通知失败: {e}")
            return False

    def clear_notifications(self, user_id: Optional[int] = None) -> bool:
        """清除所有通知"""
        if not self.is_connected():
            return False

        try:
            with self.connection.cursor() as cursor:
                if user_id:
                    cursor.execute("DELETE FROM notifications WHERE user_id = %s OR user_id IS NULL", (user_id,))
                else:
                    cursor.execute("DELETE FROM notifications")
                self.connection.commit()
                return True

        except Exception as e:
            print(f"❌ 清除通知失败: {e}")
            return False

    def get_unread_count(self, user_id: Optional[int] = None) -> int:
        """获取未读通知数量"""
        if not self.is_connected():
            return 0

        try:
            with self.connection.cursor() as cursor:
                if user_id:
                    cursor.execute(
                        "SELECT COUNT(*) as count FROM notifications WHERE is_read = 0 AND (user_id = %s OR user_id IS NULL)",
                        (user_id,)
                    )
                else:
                    cursor.execute("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0")
                result = cursor.fetchone()
                return result['count'] if result else 0

        except Exception as e:
            print(f"❌ 获取未读数量失败: {e}")
            return 0


# 全局数据库服务实例
db_service = DatabaseService()