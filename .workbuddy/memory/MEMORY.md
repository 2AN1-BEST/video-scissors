# Video Scissors - 项目记忆

## 项目概述
可视化视频裁剪工具，基于 Node.js + Express + ffmpeg。

## 技术栈
- 后端: Express + Multer (文件上传) + ffmpeg/ffprobe (视频处理)
- 前端: 原生 HTML/CSS/JS，无框架
- 核心: ffmpeg `-ss` + `-t` 实现视频裁剪

## 功能
- 拖拽上传视频
- HTML5 video 预览
- 可视化时间轴（缩略图条 + 拖拽手柄 + 播放头）
- 两种裁剪模式：快速(stream copy) / 精确(re-encode libx264)
- 进度轮询 + 结果下载

## 关键文件
- server.js — Express 服务端
- public/index.html — 主页面
- public/style.css — 暗色主题样式
- public/app.js — 前端交互逻辑

## 运行方式
```bash
cd D:\MyData\projects\lab\video-scissors
npm install
npm start  # → http://localhost:3000
```

## 注意事项
- Write 工具不会解析 \uXXXX 转义，HTML 中需用实际 emoji 字符
- JS 文件中 \uXXXX 在运行时被浏览器解析，无需修改
- 快速模式(stream copy)在关键帧对齐时有误差，精确模式帧级准确
- ffmpeg/ffprobe 需在系统 PATH 中可用
