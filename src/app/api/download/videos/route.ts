import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import logger from '@/lib/logger';
import {
  deleteServerCachedVideo,
  getAllServerCachedVideos,
  getBaseDownloadPath,
  getServerCachedVideosById,
  getServerCachedVideosByTitle,
} from '@/lib/serverDownload';

// GET /api/download/videos - 获取所有视频信息
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');
    const id = searchParams.get('id');

    // 如果提供了title或id参数，则进行搜索
    if (title) {
      const cachedResults = await getServerCachedVideosByTitle(title);
      return NextResponse.json({
        success: true,
        data: cachedResults,
      });
    }

    if (id) {
      const cachedResults = await getServerCachedVideosById(id);
      return NextResponse.json({
        success: true,
        data: cachedResults,
      });
    }

    // 否则返回所有视频信息
    const videos = await getAllServerCachedVideos();
    return NextResponse.json({ success: true, data: videos });
  } catch (error) {
    logger.error('获取视频信息失败:', error);
    return NextResponse.json(
      { success: false, error: '获取视频信息失败' },
      { status: 500 }
    );
  }
}

// DELETE /api/download/videos - 删除指定视频
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const uniqueId = searchParams.get('uniqueId');

    if (!uniqueId) {
      return NextResponse.json(
        { success: false, error: '缺少视频ID' },
        { status: 400 }
      );
    }

    // 获取视频信息以删除对应的文件
    const videos = await getAllServerCachedVideos();
    const video = videos.find((v) => v.unique_id === uniqueId);

    if (video) {
      // 删除视频文件
      try {
        if (video.episode_path?.endsWith('.m3u8')) {
          const baseDownloadPath = getBaseDownloadPath();
          const fullPath = path.dirname(
            path.join(baseDownloadPath, video.episode_path)
          );
          if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            logger.info(`已删除m3u8缓存视频文件目录: ${fullPath}`);
          }
        } else {
          const baseDownloadPath = getBaseDownloadPath();
          const fullPath = path.join(baseDownloadPath, video.episode_path);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            logger.info(`已删除缓存视频文件: ${fullPath}`);
          }
        }
      } catch (fileError) {
        logger.error('删除视频文件失败:', fileError);
      }
    }

    await deleteServerCachedVideo(uniqueId);

    return NextResponse.json({ success: true, message: '视频删除成功' });
  } catch (error) {
    logger.error('删除视频失败:', error);
    return NextResponse.json(
      { success: false, error: '删除视频失败' },
      { status: 500 }
    );
  }
}
