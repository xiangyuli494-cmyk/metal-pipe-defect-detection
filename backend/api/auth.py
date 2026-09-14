"""
JWT 认证模块 - Token 生成、验证、RBAC 依赖注入
"""
import os
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

# 配置 - SECRET_KEY 必须从环境变量读取，禁止使用硬编码默认值
# 说明：硬编码密钥一旦泄露（本项目已开源到 GitHub），任何人都能伪造任意用户的 JWT。
# 未设置时退化为每次启动随机生成（重启后需要重新登录），并打印醒目告警。
SECRET_KEY = os.environ.get("JWT_SECRET_KEY")
if not SECRET_KEY:
    import secrets
    SECRET_KEY = secrets.token_urlsafe(48)
    print("⚠️  未设置环境变量 JWT_SECRET_KEY，已临时生成随机密钥；"
          "服务重启后所有 token 失效。请在 backend/.env 中配置 JWT_SECRET_KEY。")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def create_access_token(data: dict) -> str:
    """生成 access token（短期，30分钟）"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """生成 refresh token（长期，7天）"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str, expected_type: str = "access") -> dict:
    """验证 token 并返回 payload"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != expected_type:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="无效的 token 类型",
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 无效或已过期",
        )


async def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    """从 Authorization header 提取并验证 access token，返回当前用户信息"""
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证令牌",
        )
    payload = verify_token(token, expected_type="access")
    return {
        "user_id": payload.get("sub"),
        "username": payload.get("username"),
        "role": payload.get("role"),
    }


def require_role(*roles: str):
    """工厂函数：返回检查角色的依赖。用法: Depends(require_role("admin"))"""

    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="权限不足",
            )
        return current_user

    return role_checker
