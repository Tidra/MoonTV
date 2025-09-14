/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import logger from '@/lib/logger';
import { getBaseDownloadPath } from '@/lib/serverDownload';

// GET /api/download/file - 视频文件访问
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return new NextResponse('缺少文件路径参数', { status: 400 });
    }

    // 安全检查：确保路径在下载目录内
    const baseDownloadPath = getBaseDownloadPath();
    const fullPath = path.join(baseDownloadPath, decodeURIComponent(filePath));

    // 验证路径是否在基础下载路径内，防止路径遍历攻击
    const normalizedBasePath = path.resolve(baseDownloadPath);
    const normalizedFilePath = path.resolve(fullPath);

    if (!normalizedFilePath.startsWith(normalizedBasePath)) {
      return new NextResponse('无效的文件路径', { status: 403 });
    }

    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      return new NextResponse('文件不存在', { status: 404 });
    }

    // 获取文件信息
    const fileStat = fs.statSync(fullPath);

    // 设置响应头
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4'); // 默认视频类型
    headers.set('Content-Length', fileStat.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1年缓存

    // 检查文件扩展名以设置正确的Content-Type
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.m3u8') {
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (ext === '.ts') {
      headers.set('Content-Type', 'video/mp2t');
    } else if (ext === '.mp4') {
      headers.set('Content-Type', 'video/mp4');
    } else if (ext === '.avi') {
      headers.set('Content-Type', 'video/x-msvideo');
    } else if (ext === '.mkv') {
      headers.set('Content-Type', 'video/x-matroska');
    }

    // 支持范围请求（视频流）
    const range = request.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
      const chunksize = end - start + 1;

      const file = fs.createReadStream(fullPath, { start, end });
      headers.set('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Length', chunksize.toString());

      return new NextResponse(file as any, {
        status: 206, // Partial Content
        headers,
      });
    }

    // 返回完整文件
    const fileStream = fs.createReadStream(fullPath);
    return new NextResponse(fileStream as any, {
      status: 200,
      headers,
    });
  } catch (error) {
    logger.error('提供视频文件失败:', error);
    return new NextResponse('服务器内部错误', { status: 500 });
  }
}
