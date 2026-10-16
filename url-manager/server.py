# -*- coding: utf-8 -*-
"""
个人专属网址管理系统 - 本地轻量伴随服务
基于 Python 3 原生标准库，零第三方依赖
"""

import os
import sys
import json
import socket
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# 确保控制台中文输出正常
if sys.platform.startswith('win'):
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleCP(65001)
        kernel32.SetConsoleOutputCP(65001)
    except Exception:
        pass

# 根目录与关键文件路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "urls.json")
PID_FILE = os.path.join(BASE_DIR, ".server.pid")

HTTP_SERVER_INSTANCE = None

def write_pid():
    """记录当前服务 PID 便于一键停止脚本精准关闭"""
    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except Exception as e:
        print(f"写入 PID 失败: {e}")

def remove_pid():
    """移除 PID 文件"""
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
    except Exception:
        pass

def find_available_port(start_port=8089, max_attempts=10):
    """查找本地可用端口，固定优先 8089"""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return start_port

class URLManagerRequestHandler(SimpleHTTPRequestHandler):
    """自定义请求处理器，处理静态文件与 RESTful API"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/data':
            self.handle_get_data()
        elif parsed.path == '/api/ping':
            self.send_json_response({"status": "ok", "message": "pong"})
        elif parsed.path == '/api/shutdown':
            self.handle_shutdown()
        else:
            # 托管静态文件 (index.html, style.css, app.js 等)
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/data':
            self.handle_save_data()
        elif parsed.path == '/api/shutdown':
            self.handle_shutdown()
        else:
            self.send_error(404, "接口不存在")

    def handle_shutdown(self):
        """响应前端或客户端的停止服务指令"""
        self.send_json_response({"status": "ok", "message": "服务正在安全停止..."})
        def delayed_shutdown():
            time.sleep(0.5)
            remove_pid()
            if HTTP_SERVER_INSTANCE:
                HTTP_SERVER_INSTANCE.shutdown()
        threading.Thread(target=delayed_shutdown, daemon=True).start()

    def handle_get_data(self):
        """读取 urls.json 并返回"""
        try:
            if not os.path.exists(DATA_FILE):
                default_data = {
                    "version": "1.0",
                    "categories": [{"id": "cat_default", "name": "我的收藏", "icon": "⭐", "order": 1}],
                    "items": []
                }
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(default_data, f, ensure_ascii=False, indent=2)

            with open(DATA_FILE, "r", encoding="utf-8") as f:
                content = f.read()
                data = json.loads(content)
            self.send_json_response(data)
        except Exception as e:
            self.send_json_response({"status": "error", "message": str(e)}, status_code=500)

    def handle_save_data(self):
        """接收前端提交的 JSON 并写入 urls.json"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length <= 0:
                self.send_json_response({"status": "error", "message": "请求内容为空"}, status_code=400)
                return

            post_body = self.rfile.read(content_length)
            payload = json.loads(post_body.decode('utf-8'))

            if not isinstance(payload, dict) or 'categories' not in payload or 'items' not in payload:
                self.send_json_response({"status": "error", "message": "数据格式不符合规范"}, status_code=400)
                return

            temp_file = DATA_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            
            if os.path.exists(DATA_FILE):
                os.replace(temp_file, DATA_FILE)
            else:
                os.rename(temp_file, DATA_FILE)

            self.send_json_response({"status": "ok", "message": "数据已自动保存至本地文件"})
        except Exception as e:
            self.send_json_response({"status": "error", "message": f"保存失败: {str(e)}"}, status_code=500)

    def send_json_response(self, data, status_code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

def main():
    global HTTP_SERVER_INSTANCE
    write_pid()
    
    port = find_available_port(start_port=8089)
    server_address = ('127.0.0.1', port)
    
    try:
        HTTP_SERVER_INSTANCE = HTTPServer(server_address, URLManagerRequestHandler)
    except Exception as e:
        remove_pid()
        print(f"❌ 启动服务失败: {e}")
        return

    try:
        HTTP_SERVER_INSTANCE.serve_forever()
    except BaseException as e:
        try:
            with open(os.path.join(BASE_DIR, "server_error.log"), "w", encoding="utf-8") as f:
                import traceback
                traceback.print_exc(file=f)
        except Exception:
            pass
    finally:
        remove_pid()
        if HTTP_SERVER_INSTANCE:
            HTTP_SERVER_INSTANCE.server_close()

if __name__ == '__main__':
    main()
