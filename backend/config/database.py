"""
数据库配置模块 - 支持云数据库(Supabase)和本地MySQL切换
"""
import os
import sys
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

# 自动加载 backend/.env 文件
_env_file = Path(__file__).parent.parent / '.env'
if _env_file.exists():
    with open(_env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()


@dataclass
class DatabaseConfig:
    """数据库配置类"""
    type: str  # 'supabase' 或 'mysql'
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    user: Optional[str] = None
    password: Optional[str] = None
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None


class DatabaseManager:
    """数据库管理器 - 自动切换云数据库和本地MySQL"""

    def __init__(self):
        self.config = self._load_config()
        self.connection = None

    def _load_config(self) -> DatabaseConfig:
        """从环境变量加载数据库配置"""
        db_type = os.getenv('DB_TYPE', 'supabase').lower()

        if db_type == 'mysql':
            return DatabaseConfig(
                type='mysql',
                host=os.getenv('MYSQL_HOST', 'localhost'),
                port=int(os.getenv('MYSQL_PORT', '3306')),
                database=os.getenv('MYSQL_DATABASE', 'metal_pipe_defect_detection'),
                user=os.getenv('MYSQL_USER', 'root'),
                password=os.getenv('MYSQL_PASSWORD', '')
            )
        else:
            return DatabaseConfig(
                type='supabase',
                supabase_url=os.getenv('SUPABASE_URL', ''),
                supabase_key=os.getenv('SUPABASE_ANON_KEY', '')
            )

    def get_mysql_connection_string(self) -> str:
        """获取MySQL连接字符串"""
        if self.config.type != 'mysql':
            raise ValueError("当前配置不是MySQL类型")
        return f"mysql+pymysql://{self.config.user}:{self.config.password}@{self.config.host}:{self.config.port}/{self.config.database}"

    def get_supabase_config(self) -> dict:
        """获取Supabase配置"""
        if self.config.type != 'supabase':
            raise ValueError("当前配置不是Supabase类型")
        return {
            'url': self.config.supabase_url,
            'key': self.config.supabase_key
        }

    def is_cloud(self) -> bool:
        """检查是否使用云数据库"""
        return self.config.type == 'supabase'

    def is_local(self) -> bool:
        """检查是否使用本地数据库"""
        return self.config.type == 'mysql'


# 全局数据库管理器实例
db_manager = DatabaseManager()
