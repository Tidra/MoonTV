import { NextRequest, NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { getServerCachedVideosById } from '@/lib/serverDownload';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  // 处理服务器缓存源
  if (sourceCode === 'server_cache') {
    try {
      // 直接使用服务器端函数获取缓存视频
      const cachedVideos = await getServerCachedVideosById(id);

      if (cachedVideos.length === 0) {
        return NextResponse.json(
          { error: '未找到缓存的视频' },
          { status: 404 }
        );
      }

      // 返回第一个结果（应该只有一个结果）
      const result = cachedVideos[0];

      const cacheTime = await getCacheTime();

      return NextResponse.json(result, {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    const apiSites = await getAvailableApiSites();
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const result = await getDetailFromApi(apiSite, id);
    const cacheTime = await getCacheTime();

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
