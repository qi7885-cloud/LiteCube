# -*- coding: utf-8 -*-
"""轻立方本地服务：静态托管 + 友好 404。

为什么不是裸 `python -m http.server`：
  临时测试页（如 __publish_test.html）用完即删，残留标签页刷新会命中 404，
  python 自带的 404 页标题是 "Error response"，观感像重大故障。
  本脚本对"页面导航"类的 404 返回一个友好过渡页并自动跳回编辑器；
  对静态资源（js/css/模型等）的 404 仍按标准 404 处理，不干扰调试。

用法：python 本地服务.py [端口]   （默认 8123）
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = os.path.dirname(os.path.abspath(__file__))

FRIENDLY_404 = (
    '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">'
    '<meta http-equiv="refresh" content="1.5;url=/app/index.html">'
    '<title>页面已过期 · 轻立方</title>'
    '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;'
    'background:#1a1d26;color:#d9dde8;font-family:system-ui;text-align:center">'
    '<div><div style="font-size:44px">\U0001F9CA</div>'
    '<p style="font-size:15px;margin:14px 0 6px">这个页面已过期（多为用完即删的临时预览页）</p>'
    '<p style="color:#8b91a3;font-size:13px">正在带你回到编辑器…</p></div>'
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_error(self, code, message=None, explain=None):
        """页面导航类的 404 → 友好跳转页；资源类 404 → 标准错误。"""
        if code == 404 and 'text/html' in (self.headers.get('Accept') or ''):
            body = FRIENDLY_404.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print('轻立方本地服务已启动: http://localhost:%d/app/index.html' % PORT)
        print('（关掉本窗口即退出）')
        httpd.serve_forever()
