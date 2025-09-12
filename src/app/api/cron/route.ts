/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import logger from '@/lib/logger';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  try {
    refreshRecordAndFavorites();

    return NextResponse.json({
      success: true,
      message: 'Record and favorites refresh executed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Record and favorites refresh failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Record and favorites refresh failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function refreshRecordAndFavorites() {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return;
  }

  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            // 成功时才缓存结果
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            logger.error(`获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
      }
      return promise;
    };

    for (const user of users) {
      logger.info(`开始处理用户: ${user}`);

      // 播放记录
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const totalRecords = Object.keys(playRecords).length;
        let processedRecords = 0;

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              logger.warn(`跳过无效的播放记录键: ${key}`);
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              logger.warn(`跳过无法获取详情的播放记录: ${key}`);
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              logger.info(
                `更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`
              );
            }

            processedRecords++;
          } catch (err) {
            logger.error(`处理播放记录失败 (${key}):`, err);
            // 继续处理下一个记录
          }
        }

        logger.info(`播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        logger.error(`获取用户播放记录失败 (${user}):`, err);
      }

      // 收藏
      try {
        const favorites = await db.getAllFavorites(user);
        const totalFavorites = Object.keys(favorites).length;
        let processedFavorites = 0;

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              logger.warn(`跳过无效的收藏键: ${key}`);
              continue;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              logger.warn(`跳过无法获取详情的收藏: ${key}`);
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              logger.info(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            logger.error(`处理收藏失败 (${key}):`, err);
            // 继续处理下一个收藏
          }
        }
        logger.info(`收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        logger.error(`获取用户收藏失败 (${user}):`, err);
      }
    }
  } catch (err) {
    logger.error('刷新播放记录/收藏任务启动失败', err);
  }
}
