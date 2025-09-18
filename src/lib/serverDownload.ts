/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildProcess, fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import logger from '@/lib/logger';
import {
  ChildProcessMessage,
  SearchResult,
  ServerCachedVideo,
  ServerDownloadTask,
} from '@/lib/types';

// 创建异步版本的fs函数
const fsPromises = {
  access: promisify(fs.access),
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  mkdir: promisify(fs.mkdir),
  stat: promisify(fs.stat),
  existsSync: fs.existsSync.bind(fs),
  createReadStream: fs.createReadStream.bind(fs),
  createWriteStream: fs.createWriteStream.bind(fs),
  unlink: promisify(fs.unlink),
};

// 存储正在运行的任务进程
const runningTasks: Map<string, ChildProcess> = new Map();

// 确保目录存在
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fsPromises.access(dirPath);
  } catch {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }
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

// 删除下载任务
export async function deleteServerDownloadTask(taskId: string): Promise<void> {
  try {
    const tasks = await getAllServerDownloadTasks();
    const filteredTasks = tasks.filter((t) => t.id !== taskId);

    const dataDir = path.join(process.cwd(), 'data');
    await ensureDir(dataDir);
    const filePath = path.join(dataDir, 'download-tasks.json');
    await fsPromises.writeFile(
      filePath,
      JSON.stringify(filteredTasks, null, 2)
    );
  } catch (err) {
    logger.error(`删除下载任务失败:`, err);
    throw err;
  }
}

// 根据ID获取下载任务
export async function getServerDownloadTaskById(
  taskId: string
): Promise<ServerDownloadTask | null> {
  try {
    const tasks = await getAllServerDownloadTasks();
    const task = tasks.find((t) => t.id === taskId);
    return task || null;
  } catch (err) {
    logger.error(`获取下载任务失败:`, err);
    return null;
  }
}

// 删除缓存视频记录
export async function deleteServerCachedVideo(uniqueId: string): Promise<void> {
  try {
    const videos = await getAllServerCachedVideos();
    const filteredVideos = videos.filter((v) => v.unique_id !== uniqueId);

    const dataDir = path.join(process.cwd(), 'data');
    await ensureDir(dataDir);
    const filePath = path.join(dataDir, 'cached-videos.json');
    await fsPromises.writeFile(
      filePath,
      JSON.stringify(filteredVideos, null, 2)
    );
  } catch (err) {
    logger.error(`删除缓存视频失败:`, err);
    throw err;
  }
}

// 解析Cron表达式并计算下次运行时间
export function calculateNextRun(
  cronExpression: string,
  currentTime?: number
): number | undefined {
  try {
    // 支持 cron 表达式格式: "分钟 小时 日 月 周"
    // 例如: "0 2 * * *" - 每天凌晨2点
    //       "*/5 * * * *" - 每5分钟
    //       "0 */2 * * *" - 每2小时
    const parts = cronExpression.trim().split(' ');
    if (parts.length !== 5) {
      logger.warn(
        `无效的 cron 表达式格式: ${cronExpression}，使用默认24小时间隔`
      );
      return currentTime ? currentTime + 24 * 60 * 60 * 1000 : undefined;
    }

    const [minutePart, hourPart, _dayPart, _monthPart, _weekPart] = parts;
    const currentDate = new Date(currentTime || Date.now());

    // 解析分钟部分
    let nextMinutes = currentDate.getMinutes();
    if (minutePart !== '*') {
      if (minutePart.includes('*/')) {
        const step = parseInt(minutePart.substring(2));
        nextMinutes = Math.floor(nextMinutes / step) * step + step;
        if (nextMinutes >= 60) {
          nextMinutes = 0;
          currentDate.setHours(currentDate.getHours() + 1);
        }
      } else {
        const minutes = parseInt(minutePart);
        if (minutes > currentDate.getMinutes()) {
          nextMinutes = minutes;
        } else {
          nextMinutes = minutes;
          currentDate.setHours(currentDate.getHours() + 1);
        }
      }
    } else {
      nextMinutes++;
      if (nextMinutes >= 60) {
        nextMinutes = 0;
        currentDate.setHours(currentDate.getHours() + 1);
      }
    }

    // 解析小时部分
    let nextHours = currentDate.getHours();
    if (hourPart !== '*') {
      if (hourPart.includes('*/')) {
        const step = parseInt(hourPart.substring(2));
        nextHours = Math.floor(nextHours / step) * step + step;
        if (nextHours >= 24) {
          nextHours = 0;
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        const hours = parseInt(hourPart);
        if (
          hours > nextHours ||
          (hours === nextHours && nextMinutes > currentDate.getMinutes())
        ) {
          nextHours = hours;
        } else {
          nextHours = hours;
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
    }

    currentDate.setMinutes(nextMinutes);
    currentDate.setHours(nextHours);
    currentDate.setSeconds(0);
    currentDate.setMilliseconds(0);

    // 如果计算的时间已经过去了，增加到下一个周期
    if (currentDate.getTime() <= (currentTime || Date.now())) {
      if (minutePart === '*' && hourPart === '*') {
        // 每分钟执行，加1分钟
        currentDate.setTime(currentDate.getTime() + 60 * 1000);
      } else if (hourPart === '*') {
        // 每小时执行，加1小时
        currentDate.setTime(currentDate.getTime() + 60 * 60 * 1000);
      } else {
        // 每天、每周、每月等，加1天
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return currentDate.getTime();
  } catch (error) {
    logger.error(`解析 cron 表达式时出错: ${cronExpression}`, error);
    // 出错时使用默认24小时间隔
    return currentTime ? currentTime + 24 * 60 * 60 * 1000 : undefined;
  }
}

// 获取指定视频的所有已缓存集数
export async function getCachedEpisodes(id: string): Promise<number[]> {
  const videos = await getAllServerCachedVideos();
  return videos
    .filter((v) => v.id === id)
    .map((v) => v.episode_number)
    .sort((a, b) => a - b);
}

// 根据视频标题获取缓存视频，返回SearchResult格式
export async function getServerCachedVideosByTitle(
  title: string
): Promise<SearchResult[]> {
  try {
    const allVideos = await getAllServerCachedVideos();
    const filteredVideos = allVideos.filter((video) => video.title === title);

    // 按id分组
    const groupedVideos: { [id: string]: ServerCachedVideo[] } = {};
    filteredVideos.forEach((video) => {
      if (!groupedVideos[video.id]) {
        groupedVideos[video.id] = [];
      }
      groupedVideos[video.id].push(video);
    });

    // 为每个分组创建一个SearchResult对象
    const results: SearchResult[] = [];
    for (const id in groupedVideos) {
      const videos = groupedVideos[id];
      if (videos.length > 0) {
        const firstVideo = videos[0];
        // 按episode_number排序
        const sortedVideos = videos.sort(
          (a, b) => a.episode_number - b.episode_number
        );

        results.push({
          id: firstVideo.id,
          title: firstVideo.title,
          poster: firstVideo.poster,
          episodes: sortedVideos.map(
            (video) =>
              `/api/download/file?path=${encodeURIComponent(
                video.episode_path
              )}`
          ),
          episode_numbers: sortedVideos.map((video) => video.episode_number),
          source: 'server_cache',
          source_name: '服务器缓存',
          class: firstVideo.class,
          year: firstVideo.year,
          desc: firstVideo.desc,
          type_name: firstVideo.type_name,
          douban_id: firstVideo.douban_id,
        });
      }
    }

    return results;
  } catch (err) {
    logger.error(`根据标题获取缓存视频失败:`, err);
    return [];
  }
}

// 根据ID获取缓存视频，返回SearchResult格式
export async function getServerCachedVideosById(
  id: string
): Promise<SearchResult[]> {
  try {
    const allVideos = await getAllServerCachedVideos();
    const filteredVideos = allVideos.filter((video) => video.id === id);

    if (filteredVideos.length === 0) {
      return [];
    }

    // 按episode_number排序
    const sortedVideos = filteredVideos.sort(
      (a, b) => a.episode_number - b.episode_number
    );

    const firstVideo = sortedVideos[0];

    return [
      {
        id: firstVideo.id,
        title: firstVideo.title,
        poster: firstVideo.poster,
        episodes: sortedVideos.map(
          (video) =>
            `/api/download/file?path=${encodeURIComponent(video.episode_path)}`
        ),
        episode_numbers: sortedVideos.map((video) => video.episode_number),
        source: 'server_cache',
        source_name: '服务器缓存',
        class: firstVideo.class,
        year: firstVideo.year,
        desc: firstVideo.desc,
        type_name: firstVideo.type_name,
        douban_id: firstVideo.douban_id,
      },
    ];
  } catch (err) {
    logger.error(`根据ID获取缓存视频失败:`, err);
    return [];
  }
}

// 获取所有下载任务
// 改进后的实现
export async function getAllDownloadTasks(): Promise<string[]> {
  // 获取当前运行中的任务ID
  const runningTaskIds = [...runningTasks.keys()];

  // 检查data目录中的锁文件
  const dataDir = path.join(process.cwd(), 'data');
  const allTaskIds = new Set(runningTaskIds);

  try {
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);

      files.forEach((file) => {
        // 查找以download-task-开头并以.running结尾的文件
        if (file.startsWith('download-task-') && file.endsWith('.running')) {
          // 从文件名中提取任务ID
          const taskId = file
            .replace('download-task-', '')
            .replace('.running', '');
          allTaskIds.add(taskId);
        }
      });
    }
  } catch (err) {
    logger.error('读取data目录中的锁文件时出错:', err);
  }

  // 返回所有唯一的任务ID
  return Array.from(allTaskIds);
}

// 停止指定任务的下载进程
export function stopDownloadTask(taskId: string): boolean {
  const subProcess = runningTasks.get(taskId);
  const runningFlagPath = path.join(
    process.cwd(),
    'data',
    `download-task-${taskId}.running`
  );
  // 检查并删除运行标记文件
  if (fs.existsSync(runningFlagPath)) {
    fs.unlinkSync(runningFlagPath);
  }

  if (subProcess) {
    try {
      subProcess.send('terminate');

      // 2秒后检查进程是否仍在运行，如果是则使用SIGKILL强制终止
      setTimeout(() => {
        if (!subProcess.killed) {
          subProcess.kill('SIGKILL');
        }
        runningTasks.delete(taskId);
        logger.info(`任务 ${taskId} 的下载进程已停止`);
      }, 2000);

      return true;
    } catch (error) {
      logger.error(`停止任务 ${taskId} 的进程时出错:`, error);
      return false;
    }
  }
  logger.info(`未找到任务 ${taskId} 的运行进程`);
  return false;
}

// 执行单个下载任务
export async function executeDownloadTask(task: ServerDownloadTask) {
  const runningFlagPath = path.join(
    process.cwd(),
    'data',
    `download-task-${task.id}.running`
  );
  // 检查任务是否已经在运行
  if (runningTasks.has(task.id) || fs.existsSync(runningFlagPath)) {
    logger.info(`任务 ${task.title} 已经在运行中`);
    return;
  }

  // 检查起始集数是否超过总集数
  if (task.startEpisode > task.totalEpisodes) {
    logger.info(
      `任务 ${task.title} 起始集数(${task.startEpisode})超过总集数(${task.totalEpisodes})，不执行任务`
    );
    // 更新任务为停止状态
    task.enabled = false;
    task.updatedAt = Date.now();
    await saveServerDownloadTask(task);
    return;
  }

  // 检查当前运行任务数量是否已达上限
  const maxConcurrentDownloads = parseFloat(
    process.env.MAX_CONCURRENT_DOWNLOADS || '2'
  );
  if (runningTasks.size >= maxConcurrentDownloads) {
    logger.info(
      `当前正在运行的任务数量已达上限 ${maxConcurrentDownloads}，任务 ${task.title} 已被添加到等待队列`
    );
    return;
  }

  try {
    // 创建运行标记文件
    fs.writeFileSync(runningFlagPath, Date.now().toString());
    // 获取视频详情
    const videoDetail = await fetchVideoDetail({
      source: task.source,
      id: task.sourceId,
    });
    if (!videoDetail) {
      // 删除运行标记文件
      try {
        fs.unlinkSync(runningFlagPath);
      } catch (err) {
        // 忽略错误
      }
      throw new Error('获取视频详情失败');
    }

    // 获取基础下载路径
    const baseDownloadPath = getBaseDownloadPath();
    // 构建完整下载路径
    let fullDownloadPath: string;
    if (task.downloadPath && path.isAbsolute(task.downloadPath)) {
      // 如果是绝对路径，检查是否在基础下载路径内
      if (task.downloadPath.startsWith(baseDownloadPath)) {
        fullDownloadPath = task.downloadPath;
      } else {
        // 如果不在基础下载路径内，将其作为相对路径处理
        fullDownloadPath = path.join(
          baseDownloadPath,
          task.downloadPath.replace(/^[\\/]+/, '')
        );
      }
    } else if (task.downloadPath) {
      // 相对路径，拼接到基础下载路径后面
      fullDownloadPath = path.join(baseDownloadPath, task.downloadPath);
    } else {
      // 没有指定下载路径，使用基础下载路径
      fullDownloadPath = baseDownloadPath;
    }

    // 确保下载路径存在
    await ensureDir(fullDownloadPath);

    // 获取已下载的集数列表
    const cachedEpisodes = await getCachedEpisodes(task.id);

    const downloadEpisodes = Array.from(
      {
        length: Math.min(
          videoDetail.episodes?.length || 0,
          videoDetail.episode_numbers?.length || 0
        ),
      },
      (_, i) => {
        // 使用episode_numbers[i]如果存在，否则使用默认的集数编号（i+1）
        const episodeNumber = videoDetail.episode_numbers?.[i] || i + 1;
        return { episodeNumber, url: videoDetail.episodes[i] };
      }
    ).filter(
      (item) =>
        item.episodeNumber >= task.startEpisode &&
        item.episodeNumber <= task.totalEpisodes &&
        !cachedEpisodes.includes(item.episodeNumber)
    );

    // 检查下载集数
    if (downloadEpisodes.length === 0) {
      logger.info(`任务 ${task.title} 没有需要下载的集数，不执行任务`);

      task.nextRun = calculateNextRun(task.cronExpression);
      // 更新任务集数
      task.updatedAt = Date.now();
      await saveServerDownloadTask(task);
      // 删除运行标记文件
      try {
        fs.unlinkSync(runningFlagPath);
      } catch (err) {
        // 忽略错误
      }
      return;
    }

    // 使用独立的下载执行器模块
    const executorPath = path.resolve(
      process.cwd(),
      'scripts',
      'download-executor.mjs'
    );

    const taskProcess = fork(executorPath, [
      JSON.stringify({
        task,
        downloadEpisodes,
        fullDownloadPath,
      }),
    ]);

    // 存储进程引用
    runningTasks.set(task.id, taskProcess);

    logger.info(`任务 ${task.title} 已启动，PID: ${taskProcess.pid}`);
    let errorStop = false;

    // 修复类型错误：为message参数添加类型断言或类型守卫
    taskProcess.on('message', async (message: unknown) => {
      // 使用类型守卫确保message具有正确的结构
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message
      ) {
        const typedMessage = message as ChildProcessMessage;

        if (typedMessage.type === 'info') {
          logger.info(`[任务 ${task.title}] 输出: ${typedMessage.data}`);
        } else if (typedMessage.type === 'error') {
          logger.error(`[任务 ${task.title}] 错误: ${typedMessage.data}`);
        } else if (typedMessage.type === 'download_complete') {
          logger.info(
            `[任务 ${task.title}] 第${typedMessage.data.episodeNumber}集下载完成，文件路径: ${typedMessage.data.filePath}`
          );
          // 保存缓存视频记录
          try {
            const cachedVideo: ServerCachedVideo = {
              id: task.id,
              unique_id: `video_${task.id}_${typedMessage.data.episodeNumber}`,
              title: task.title,
              poster: videoDetail.poster || '',
              episode_path: path.relative(
                baseDownloadPath,
                typedMessage.data.filePath
              ),
              episode_number: typedMessage.data.episodeNumber,
              source: 'server_cache',
              source_name: '服务器缓存',
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
            logger.error(
              `[任务 ${task.title}] 保存第${typedMessage.data.episodeNumber}集缓存记录失败:`,
              err
            );
          }

          // 更新任务集数
          if (!errorStop) {
            try {
              if (typedMessage.data.episodeNumber >= task.totalEpisodes) {
                task.nextRun = calculateNextRun(task.cronExpression);
              }
              task.startEpisode = typedMessage.data.episodeNumber + 1;
              task.updatedAt = Date.now();
              await saveServerDownloadTask(task);
            } catch (err) {
              logger.error(`[任务 ${task.title}] 更新任务集数记录失败:`, err);
            }
          }
        } else if (typedMessage.type === 'download_error') {
          logger.error(`[任务 ${task.title}] 下载错误:`, typedMessage.data);
          errorStop = true;
        }
      } else {
        logger.debug(`[任务 ${task.title}] 未知消息类型:`, message);
      }
    });

    taskProcess.on('close', (code) => {
      logger.info(`[任务 ${task.title}] 已完成，退出码: ${code}`);
      runningTasks.delete(task.id);
      // 删除运行标记文件
      try {
        fs.unlinkSync(runningFlagPath);
      } catch (err) {
        // 忽略错误
      }
    });

    taskProcess.on('error', (error) => {
      logger.error(`[任务 ${task.title}] 启动失败:`, error);
      runningTasks.delete(task.id);
      // 删除运行标记文件
      try {
        fs.unlinkSync(runningFlagPath);
      } catch (err) {
        // 忽略错误
      }
    });
  } catch (error) {
    // 删除运行标记文件
    try {
      fs.unlinkSync(runningFlagPath);
    } catch (err) {
      // 忽略错误
    }
    logger.error(`[任务 ${task.title}] 执行任务时出错:`, error);
    throw error; // 重新抛出错误以便上层捕获
  }
}
