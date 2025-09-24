/* eslint-disable no-console */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import pLimit from 'p-limit';
import path from 'path';
import { URL } from 'url';

// 创建异步版本的fs函数
const fsPromises = {
  access: fs.promises.access,
  mkdir: fs.promises.mkdir,
  existsSync: fs.existsSync.bind(fs),
  createWriteStream: fs.createWriteStream.bind(fs),
  unlink: fs.promises.unlink,
  writeFile: fs.promises.writeFile,
  readFile: fs.promises.readFile,
  rm: fs.promises.rm,
  stat: fs.promises.stat,
};

// 跟踪进程状态和资源
let activeDownloadStreams = new Set();
let downloadFileName = '';
let isStop = false;
let processTime = Date.now();

/**
 * 发送消息给父进程的辅助函数
 * @param {string} type - 消息类型
 * @param {*} data - 消息数据
 */
export function sendMessage(type, data) {
  // 发送消息给父进程
  if (typeof process.send === 'function') {
    process.send({ type, data });
  }
}

/**
 * 删除文件（如果存在）
 * @param {string} filePath - 要删除的文件路径
 * @returns {Promise<void>}
 */
function deleteFileIfExists(filePath) {
  if (fsPromises.existsSync(filePath)) {
    try {
      fsPromises.unlink(filePath);
      sendMessage('info', `已删除下载失败的文件: ${filePath}`);
    } catch (unlinkError) {
      sendMessage('warn', `删除下载失败的文件时出错: ${filePath}, 错误: ${unlinkError.message}`);
    }
  }
}

/**
 * 清理临时目录
 * @param {string} dirPath - 临时目录路径
 */
async function cleanupTempDirectory(dirPath) {
  if (fsPromises.existsSync(dirPath)) {
    try {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      sendMessage('info', `临时目录已删除: ${dirPath}`);
    } catch (err) {
      sendMessage('warn', `删除临时目录失败: ${err.message}`);
    }
  }
}

/**
 * 终止当前所有下载进程和清理资源
 */
function killCurrentProcess() {
  // 中止所有活动的下载流
  activeDownloadStreams.forEach(stream => {
    try {
      stream.destroy();
    } catch (error) {
      // 忽略销毁过程中的错误
    }
  });
  activeDownloadStreams.clear();
}

/**
 * 使用HTTP下载文件
 * @param {string} url - 下载URL
 * @param {string} filePath - 文件保存路径
 * @param {number} downloadTimeout - 下载超时时间（秒）
 * @param {string} logLevel - 日志级别：'quiet'（仅错误）、'normal'（正常）、'verbose'（详细）
 * @returns {Promise<boolean>} - 下载是否成功
 */
async function downloadWithHttp(url, filePath, downloadTimeout = 3600, logLevel = 'normal') {
  return new Promise((resolve, _reject) => {
    if (logLevel !== 'quiet') {
      sendMessage('debug', `建立HTTP连接到: ${url}`);
    }
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    // 添加请求头
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
        'Referer': parsedUrl.origin + '/',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      }
    };

    const fileStream = fsPromises.createWriteStream(filePath);

    // 使用带请求头的options
    const request = client.get(url, options, async (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        sendMessage('error', `HTTP错误: ${response.statusCode} ${response.statusMessage}`);
        fileStream.close();
        await deleteFileIfExists(filePath);
        resolve(false);
        return;
      }

      // 获取文件大小信息
      const contentLength = response.headers['content-length'];
      if (logLevel === 'verbose') {
        sendMessage('info', `文件大小: ${contentLength ? `${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB` : '未知'}`);
      }

      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const currentTime = Date.now();
        if (logLevel === 'verbose' && contentLength && currentTime - processTime >= 60000) { // 每60秒更新一次进度
          const progress = ((downloadedBytes / parseInt(contentLength)) * 100).toFixed(1);
          sendMessage('info', `下载进度: ${progress}% (${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB)`);
          processTime = currentTime;
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        if (logLevel === 'verbose') {
          sendMessage('info', `HTTP视频下载完成: ${filePath}`);
          sendMessage('info', `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`);
        }
        resolve(true);
      });

      fileStream.on('error', (err) => {
        sendMessage('error', `文件写入失败: ${err.message}`);
        resolve(false);
      });
    });

    // 跟踪活动下载流
    activeDownloadStreams.add(request);

    request.on('error', async (err) => {
      sendMessage('error', `HTTP请求失败: ${err.message} ${url}`);
      fileStream.close();
      await deleteFileIfExists(filePath);
      resolve(false);
    });

    request.setTimeout(downloadTimeout * 1000, () => {
      sendMessage('error', `HTTP请求超时 ${url}`);
      request.destroy();
    });
  });
}

/**
 * 从m3u8文件提取TS片段URL并保存m3u8内容到本地，选择最大码率的流
 * @param {string} url - m3u8文件URL
 * @param {string} m3u8Dir - m3u8文件保存目录
 * @returns {Promise<string[]>} - TS片段URL数组
 */
async function getM3u8Url(url, m3u8Dir) {
  try {
    // 解析URL获取基础URL和路径
    const originalUrlObj = new URL(url);
    const basePath = originalUrlObj.pathname.substring(0, originalUrlObj.pathname.lastIndexOf('/') + 1);
    let baseUrl = originalUrlObj.origin;
    let baseUrlWithPath = `${baseUrl}${basePath}`;

    // 读取m3u8文件内容，带重试机制
    let m3u8Content;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`获取m3u8文件失败: ${response.status} ${response.statusText}`);
      }
      m3u8Content = await response.text();
    } catch (fetchError) {
      sendMessage('error', `获取m3u8内容失败: ${fetchError.message}`);
      throw fetchError;
    }

    // 检查是否包含m3u8链接
    if (m3u8Content.includes('.m3u8')) {
      sendMessage('debug', '检测到EXTM3U格式内容');

      // 提取所有可能的m3u8链接和对应的码率
      const lines = m3u8Content.split('\n');
      const variantStreams = [];
      let currentBitrate = 0;
      let currentResolution = '';

      // 解析M3U8文件，寻找不同码率的m3u8链接
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // 检查是否是#EXT-X-STREAM-INF标签（包含码率信息）
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          // 提取带宽（码率）信息
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          if (bandwidthMatch && bandwidthMatch[1]) {
            currentBitrate = parseInt(bandwidthMatch[1]);
          }

          // 提取分辨率信息（如果有）
          const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
          if (resolutionMatch && resolutionMatch[1]) {
            currentResolution = resolutionMatch[1];
          }
        }
        // 检查是否是m3u8链接
        else if (line.includes('.m3u8')) {
          // 处理相对路径
          let nestedM3u8Url;
          if (line.startsWith('http')) {
            // http开头的URL，直接使用
            nestedM3u8Url = line;
          } else if (line.startsWith('/')) {
            // /开头的URL，使用baseUrl拼接
            nestedM3u8Url = new URL(line, baseUrl).toString();
          } else {
            // 其他情况，使用baseUrlWithPath拼接
            nestedM3u8Url = new URL(line, baseUrlWithPath).toString();
          }

          // 添加到变体流列表
          variantStreams.push({
            url: nestedM3u8Url,
            bitrate: currentBitrate,
            resolution: currentResolution
          });

          // 重置当前码率和分辨率
          currentBitrate = 0;
          currentResolution = '';
        }
      }

      // 如果找到多个变体流，选择码率最大的
      if (variantStreams.length > 0) {
        // 按码率降序排序
        variantStreams.sort((a, b) => b.bitrate - a.bitrate);

        const highestBitrateStream = variantStreams[0];
        sendMessage('debug', `找到 ${variantStreams.length} 个不同码率的流，选择最大码率: ${highestBitrateStream.bitrate} bps${highestBitrateStream.resolution ? ` (${highestBitrateStream.resolution})` : ''}`);

        try {
          // 尝试获取最高码率流的m3u8内容
          const highestBitrateResponse = await fetch(highestBitrateStream.url);
          if (highestBitrateResponse.ok) {
            const highestBitrateContent = await highestBitrateResponse.text();

            // 更新当前使用的m3u8内容和基础路径
            m3u8Content = highestBitrateContent;
            url = highestBitrateStream.url;

            // 更新基础路径
            const nestedUrlObj = new URL(url);
            const nestedBasePath = nestedUrlObj.pathname.substring(0, nestedUrlObj.pathname.lastIndexOf('/') + 1);
            baseUrl = nestedUrlObj.origin;
            baseUrlWithPath = `${baseUrl}${nestedBasePath}`;
          }
        } catch (highestBitrateError) {
          sendMessage('debug', `获取最高码率m3u8失败: ${highestBitrateError.message}，继续使用原始m3u8`);
        }
      }
    }

    let newM3u8Content = '';
    const lines = m3u8Content.split('\n');
    const urls = [];

    // 先处理所有行，构建正确顺序的URL列表
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && line.includes('.ts') && !line.startsWith('#')) {
        let tsUrl;
        if (trimmedLine.startsWith('http')) {
          tsUrl = trimmedLine;
        } else if (trimmedLine.startsWith('/')) {
          tsUrl = new URL(trimmedLine, baseUrl).toString();
        } else {
          tsUrl = new URL(trimmedLine, baseUrlWithPath).toString();
        }

        // 直接按顺序写入newM3u8Content
        newM3u8Content += tsUrl.split('/').pop().split('?')[0] + '\n';
        urls.push(tsUrl);
      } else if (trimmedLine.startsWith('#EXT-X-KEY')) {
        // KEY处理逻辑保持不变，但需要将异步操作移到后面统一处理
        const keyMatch = trimmedLine.match(/URI="([^"]+)"/);
        let keyUrl = '';
        if (keyMatch && keyMatch[1]) {
          keyUrl = keyMatch[1];
          let absoluteKeyUrl = keyUrl;
          if (keyUrl.startsWith('/')) {
            absoluteKeyUrl = new URL(keyUrl, baseUrl).toString();
          } else if (!keyUrl.startsWith('http')) {
            absoluteKeyUrl = new URL(keyUrl, baseUrlWithPath).toString();
          }
          // 保存keyUrl以便后续统一下载
          if (absoluteKeyUrl) {
            urls.push(absoluteKeyUrl);
          }
        }
        newM3u8Content += line.replace(keyUrl, keyUrl.split('/').pop().split('?')[0]) + '\n';
      } else {
        // 保留其他所有行
        newM3u8Content += line + '\n';
      }
    }

    // 保存入口m3u8文件到index.m3u8
    if (m3u8Dir) {
      const indexFilePath = path.join(m3u8Dir, 'index.m3u8');
      try {
        await fsPromises.writeFile(indexFilePath, newM3u8Content, 'utf8');
        sendMessage('info', `已保存入口m3u8文件到: ${indexFilePath}`);
      } catch (writeError) {
        sendMessage('error', `保存m3u8文件失败: ${writeError.message}`);
      }
    }

    return urls;
  } catch (error) {
    sendMessage('error', `处理m3u8文件时出错: ${error.message}`);
    throw error;
  }
}

/**
 * 重试执行异步操作的函数
 * @param {Function} operation - 要执行的异步操作
 * @param {Object} options - 重试选项
 * @param {number} options.retries - 最大重试次数
 * @param {number} options.delay - 重试间隔时间（毫秒）
 * @returns {Promise<any>} 操作的结果
 */
async function retry(operation, { retries = 3, delay = 1000 }) {
  let attempts = 0;
  while (attempts <= retries) {
    try {
      return await operation();
    } catch (error) {
      attempts++;
      if (attempts > retries) {
        throw error;
      }
      sendMessage('error', `操作失败，将在 ${delay}ms 后重试 (${attempts}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('重试次数超过最大重试次数');
}

/**
 * 下载m3u8格式视频
 * @param {string} url - m3u8文件URL
 * @param {string} directoryPath - 输出文件目录
 * @param {string} downloadFileName - 输出文件名（不含扩展名）
 * @param {number} downloadTimeout - 下载超时时间（秒）
 * @param {boolean} keepCacheOnFailure - 是否保留失败时的缓存，用于重新下载时复用
 * @param {number} concurrency - 并发下载数量，默认为5
 * @param {boolean} isMerge - 是否合并文件，默认为false
 * @returns {Promise<{success: boolean, filePath: string|null}>} - 下载结果对象，包含成功状态和文件路径
 */
async function downloadM3u8(url, directoryPath, downloadFileName, downloadTimeout = 3600, keepCacheOnFailure = true, concurrency = 5, isMerge = false) {
  const controller = new AbortController();
  const { signal } = controller;
  let m3u8Dir = null;
  // 设置超时处理
  const timeoutId = setTimeout(() => {
    sendMessage('error', `下载超时: ${url}`);
    controller.abort();
    activeDownloadStreams.forEach(stream => stream.destroy());
    throw new Error('下载超时');
  }, downloadTimeout * 1000);

  try {

    // 获取m3u8文件的目录
    m3u8Dir = path.join(directoryPath, downloadFileName + '_m3u8');
    sendMessage('debug', `m3u8文件目录: ${m3u8Dir}`);

    // 创建m3u8文件的目录（如果不存在）
    await fsPromises.mkdir(m3u8Dir, { recursive: true });

    // 获取m3u8文件的URL列表
    const m3u8Urls = await getM3u8Url(url, m3u8Dir);
    if (!m3u8Urls.length) {
      sendMessage('error', `获取m3u8文件URL失败: ${url}`);
      throw new Error('获取m3u8文件URL失败');
    }

    if (isStop) {
      sendMessage('warn', `下载已被中止: ${url}`);
      throw new Error('下载已被中止');
    }

    // 使用p-limit控制并发下载
    const limit = pLimit(concurrency);
    sendMessage('info', `开始下载 ${m3u8Urls.length} 个TS片段，并发数: ${concurrency}`);

    // 准备文件路径数组，保持与m3u8Urls相同的顺序
    const allTsFiles = [];

    // 下载TS片段并设置重试次数
    const downloadPromises = m3u8Urls.map((url, index) => {
      const filePath = path.join(m3u8Dir, url.split('/').pop());
      allTsFiles.push(filePath); // 预先记录所有文件路径，保持顺序

      return limit(() => {
        if (signal.aborted || isStop) {
          throw new Error('下载已被中止');
        }

        // 使用retry函数包装下载操作，实现失败重试
        return retry(() => {
          const currentTime = Date.now();
          if (currentTime - processTime >= 60000 || index + 1 == m3u8Urls.length) {
            processTime = currentTime;
            sendMessage('debug', `正在下载第 ${index + 1}/${m3u8Urls.length} 个TS片段`);
          }
          if (fs.existsSync(filePath)) {
            return true;
          }
          return downloadWithHttp(url, filePath, 300, 'quiet'); // 使用quiet模式减少日志输出
        }, {
          retries: 3,
          delay: 2000
        }).then(success => {
          // 返回下载结果状态，而不是文件路径
          if (!success) {
            sendMessage('error', `下载TS片段失败: ${url}`);
            return false;
          }
          return true;
        }).catch(error => {
          sendMessage('error', `下载TS片段失败: ${url}, 错误: ${error.message}`);
          return false;
        });
      });
    });

    // 等待所有下载完成
    const downloadResults = await Promise.all(downloadPromises);

    if (downloadResults.length === 0) {
      sendMessage('error', `所有TS片段下载失败: ${url}`);
      throw new Error('所有TS片段下载失败');
    }

    let isSuccess = downloadResults.every(result => result);
    if (!isSuccess) {
      sendMessage('warn', `部分TS片段下载失败，成功 ${downloadResults.filter(result => result).length}/${downloadResults.length} 个`);
    } else {
      sendMessage('info', `所有 ${downloadResults.length} 个TS片段下载完成`);
    }

    if (isStop) {
      sendMessage('warn', `下载已被中止: ${url}`);
      throw new Error('下载已被中止');
    }

    // 调用合并文件
    if (isMerge && isSuccess) {
      sendMessage('info', '开始合并TS片段为单一文件');
      const filePath = path.join(directoryPath, downloadFileName + '.mp4');
      const isMergeSuccess = await new Promise((resolve, _reject) => {
        const ffmpegProcess = spawn('ffmpeg', [
          '-y',
          '-allowed_extensions', 'ALL',
          '-i', path.join(m3u8Dir, 'index.m3u8'),
          '-c', 'copy',
          filePath
        ])

        ffmpegProcess.on('close', async (code) => {
          if (code === 0) {
            sendMessage('success', `合并文件成功: ${filePath}`);
            // 下载成功后删除临时目录
            await cleanupTempDirectory(m3u8Dir);
            resolve(true);
          } else {
            sendMessage('error', `合并文件失败: ${filePath}, 退出码: ${code}`);
            resolve(false);
          }
        });

        ffmpegProcess.on('error', (error) => {
          sendMessage('error', `合并文件失败: ${filePath}, 错误: ${error.message}`);
          resolve(false);
        });

        ffmpegProcess.stderr.on('data', (data) => {
          sendMessage('debug', data.toString().trim());
        });

        ffmpegProcess.stdout.on('data', (data) => {
          sendMessage('debug', data.toString().trim());
        });
      });

      if (!isMergeSuccess) {
        await deleteFileIfExists(filePath);
        return { success: false, filePath: path.join(m3u8Dir, 'index.m3u8') };
      } else {
        return { success: true, filePath: filePath };
      }
    } else if (isSuccess) {
      return { success: isSuccess, filePath: path.join(m3u8Dir, 'index.m3u8') };
    } else {
      return { success: isSuccess, filePath: '' };
    }
  } catch (error) {
    // 下载失败时，根据参数决定是否保留缓存
    if (!keepCacheOnFailure && m3u8Dir) {
      await cleanupTempDirectory(m3u8Dir);
      sendMessage('info', `下载失败，已清理临时目录: ${m3u8Dir}`);
    } else if (m3u8Dir) {
      sendMessage('info', `下载失败，保留临时目录以便重新下载复用: ${m3u8Dir}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    activeDownloadStreams.clear();
  }
}

/**
 * 主下载逻辑
 * @param {string} url - 视频文件的URL
 * @param {string} directoryPath - 下载文件的目标目录
 * @param {string} title - 视频标题
 * @param {number} episodeNumber - 视频集数
 * @param {number} [downloadTimeout=3600] - 下载超时时间（秒）
 * @returns {Promise<{success: boolean, filePath: string|null}>} - 下载结果对象，包含成功状态和文件路径
 */
async function downloadVideoFile(url, directoryPath, title, episodeNumber, downloadTimeout = 3600) {
  // 清理文件名中的特殊字符
  const cleanTitle = title.replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu, '_');
  // 创建不带后缀的文件名
  const fileNameWithoutExt = cleanTitle + '_第' + episodeNumber + '集';
  try {
    sendMessage('info', `开始下载视频文件: ${fileNameWithoutExt}; 源URL: ${url}`);

    // 根据URL类型选择下载方式
    if (url.includes('.m3u8')) {
      const success = await downloadM3u8(url, directoryPath, fileNameWithoutExt, downloadTimeout, true, 5, true);
      if (success && success.success) {
        return { success: true, filePath: success.filePath };
      } else if (success && success.filePath) {
        sendMessage('error', `合并mp4失败，保留m3u8格式`);
        return { success: true, filePath: success.filePath };
      } else {
        sendMessage('error', `下载M3U8文件失败: ${url}`);
        return { success: false, filePath: null };
      }
    } else {
      sendMessage('info', '普通视频文件，使用HTTP下载');
      // 从URL中提取文件扩展名或使用默认扩展名
      const fileExtension = extractFileExtensionFromUrl(url) || 'mp4';
      downloadFileName = path.join(directoryPath, fileNameWithoutExt + '.' + fileExtension);
      const success = await downloadWithHttp(url, downloadFileName, downloadTimeout);
      return { success, filePath: downloadFileName };
    }
  } catch (error) {
    sendMessage('error', `下载视频失败: ${error.message}`);
    return { success: false, filePath: null };
  }
}

// 从URL中提取文件扩展名的辅助函数
function extractFileExtensionFromUrl(url) {
  try {
    // 解析URL
    const parsedUrl = new URL(url);
    // 获取路径名的最后一部分
    const pathName = parsedUrl.pathname;
    // 提取扩展名（不包含点）
    const match = pathName.match(/\.([^.\\/]+)$/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    return null;
  } catch (e) {
    // 如果URL解析失败，尝试直接从字符串中提取
    const match = url.match(/\.([^.\\/]+)$/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    return null;
  }
}

/**
 * 执行下载任务的函数
 * @param task - 任务对象
 * @param downloadEpisodes - 下载集数
 * @param fullDownloadPath - 完整下载路径
 */
async function executeDownloadJob(
  task,
  downloadEpisodes,
  fullDownloadPath
) {
  let successCount = 0;
  let failCount = 0;
  const downloadTimeout = task.downloadTimeout || 3600;

  for (const episode of downloadEpisodes) {
    if (isStop) {
      break;
    }
    const episodeUrl = episode.url;

    // 下载视频文件 - 现在传入路径和不带后缀的文件名
    const result = await downloadVideoFile(episodeUrl, fullDownloadPath, task.title, episode.episodeNumber, downloadTimeout);

    if (result.success) {
      successCount++;
      // 发送下载成功的特定类型消息
      sendMessage('download_complete', {
        episodeNumber: episode.episodeNumber,
        filePath: result.filePath,
        taskTitle: task.title,
      });
    } else {
      failCount++;
      // 发送下载失败的特定类型消息
      sendMessage('download_error', {
        episodeNumber: episode.episodeNumber,
        taskTitle: task.title,
      });
    }
  }

  sendMessage('info', `任务完成，成功: ${successCount}, 失败: ${failCount}`);
  process.exit(successCount > 0 ? 0 : 1);
}

// 从命令行参数获取任务数据
const taskData = JSON.parse(process.argv[2]);
// 执行下载任务
executeDownloadJob(
  taskData.task,
  taskData.downloadEpisodes,
  taskData.fullDownloadPath
).catch(err => {
  console.error('下载任务执行失败:', err);
  process.exit(1);
});

process.on("message", msg => {
  if (msg === "terminate") {
    isStop = true;
    sendMessage('warn', '收到终止信号，正在退出...');
    try {
      killCurrentProcess();
    } finally {
      setTimeout(() => {
        process.exit(0);
      }, 10000);
    }
  }
})