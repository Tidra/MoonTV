import { NextRequest, NextResponse } from 'next/server';

import logger from '@/lib/logger';
import {
  getServerCachedVideosById,
  getServerCachedVideosByTitle,
} from '@/lib/serverDownload';

// GET /api/download/search - 视频搜索
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');
    const id = searchParams.get('id');

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

    return NextResponse.json(
      { success: false, error: '缺少搜索参数' },
      { status: 400 }
    );
  } catch (error) {
    logger.error('视频搜索失败:', error);
    return NextResponse.json(
      { success: false, error: '视频搜索失败' },
      { status: 500 }
    );
  }
}
