-- ============================================================
--  金属细管内壁缺陷检测系统  数据库一键初始化
--  Metal Pipe Defect Detection - MySQL Init Script
--  版本: v1.0  ·  MySQL 5.7+ / 8.x
--  用法:
--     mysql -uroot -p < sql/init.sql
--  或 PowerShell:
--     Get-Content sql/init.sql | mysql -uroot -p
--  特点: 所有 DDL 均 IF NOT EXISTS，可重复执行。
-- ============================================================

-- 1. 创建数据库
CREATE DATABASE IF NOT EXISTS metal_defect_detection
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE metal_defect_detection;

-- 2. 切换 utf8mb4
SET NAMES utf8mb4;

-- ============================================================
-- 表: 用户
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            INT NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  DEFAULT 'viewer',
  email         VARCHAR(255) DEFAULT NULL,
  full_name     VARCHAR(100) DEFAULT NULL,
  is_active     TINYINT(1)   DEFAULT 1,
  phone         VARCHAR(50)  DEFAULT '',
  department    VARCHAR(100) DEFAULT '',
  avatar_url    VARCHAR(500) DEFAULT '',
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY username (username),
  KEY idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 批量检测批次
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_detections (
  id              INT NOT NULL AUTO_INCREMENT,
  batch_id        VARCHAR(50)  NOT NULL,
  username        VARCHAR(100) DEFAULT NULL,
  total_files     INT NOT NULL,
  processed_files INT DEFAULT 0,
  defect_files    INT DEFAULT 0,
  total_defects   INT DEFAULT 0,
  start_time      DATETIME NOT NULL,
  end_time        DATETIME DEFAULT NULL,
  status          VARCHAR(20) DEFAULT 'processing',
  result_summary  JSON DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY batch_id (batch_id),
  KEY idx_status (status),
  KEY idx_start_time (start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 检测记录（每张图一行）
-- ============================================================
CREATE TABLE IF NOT EXISTS detection_records (
  id                 INT NOT NULL AUTO_INCREMENT,
  detection_id       VARCHAR(50) NOT NULL,
  filename           VARCHAR(255) NOT NULL,
  file_path          VARCHAR(500) DEFAULT NULL,
  original_size      VARCHAR(50)  DEFAULT NULL,
  processed_size     VARCHAR(50)  DEFAULT NULL,
  defect_count       INT DEFAULT 0,
  defect_types       JSON DEFAULT NULL,
  confidence_scores  JSON DEFAULT NULL,
  defects            JSON DEFAULT NULL,
  detection_time     DATETIME NOT NULL,
  processing_time_ms INT DEFAULT NULL,
  status             VARCHAR(20) DEFAULT 'completed',
  detection_type     VARCHAR(20) DEFAULT 'single',
  batch_id           VARCHAR(50) DEFAULT NULL,
  result_image_url   VARCHAR(500) DEFAULT NULL,
  original_image_url VARCHAR(500) DEFAULT NULL,
  username           VARCHAR(50) DEFAULT '未知',
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY detection_id (detection_id),
  KEY idx_detection_time (detection_time),
  KEY idx_status (status),
  KEY idx_batch_id (batch_id),
  CONSTRAINT fk_detection_batch FOREIGN KEY (batch_id)
    REFERENCES batch_detections (batch_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 摄像头/视频帧检测
-- ============================================================
CREATE TABLE IF NOT EXISTS camera_detections (
  id              INT NOT NULL AUTO_INCREMENT,
  session_id      VARCHAR(50) NOT NULL,
  frame_index     INT NOT NULL,
  timestamp       DATETIME NOT NULL,
  defect_detected TINYINT(1) DEFAULT 0,
  defect_count    INT DEFAULT 0,
  confidence      FLOAT DEFAULT NULL,
  frame_path      VARCHAR(500) DEFAULT NULL,
  detection_data  JSON DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_id (session_id),
  KEY idx_timestamp (timestamp),
  KEY idx_defect_detected (defect_detected)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 系统设置 (key-value)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id            INT NOT NULL AUTO_INCREMENT,
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT DEFAULT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 系统配置（带类型/分类）
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
  id          INT NOT NULL AUTO_INCREMENT,
  config_key  VARCHAR(100) NOT NULL,
  config_value TEXT DEFAULT NULL,
  config_type ENUM('string','number','boolean','json','array') DEFAULT 'string',
  category    VARCHAR(50) DEFAULT 'general',
  description TEXT DEFAULT NULL,
  is_public   TINYINT(1) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY config_key (config_key),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 通知
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         INT NOT NULL AUTO_INCREMENT,
  user_id    INT DEFAULT NULL,
  type       ENUM('defect','system','info','warning','error') NOT NULL DEFAULT 'info',
  title      VARCHAR(255) NOT NULL,
  message    TEXT DEFAULT NULL,
  is_read    TINYINT(1) DEFAULT 0,
  link       VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_read (user_id, is_read),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 用户维度每日统计
-- ============================================================
CREATE TABLE IF NOT EXISTS statistics (
  id              INT NOT NULL AUTO_INCREMENT,
  user_id         INT DEFAULT NULL,
  date            DATE NOT NULL,
  total_detections INT DEFAULT 0,
  total_defects   INT DEFAULT 0,
  defect_types    JSON DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_user_date (user_id, date),
  KEY idx_date (date),
  CONSTRAINT statistics_ibfk_1 FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 系统维度每日统计
-- ============================================================
CREATE TABLE IF NOT EXISTS system_statistics (
  id                    INT NOT NULL AUTO_INCREMENT,
  date                  DATE NOT NULL,
  total_detections      INT DEFAULT 0,
  total_defects         INT DEFAULT 0,
  avg_processing_time_ms INT DEFAULT NULL,
  defect_rate           FLOAT DEFAULT NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 登录日志
-- ============================================================
CREATE TABLE IF NOT EXISTS login_logs (
  id             INT NOT NULL AUTO_INCREMENT,
  user_id        INT DEFAULT NULL,
  username       VARCHAR(50) DEFAULT NULL,
  login_type     ENUM('password','token') DEFAULT 'password',
  ip_address     VARCHAR(45) DEFAULT NULL,
  user_agent     TEXT DEFAULT NULL,
  login_status   ENUM('success','failed') DEFAULT 'success',
  failure_reason VARCHAR(100) DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  KEY idx_login_status (login_status),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 操作日志
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_logs (
  id            INT NOT NULL AUTO_INCREMENT,
  user_id       INT DEFAULT NULL,
  username      VARCHAR(50) DEFAULT NULL,
  action_type   VARCHAR(50) NOT NULL,
  action_detail TEXT DEFAULT NULL,
  resource_type VARCHAR(50) DEFAULT NULL,
  resource_id   VARCHAR(100) DEFAULT NULL,
  ip_address    VARCHAR(45) DEFAULT NULL,
  user_agent    TEXT DEFAULT NULL,
  status        ENUM('success','failed') DEFAULT 'success',
  error_message TEXT DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  KEY idx_action_type (action_type),
  KEY idx_created_at (created_at),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 表: 模型管理
-- ============================================================
CREATE TABLE IF NOT EXISTS models (
  id           INT NOT NULL AUTO_INCREMENT,
  model_name   VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) DEFAULT NULL,
  file_path    VARCHAR(500) NOT NULL,
  file_size    BIGINT DEFAULT NULL,
  model_type   VARCHAR(50) DEFAULT 'yolo',
  version      VARCHAR(50) DEFAULT 'v1',
  description  TEXT DEFAULT NULL,
  is_active    TINYINT(1) DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY model_name (model_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 种子数据：默认系统设置
-- ============================================================
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('model_path',             '',                'YOLO模型路径'),
  ('confidence_threshold',   '0.5',             '置信度阈值'),
  ('iou_threshold',          '0.45',            'IOU阈值'),
  ('max_file_size',          '10485760',        '最大文件大小(10MB)'),
  ('allowed_extensions',     'jpg,jpeg,png,bmp','允许的文件扩展名'),
  ('storage_path',           'uploads',         '文件存储路径'),
  ('backup_enabled',         'true',            '是否启用备份'),
  ('backup_interval',        'daily',           '备份间隔'),
  ('notification_enabled',   'true',            '是否启用通知'),
  ('log_retention_days',     '30',              '日志保留天数')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- ============================================================
-- 种子数据：默认用户（密码已 bcrypt 哈希）
-- 账号:  admin    / admin123
--        operator / operator123
--        viewer   / viewer123
-- 如需重新生成 bcrypt 哈希：python -c "import bcrypt; print(bcrypt.hashpw(b'admin123', bcrypt.gensalt()).decode())"
-- ============================================================
INSERT INTO users (username, password_hash, role, full_name, is_active) VALUES
  ('admin',    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RqHqJqdLO', 'admin',    '系统管理员', 1),
  ('operator', '$2b$12$8K1p/a0dRTuIxhB3aq8C7ePUqF6QyH5tkqlVC6Ij5C4tHeM4xSiG.', 'operator', '操作员',     1),
  ('viewer',   '$2b$12$HsKv8k0CNnMMPxBOFGcN/.uTfRZbA8wQyCqUfwMYjcAFlGxqZ8Y2Z', 'viewer',   '查看员',     1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

-- ============================================================
-- 种子数据：默认模型记录（指向默认权重）
-- ============================================================
INSERT INTO models (model_name, display_name, file_path, model_type, version, description, is_active) VALUES
  ('best', '金属内壁缺陷检测模型', 'backend/models/best.pt', 'yolo', 'v1.0', '凸起/焊缝 2 类检测模型', 1)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- ============================================================
-- 完成
-- ============================================================
SELECT '初始化完成！' AS status;
SELECT username, role FROM users ORDER BY id;
SELECT COUNT(*) AS model_count FROM models;