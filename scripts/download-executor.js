/* eslint-disable no-console */
import { exec } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { URL } from 'url';
import { promisify } from 'util';

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

// 发送消息的辅助函数
export function sendMessage(type, data) {
  const message = JSON.stringify({ type, data });
  // 根据消息类型选择输出流
  if (type === 'error' || type === 'download_error') {
    process.stderr.write(message + '\n');
  } else {
    process.stdout.write(message + '\n');
  }
}

// 使用HTTP下载文件的辅助函数
async function downloadWithHttp(url, filePath) {
  return new Promise((resolve, _reject) => {
    sendMessage('info', `建立HTTP连接到: ${url}`);
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const fileStream = fsPromises.createWriteStream(filePath);

    const request = client.get(url, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        sendMessage(
          'error',
          `HTTP错误: ${response.statusCode} ${response.statusMessage}`
        );
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
      sendMessage(
        'info',
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
          sendMessage(
            'info',
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
        sendMessage('info', `HTTP视频下载完成: ${filePath}`);
        sendMessage(
          'info',
          `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`
        );
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

    request.setTimeout(30000, () => {
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

// 将m3u8文件作为普通HTTP文件下载的辅助函数
async function downloadM3u8AsHttp(url, filePath) {
  return new Promise((resolve, _reject) => {
    sendMessage('info', `尝试将m3u8文件作为普通HTTP文件下载: ${url}`);
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const fileStream = fsPromises.createWriteStream(filePath);

    const request = client.get(url, (response) => {
      // 检查响应状态
      if (response.statusCode !== 200) {
        sendMessage(
          'error',
          `HTTP错误: ${response.statusCode} ${response.statusMessage}`
        );
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
      sendMessage(
        'info',
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
          sendMessage(
            'info',
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
        sendMessage('info', `m3u8文件下载完成: ${filePath}`);
        sendMessage(
          'info',
          `总下载大小: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`
        );
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

    request.setTimeout(30000, () => {
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
async function downloadWithFFmpeg(url, filePath) {
  sendMessage('info', '检测到m3u8流媒体链接，尝试使用ffmpeg下载并转码');
  const mp4FilePath = ensureCorrectExtension(filePath, true);

  // 首先尝试转码
  const transcodeCommand = `ffmpeg -y -allowed_extensions ALL -i "${url}" -c:v libx264 -c:a aac -strict experimental "${mp4FilePath.replace(
    /\\/g,
    '/'
  )}"`;
  sendMessage('info', `执行转码命令: ${transcodeCommand}`);

  try {
    const { _stdout, _stderr } = await execPromise(transcodeCommand);
    // sendMessage('info', `ffmpeg转码输出: ${stdout}`);
    // if (stderr) sendMessage('info', `ffmpeg转码错误输出: ${stderr}`);
    sendMessage(
      'info',
      `m3u8视频下载并转码完成: ${mp4FilePath.replace(/\\/g, '/')}`
    );
    return true;
  } catch (transcodeError) {
    sendMessage('error', `ffmpeg转码失败: ${transcodeError.message}`);
    // 如果转码失败，尝试直接复制流
    sendMessage('info', '尝试直接复制流...');
    const copyCommand = `ffmpeg -y -allowed_extensions ALL -i "${url}" -c copy "${mp4FilePath.replace(
      /\\/g,
      '/'
    )}"`;
    try {
      const { _stdout, _stderr } = await execPromise(copyCommand);
      // sendMessage('info', `ffmpeg复制流输出: ${stdout}`);
      // if (stderr) sendMessage('info', `ffmpeg复制流错误输出: ${stderr}`);
      sendMessage(
        'info',
        `m3u8视频下载完成(直接复制流): ${mp4FilePath.replace(/\\/g, '/')}`
      );
      return true;
    } catch (copyError) {
      sendMessage('error', `ffmpeg直接复制流失败: ${copyError.message}`);
      // 如果ffmpeg命令失败，回退到HTTP下载
      sendMessage('info', 'ffmpeg不可用，回退到HTTP下载...');
      return await downloadM3u8AsHttp(url, filePath);
    }
  }
}

// 确保文件扩展名正确
function ensureCorrectExtension(filePath, forceMp4 = false) {
  if (forceMp4 && !filePath.endsWith('.mp4')) {
    return filePath.replace(/\.[^/.]+$/, '') + '.mp4';
  }
  return filePath;
}

// 主下载逻辑
async function downloadVideoFile(url, filePath) {
  try {
    sendMessage('info', '=== 开始下载视频文件 ===');
    sendMessage('info', `源URL: ${url}`);
    sendMessage('info', `目标路径: ${filePath}`);

    // 根据URL类型选择下载方式
    if (url.includes('.m3u8')) {
      return await downloadWithFFmpeg(url, filePath);
    } else {
      sendMessage('info', '普通视频文件，使用HTTP下载');
      return await downloadWithHttp(url, filePath);
    }
  } catch (error) {
    sendMessage('error', `下载视频失败: ${error.message}`);
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
async function executeDownloadJob(
  task,
  videoDetail,
  startEpisode,
  totalEpisodes,
  cachedEpisodes,
  fullDownloadPath,
  runningFlagPath
) {
  let successCount = 0;
  let failCount = 0;

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
      // 发送下载成功的特定类型消息
      sendMessage('download_complete', {
        episodeNumber: i,
        filePath: filePath,
        taskTitle: task.title,
      });
    } else {
      failCount++;
      // 发送下载失败的特定类型消息
      sendMessage('download_error', {
        episodeNumber: i,
        taskTitle: task.title,
      });
    }
  }

  sendMessage('info', `任务完成，成功: ${successCount}, 失败: ${failCount}`);
  // 删除运行标记文件
  try {
    fs.unlinkSync(runningFlagPath);
  } catch (err) {
    // 忽略错误
  }
  return { successCount, failCount };
}

// 导出函数
export { executeDownloadJob };
