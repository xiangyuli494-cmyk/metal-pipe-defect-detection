"""
密码哈希工具

背景：passlib 1.7.4 与 bcrypt >= 4.1 存在兼容问题（passlib 读取
`bcrypt.__about__.__version__` 失败），导致所有 `passlib.hash.bcrypt.hash()`
抛出 "password cannot be longer than 72 bytes"，即**创建用户 / 修改密码功能
完全不可用**。而登录之所以还能成功，是因为旧数据存的是 MD5，走了回退分支。

因此这里直接使用 bcrypt 原生库（hashpw / checkpw），不再依赖 passlib，
并保留对历史哈希格式（passlib 生成的 $2a/$2b、以及旧 MD5）的兼容校验。
"""
import hashlib
import re
from typing import Optional

# bcrypt 硬限制：密钥超过 72 字节会被静默截断，这里显式截断，保证与历史行为一致
MAX_BYTES = 72

# bcrypt 哈希特征: $2a$ / $2b$ / $2y$ + cost + 53 位 base64
_BCRYPT_RE = re.compile(r'^\$(2[aby])\$\d{2}\$[./A-Za-z0-9]{53}$')

# 32 位十六进制 = 历史遗留的 MD5 明文哈希
_MD5_RE = re.compile(r'^[a-fA-F0-9]{32}$')


def _to_bytes(password: str) -> bytes:
    """密码转字节并截断到 bcrypt 允许的长度"""
    if password is None:
        raise ValueError("密码不能为空")
    raw = password.encode('utf-8') if isinstance(password, str) else bytes(password)
    return raw[:MAX_BYTES]


def hash_password(password: str) -> str:
    """
    生成密码哈希，返回 bcrypt 格式字符串（$2b$...）

    优先使用 bcrypt 原生库；若环境未安装 bcrypt，则回退 passlib；
    两者都不可用时抛异常（不要让调用方拿到空哈希写入数据库）。
    """
    data = _to_bytes(password)

    try:
        import bcrypt as _bcrypt
        return _bcrypt.hashpw(data, _bcrypt.gensalt()).decode('ascii')
    except ImportError:
        pass
    except Exception as exc:  # bcrypt 内部异常，交给 passlib 再试一次
        last_err = exc
        try:
            from passlib.hash import bcrypt as _pbcrypt
            return _pbcrypt.hash(password)
        except Exception:
            raise RuntimeError(f"密码哈希失败（bcrypt 与 passlib 均不可用）: {last_err}")

    from passlib.hash import bcrypt as _pbcrypt
    return _pbcrypt.hash(password)


def verify_password(password: str, stored_hash: Optional[str]) -> bool:
    """
    校验密码。

    支持三种历史格式：
    1. bcrypt（$2a$ / $2b$ / $2y$）—— 当前标准
    2. passlib 生成但校验失败的边界情况 —— 逐个后端重试
    3. MD5 32 位十六进制 —— 早期遗留数据，校验通过后由调用方升级为 bcrypt
    """
    if not stored_hash:
        return False

    data = _to_bytes(password)
    stored = stored_hash if isinstance(stored_hash, str) else str(stored_hash)

    # 1. bcrypt
    if _BCRYPT_RE.match(stored) or stored.startswith('$2'):
        try:
            import bcrypt as _bcrypt
            return _bcrypt.checkpw(data, stored.encode('ascii'))
        except Exception:
            try:
                from passlib.hash import bcrypt as _pbcrypt
                return bool(_pbcrypt.verify(password, stored))
            except Exception:
                return False

    # 2. MD5 遗留格式
    if _MD5_RE.match(stored):
        return stored.lower() == hashlib.md5(data).hexdigest().lower()

    # 3. 未知格式，最后再试一次 bcrypt（宽松容错）
    try:
        import bcrypt as _bcrypt
        return _bcrypt.checkpw(data, stored.encode('ascii'))
    except Exception:
        return False


def needs_upgrade(stored_hash: Optional[str]) -> bool:
    """判断存储的是否为需要升级的旧格式（MD5 / 非 bcrypt）"""
    if not stored_hash:
        return True
    stored = stored_hash if isinstance(stored_hash, str) else str(stored_hash)
    return not bool(_BCRYPT_RE.match(stored))
