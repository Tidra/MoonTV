// ... existing code ...

/**
 * 下载TS片段文件
 * @param {string[]} m3u8Urls - TS片段URL数组
 * @param {string} tempDir - 临时目录路径
 * @param {number} limitCount - 并发下载限制
 * @returns {Promise<string[]>} - 成功下载的TS文件路径数组
 */
async function downloadTsSegments(m3u8Urls, tempDir, limitCount = 2) {
  const tsFiles = [];
  const limit = pLimit(limitCount); // 限制同时视频下载个数，以防被服务器拦截

  // 创建下载任务
  const downloadTasks = m3u8Urls.map(url => {
    return limit(async () => {
      // 检查是否已停止
      if (isStop) {
        throw new Error('下载已被中止');
      }

      const targetPath = path.join(tempDir, url.split('/').pop());
      tsFiles.push(targetPath);
      // 检查文件是否已存在
      if (await fsPromises.access(targetPath).then(() => true).catch(() => false)) {
        return true;
      }

      try {
        // 使用Node.js内置的http/https模块替换got
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const writeStream = fsPromises.createWriteStream(targetPath);

        return new Promise((resolve, reject) => {
          const request = client.get(url, (response) => {
            if (response.statusCode !== 200) {
              reject(new Error(`HTTP错误: ${response.statusCode}`));
              return;
            }

            response.pipe(writeStream);

            response.on('end', () => {
              activeDownloadStreams.delete(request);
              resolve(true);
            });

            response.on('error', (error) => {
              activeDownloadStreams.delete(request);
              reject(error);
            });
          });

          // 将请求添加到活动流集合
          activeDownloadStreams.add(request);

          request.on('error', (error) => {
            activeDownloadStreams.delete(request);
            reject(error);
          });
        });
      } catch (error) {
        // 捕获所有错误并删除文件
        deleteFileIfExists(targetPath);

        if (isStop) {
          sendMessage('info', `TS片段下载被中止: ${url}`);
        } else {
          sendMessage('error', `TS片段下载失败: ${url}, 错误: ${error.message}`);
        }
        throw error;
      }
    });
  });

  // ... existing code ...
}

// ... existing code ...