# PythonAnywhere WSGI 启动文件
# 在 PA 的 Web tab 里把 "WSGI configuration file" 指向本文件
# 然后改下面的 PROJECT_HOME 为你的实际路径

import sys
import os

# ⚠️ 改成你 PythonAnywhere 上的用户名
USERNAME = 'YOUR_USERNAME'

PROJECT_HOME = f'/home/{USERNAME}/budget-app/server'

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

# 工作目录设到 server/，保证 data/budget.db 写到正确位置
os.chdir(PROJECT_HOME)

from app import app as application  # noqa: E402, F401
