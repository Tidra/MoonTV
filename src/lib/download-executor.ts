import { exec } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';

import logger from './logger'; // 引入日志工具
import { SearchResult, ServerCachedVideo, ServerDownloadTask } from './types';

// 创建异步版本的fs函数
const fsPromises = {
  access: fs.promises.access,
  mkdir: fs.promises.mkdir,
  existsSync: fs.existsSync.bind(fs),
  createWriteStream: fs.createWriteStream.bind(fs),
  unlink: fs.promises.unlink,
  writeFile: fs.promises.writeFile,
  readFile: fs.promises.readFile,
};

const execPromise = promisify(exec);

// 确保目录存在
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fsPromises.access(dirPath);
  } catch {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }
}

// 获取所有缓存视频
export async function getAllServerCachedVideos(): Promise<ServerCachedVideo[]> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'cached-videos.json');
    const raw = await fsPromises.readFile(filePath, 'utf-8').catch(() => null);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    logger.error('读取缓存视频失败:', err);
    return [];
  }
}

// 保存缓存视频记录
export async function saveServerCachedVideo(
  video: ServerCachedVideo
): Promise<void> {
  try {
    const videos = await getAllServerCachedVideos();

    // 如果没有提供unique_id，则生成一个
    if (!video.unique_id) {
      video.unique_id = `video_${video.id}_${video.episode_number}`;
    }

    const existingIndex = videos.findIndex(
      (v) => v.unique_id === video.unique_id
    );

    if (existingIndex >= 0) {
      videos[existingIndex] = video;
    } else {
      videos.push(video);
    }

    const dataDir = path.join(process.cwd(), 'data');
    await ensureDir(dataDir);
    const filePath = path.join(dataDir, 'cached-videos.json');
    await fsPromises.writeFile(filePath, JSON.stringify(videos, null, 2));
  } catch (err) {
    logger.error('保存缓存视频失败:', err);
    throw err;
  }
}

// 获取所有下载任务
export async function getAllServerDownloadTasks(): Promise<
  ServerDownloadTask[]
> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'download-tasks.json');
    const raw = await fsPromises.readFile(filePath, 'utf-8').catch(() => null);
    const tasks = raw ? JSON.parse(raw) : [];
    // logger.log('从文件读取的任务数据:', JSON.stringify(tasks, null, 2));
    return tasks;
  } catch (err) {
    logger.error('读取下载任务失败:', err);
    return [];
  }
}

// 保存下载任务
export async function saveServerDownloadTask(
  task: ServerDownloadTask
): Promise<void> {
  try {
    const tasks = await getAllServerDownloadTasks();
    const existingIndex = tasks.findIndex((t) => t.id === task.id);

    if (existingIndex >= 0) {
      tasks[existingIndex] = task;
    } else {
      tasks.push(task);
    }

    const dataDir = path.join(process.cwd(), 'data');
    await ensureDir(dataDir);
    const filePath = path.join(dataDir, 'download-tasks.json');
    await fsPromises.writeFile(filePath, JSON.stringify(tasks, null, 2));
  } catch (err) {
    logger.error('保存下载任务失败:', err);
    throw err;
  }
}

// 使用HTTP下载文件的辅助函数
async function downloadWithHttp(
  url: string,
  filePath: string
): Promise<boolean> {
  return new Promise((resolve, _reject) => {
    logger.log(`建立HTTP连接到: ${url}`);
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const fileStream = fsPromises.createWriteStream(filePath);

    const request = client.get(url, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        logger.error(
          `HTTP错误: ${response.statusCode} ${response.statusMessage}`
        );
        fileStream.close();
        fsPromises
          .unlink(filePath)
          .catch((err) => {
            logger.error('删除部分下载的文件失败:', err);
          })
          .finally(() => {
            resolve(false);
          }); // 删除部分下载的文件
        return;
      }

      // 获取文件大小信息
      const contentLength = response.headers['content-length'];
      logger.log(
        `文件大小: ${
          contentLength
            ? `${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB`
            : '未知'
        }`
      );

      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (contentLength) {
          const progress = (
            (downloadedBytes / parseInt(contentLength)) *
            100
          ).toFixed(1);
          logger.log(
            `下载进度: ${progress}% (${(
              downloadedBytes /
              (1024 * 1024)
            ).toFixed(2)} MB)`
          );
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        logger.log(`HTTP视频下载完成: ${filePath}`);
        logger.log(
          `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`
        );
        resolve(true);
      });

      fileStream.on('error', (err) => {
        logger.error('文件写入失败:', err);
        resolve(false);
      });
    });

    request.on('error', (err) => {
      logger.error('HTTP请求失败:', err);
      fileStream.close();
      fsPromises
        .unlink(filePath)
        .catch((unlinkErr) => {
          logger.error('删除部分下载的文件失败:', unlinkErr);
        })
        .finally(() => {
          resolve(false);
        }); // 删除部分下载的文件
    });

    request.setTimeout(30000, () => {
      logger.error('HTTP请求超时');
      request.destroy();
      fileStream.close();
      fsPromises
        .unlink(filePath)
        .catch((unlinkErr) => {
          logger.error('删除部分下载的文件失败:', unlinkErr);
        })
        .finally(() => {
          resolve(false);
        });
    });
  });
}

// 将m3u8文件作为普通HTTP文件下载的辅助函数
async function downloadM3u8AsHttp(
  url: string,
  filePath: string
): Promise<boolean> {
  return new Promise((resolve, _reject) => {
    logger.log(`尝试将m3u8文件作为普通HTTP文件下载: ${url}`);
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    // 确保文件扩展名为.mp4
    let mp4FilePath = filePath;
    if (!filePath.endsWith('.mp4')) {
      mp4FilePath = filePath.replace(/\.[^/.]+$/, '') + '.mp4';
    }

    const fileStream = fsPromises.createWriteStream(mp4FilePath);

    const request = client.get(url, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        logger.error(
          `HTTP错误: ${response.statusCode} ${response.statusMessage}`
        );
        fileStream.close();
        fsPromises
          .unlink(mp4FilePath)
          .catch((err) => {
            logger.error('删除部分下载的文件失败:', err);
          })
          .finally(() => {
            resolve(false);
          }); // 删除部分下载的文件
        return;
      }

      // 获取文件大小信息
      const contentLength = response.headers['content-length'];
      logger.log(
        `文件大小: ${
          contentLength
            ? `${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB`
            : '未知'
        }`
      );

      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (contentLength) {
          const progress = (
            (downloadedBytes / parseInt(contentLength)) *
            100
          ).toFixed(1);
          logger.log(
            `下载进度: ${progress}% (${(
              downloadedBytes /
              (1024 * 1024)
            ).toFixed(2)} MB)`
          );
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        logger.log(`m3u8文件下载完成: ${mp4FilePath}`);
        logger.log(
          `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`
        );
        resolve(true);
      });

      fileStream.on('error', (err) => {
        logger.error('文件写入失败:', err);
        resolve(false);
      });
    });

    request.on('error', (err) => {
      logger.error('HTTP请求失败:', err);
      fileStream.close();
      fsPromises
        .unlink(mp4FilePath)
        .catch((unlinkErr) => {
          logger.error('删除部分下载的文件失败:', unlinkErr);
        })
        .finally(() => {
          resolve(false);
        }); // 删除部分下载的文件
    });

    request.setTimeout(30000, () => {
      logger.error('HTTP请求超时');
      request.destroy();
      fileStream.close();
      fsPromises
        .unlink(mp4FilePath)
        .catch((unlinkErr) => {
          logger.error('删除部分下载的文件失败:', unlinkErr);
        })
        .finally(() => {
          resolve(false);
        });
    });
  });
}

// 使用ffmpeg下载并转码视频
async function downloadWithFFmpeg(
  url: string,
  filePath: string
): Promise<boolean> {
  logger.log('检测到m3u8流媒体链接，尝试使用ffmpeg下载并转码');
  const mp4FilePath = ensureCorrectExtension(filePath, true);

  // 首先尝试转码
  const transcodeCommand = `ffmpeg -y -allowed_extensions ALL -i "${url}" -c:v libx264 -c:a aac -strict experimental "${mp4FilePath.replace(
    /\\/g,
    '/'
  )}"`;
  logger.log(`执行转码命令: ${transcodeCommand}`);

  try {
    const { stdout, stderr } = await execPromise(transcodeCommand);
    logger.log('ffmpeg转码输出:', stdout);
    if (stderr) logger.log('ffmpeg转码错误输出:', stderr);
    logger.log(`m3u8视频下载并转码完成: ${mp4FilePath.replace(/\\/g, '/')}`);
    return true;
  } catch (transcodeError) {
    logger.error('ffmpeg转码失败:', transcodeError);
    // 如果转码失败，尝试直接复制流
    logger.log('尝试直接复制流...');
    const copyCommand = `ffmpeg -y -allowed_extensions ALL -i "${url}" -c copy "${mp4FilePath.replace(
      /\\/g,
      '/'
    )}"`;
    try {
      const { stdout, stderr } = await execPromise(copyCommand);
      logger.log('ffmpeg复制流输出:', stdout);
      if (stderr) logger.log('ffmpeg复制流错误输出:', stderr);
      logger.log(
        `m3u8视频下载完成(直接复制流): ${mp4FilePath.replace(/\\/g, '/')}`
      );
      return true;
    } catch (copyError) {
      logger.error('ffmpeg直接复制流失败:', copyError);
      // 如果ffmpeg命令失败，回退到HTTP下载
      logger.log('ffmpeg不可用，回退到HTTP下载...');
      return await downloadM3u8AsHttp(url, filePath);
    }
  }
}

// 确保文件扩展名正确
function ensureCorrectExtension(filePath: string, forceMp4 = false): string {
  if (forceMp4 && !filePath.endsWith('.mp4')) {
    return filePath.replace(/\.[^/.]+$/, '') + '.mp4';
  }
  return filePath;
}

// 主下载逻辑
async function downloadVideoFile(
  url: string,
  filePath: string
): Promise<boolean> {
  try {
    logger.log(`=== 开始下载视频文件 ===`);
    logger.log(`源URL: ${url}`);
    logger.log(`目标路径: ${filePath}`);

    // 确保目标目录存在
    const dirPath = path.dirname(filePath);
    await ensureDir(dirPath);

    // 根据URL类型选择下载方式
    if (url.includes('.m3u8')) {
      return await downloadWithFFmpeg(url, filePath);
    } else {
      logger.log('普通视频文件，使用HTTP下载');
      return await downloadWithHttp(url, filePath);
    }
  } catch (error) {
    logger.error('下载视频失败:', error);
    return false;
  }
}

/**
 * 执行下载任务的函数
 * @param task - 任务对象
 * @param videoDetail - 视频详情
 * @param startEpisode - 起始集数
 * @param totalEpisodes - 总集数
 * @param cachedEpisodes - 已缓存的集数
 * @param fullDownloadPath - 完整下载路径
 * @param runningFlagPath - 运行标记文件路径
 */
export async function executeDownloadJob(
  task: ServerDownloadTask,
  videoDetail: SearchResult,
  startEpisode: number,
  totalEpisodes: number,
  cachedEpisodes: number[],
  fullDownloadPath: string,
  runningFlagPath: string
) {
  let successCount = 0;
  let failCount = 0;

  // 确保下载目录存在
  await ensureDir(fullDownloadPath);

  for (let i = startEpisode; i <= totalEpisodes; i++) {
    // 跳过已下载的集数
    if (cachedEpisodes.includes(i)) {
      continue;
    }

    // 检查当前集数是否在视频详情中存在
    if (!videoDetail.episodes || i > videoDetail.episodes.length) {
      continue;
    }

    const episodeUrl = videoDetail.episodes[i - 1];
    // 清理文件名中的特殊字符
    const cleanTitle = task.title.replace(
      /[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu,
      '_'
    );
    const fileName = cleanTitle + '_第' + i + '集.mp4';
    const filePath = path.join(fullDownloadPath, fileName);

    // 下载视频文件
    const success = await downloadVideoFile(episodeUrl, filePath);

    if (success) {
      successCount++;
      logger.log(`第${i}集下载成功`);

      // 保存缓存视频记录
      try {
        const cachedVideo: ServerCachedVideo = {
          id: task.id,
          unique_id: `video_${task.id}_${i}`,
          title: task.title,
          poster: videoDetail.poster || '',
          episode_path: path.relative(getBaseDownloadPath(), filePath),
          episode_number: i,
          source: task.source,
          source_name: videoDetail.source_name || '',
          class: videoDetail.class,
          year: videoDetail.year || '',
          desc: videoDetail.desc,
          type_name: videoDetail.type_name,
          douban_id: videoDetail.douban_id,
          org_source: videoDetail.source || '',
          org_source_id: videoDetail.id || '',
          download_time: Date.now(),
        };
        await saveServerCachedVideo(cachedVideo);
      } catch (err) {
        logger.error(`保存第${i}集缓存记录失败:`, err);
      }

      // 更新任务集数
      try {
        task.startEpisode = i + 1;
        task.updatedAt = Date.now();
        await saveServerDownloadTask(task);
      } catch (err) {
        logger.error(`更新任务集数记录失败:`, err);
      }
    } else {
      failCount++;
      logger.error(`下载第${i}集失败`);
    }
  }

  logger.log(`任务完成，成功: ${successCount}, 失败: ${failCount}`);
  // 删除运行标记文件
  try {
    fs.unlinkSync(runningFlagPath);
  } catch (err) {
    // 忽略错误
  }
  return { successCount, failCount };
}

// 获取基础下载路径
export function getBaseDownloadPath(): string {
  // 从环境变量获取基础下载路径
  const baseDownloadPath =
    process.env.DOWNLOAD_PATH || process.env.NEXT_PUBLIC_DOWNLOAD_PATH;
  if (baseDownloadPath) {
    return baseDownloadPath;
  }

  // 从配置文件获取基础下载路径
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.download_path) {
        return config.download_path;
      }
    }
  } catch (err) {
    logger.error('读取配置文件失败:', err);
  }

  // 默认基础下载路径
  return '/downloads';
}
