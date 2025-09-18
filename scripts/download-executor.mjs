/* eslint-disable no-console */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
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
};

// 跟踪ffmpeg进程
let currentFfmpegProcess = null;

// 发送消息的辅助函数
export function sendMessage(type, data) {
  // 发送消息给父进程
  if (typeof process.send === 'function') {
    process.send({ type, data });
  }
}

// 自定义的promisify spawn，支持进程跟踪
function execWithTracking(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    // 构建命令字符串用于日志输出
    const commandString = `${cmd} ${cmdArgs.join(' ')}`;
    sendMessage('info', `执行命令: ${commandString}`);

    const ffmpegProcess = spawn(cmd, cmdArgs, {
      stdio: 'pipe' // 可选，根据需要调整输出处理方式
    });

    // 保存进程引用以便后续可能的终止操作
    currentFfmpegProcess = ffmpegProcess;
    sendMessage('info', `ffmpeg进程ID: ${ffmpegProcess.pid}`);

    // 监听进程关闭事件
    ffmpegProcess.on('close', (code, signal) => {
      currentFfmpegProcess = null;
      if (code === 0) {
        resolve({ stdout: '', stderr: '' });
      } else {
        reject(new Error(`命令执行失败，退出码: ${code}, 信号: ${signal}`));
      }
    });

    // 监听错误事件
    ffmpegProcess.on('error', (error) => {
      currentFfmpegProcess = null;
      reject(error);
    });
  });
}

// 使用HTTP下载文件的辅助函数
async function downloadWithHttp(url, filePath, downloadTimeout = 3600) {
  return new Promise((resolve, _reject) => {
    sendMessage('info', `建立HTTP连接到: ${url}`);
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const fileStream = fsPromises.createWriteStream(filePath);

    const request = client.get(url, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        sendMessage('error', `HTTP错误: ${response.statusCode} ${response.statusMessage}`);
        fileStream.close();
        fsPromises
          .unlink(filePath)
          .catch((err) => {
            sendMessage('error', `删除部分下载的文件失败: ${err.message}`);
          })
          .finally(() => {
            resolve(false);
          }); // 删除部分下载的文件
        return;
      }

      // 获取文件大小信息
      const contentLength = response.headers['content-length'];
      sendMessage('info', `文件大小: ${contentLength ? `${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB` : '未知'}`);

      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (contentLength) {
          const progress = ((downloadedBytes / parseInt(contentLength)) * 100).toFixed(1);
          sendMessage('info', `下载进度: ${progress}% (${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB)`);
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        sendMessage('info', `HTTP视频下载完成: ${filePath}`);
        sendMessage('info', `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`);
        resolve(true);
      });

      fileStream.on('error', (err) => {
        sendMessage('error', `文件写入失败: ${err.message}`);
        resolve(false);
      });
    });

    request.on('error', (err) => {
      sendMessage('error', `HTTP请求失败: ${err.message}`);
      fileStream.close();
      fsPromises
        .unlink(filePath)
        .catch((unlinkErr) => {
          sendMessage('error', `删除部分下载的文件失败: ${unlinkErr.message}`);
        })
        .finally(() => {
          resolve(false);
        }); // 删除部分下载的文件
    });

    request.setTimeout(downloadTimeout * 1000, () => {
      sendMessage('error', 'HTTP请求超时');
      request.destroy();
      fileStream.close();
      fsPromises
        .unlink(filePath)
        .catch((unlinkErr) => {
          sendMessage('error', `删除部分下载的文件失败: ${unlinkErr.message}`);
        })
        .finally(() => {
          resolve(false);
        });
    });
  });
}

// 使用ffmpeg下载并转码视频
async function downloadWithFFmpeg(url, filePath, downloadTimeout = 3600) {
  // 将路径转换为mp4
  const mp4FilePath = changeMp4Extension(filePath, true);
  const mp4FilePathFormatted = mp4FilePath.replace(/\\/g, '/');

  // 创建超时控制器
  let timeoutId = null;
  let isTimedOut = false;

  // 清理函数
  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  try {
    await new Promise((resolve, reject) => {
      // 创建超时计时器
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        sendMessage('error', `ffmpeg执行超时（${downloadTimeout}秒）`);
        // 尝试杀死ffmpeg进程
        if (currentFfmpegProcess) {
          try {
            currentFfmpegProcess.kill('SIGKILL');
          } catch (error) {
            sendMessage('error', `终止超时ffmpeg进程失败, 进程ID: ${currentFfmpegProcess.pid}: ${error.message}`);
          }
        }
        reject(new Error(`下载超时: ${downloadTimeout}秒`));
      }, downloadTimeout * 1000);

      // 执行下载任务的内部函数
      const executeDownload = async () => {
        try {
          // 首先尝试转码
          try {
            await execWithTracking('ffmpeg', [
              '-y',
              '-allowed_extensions', 'ALL',
              '-i', url,
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-strict', 'experimental',
              mp4FilePathFormatted
            ]);

            if (isTimedOut) return; // 检查是否已超时

            sendMessage('info', `m3u8视频下载并转码完成: ${mp4FilePathFormatted}`);
            resolve(true);
          } catch (transcodeError) {
            if (isTimedOut) return; // 检查是否已超时

            sendMessage('error', `ffmpeg转码失败: ${transcodeError.message}`);
            sendMessage('info', '尝试直接复制流...');

            // 尝试直接复制流
            await execWithTracking('ffmpeg', [
              '-y',
              '-allowed_extensions', 'ALL',
              '-i', url,
              '-c', 'copy',
              mp4FilePathFormatted
            ]);

            if (isTimedOut) return; // 检查是否已超时

            sendMessage('info', `m3u8视频下载完成(直接复制流): ${mp4FilePathFormatted}`);
            resolve(true);
          }
        } catch (error) {
          if (isTimedOut) return; // 检查是否已超时

          // 处理复制流失败的情况
          if (error.message !== `下载超时: ${downloadTimeout}秒`) {
            sendMessage('error', `ffmpeg操作失败: ${error.message}`);
            // 如果ffmpeg命令失败，回退到HTTP下载
            sendMessage('info', 'ffmpeg不可用，回退到HTTP下载...');

            try {
              const httpResult = await downloadWithHttp(url, filePath, downloadTimeout);
              if (isTimedOut) return;
              resolve(httpResult);
            } catch (httpError) {
              reject(httpError);
            }
          } else {
            reject(error);
          }
        }
      };

      executeDownload().catch(reject);
    });

    return true;
  } catch (error) {
    // 如果是超时错误，直接返回false
    if (error.message.includes('下载超时')) {
      return false;
    }

    // 其他错误也返回false，表示下载失败
    sendMessage('error', `下载过程中发生错误: ${error.message}`);
    return false;
  } finally {
    // 确保清理资源
    cleanup();
  }
}

// 确保文件扩展名正确
function changeMp4Extension(filePath, forceMp4 = false) {
  if (forceMp4 && !filePath.endsWith('.mp4')) {
    return filePath.replace(/\.[^/.]+$/, '') + '.mp4';
  }
  return filePath;
}

// 主下载逻辑
async function downloadVideoFile(url, directoryPath, fileNameWithoutExt, downloadTimeout = 3600) {
  try {
    sendMessage('info', `开始下载视频文件: ${fileNameWithoutExt}; 源URL: ${url}`);

    // 根据URL类型选择下载方式
    if (url.includes('.m3u8')) {
      // m3u8格式通常转为mp4
      const filePath = path.join(directoryPath, fileNameWithoutExt + '.m3u8');
      const success = await downloadWithFFmpeg(url, filePath, downloadTimeout);
      return { success, filePath };
    } else {
      sendMessage('info', '普通视频文件，使用HTTP下载');
      // 从URL中提取文件扩展名或使用默认扩展名
      const fileExtension = extractFileExtensionFromUrl(url) || 'mp4';
      const filePath = path.join(directoryPath, fileNameWithoutExt + '.' + fileExtension);
      const success = await downloadWithHttp(url, filePath, downloadTimeout);
      return { success, filePath };
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
    const episodeUrl = episode.url;
    // 清理文件名中的特殊字符
    const cleanTitle = task.title.replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu, '_');
    // 创建不带后缀的文件名
    const fileNameWithoutExt = cleanTitle + '_第' + episode.episodeNumber + '集';

    // 下载视频文件 - 现在传入路径和不带后缀的文件名
    const result = await downloadVideoFile(episodeUrl, fullDownloadPath, fileNameWithoutExt, downloadTimeout);

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
    sendMessage('info', '收到终止信号，正在退出...');
    try {
      if (currentFfmpegProcess) {
        sendMessage('info', `终止FFmpeg进程, 进程ID: ${currentFfmpegProcess.pid}`);
        currentFfmpegProcess.kill('SIGTERM');
        setTimeout(() => {
          if (!currentFfmpegProcess.killed) {
            sendMessage('error', `FFmpeg进程终止超时，强制退出, 进程ID: ${currentFfmpegProcess.pid}`);
            currentFfmpegProcess.kill('SIGKILL');
          }
        }, 500);
      }
    } finally {
      process.exit(0);
    }
  }
})