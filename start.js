#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 生产环境直接在当前进程中启动 standalone Server（`server.js`）
if (process.env.NODE_ENV === 'production') {
  require('./server.js');
} else {
  const { spawn } = require('child_process'); // 添加这一行
  // 非生产环境，使用child_process启动Next.js开发服务器
  console.log('Starting Next.js development server...');

  // 启动Next.js开发服务器
  const nextProcess = spawn('npx', ['next', 'dev', '-H', '0.0.0.0'], {
    stdio: 'inherit', // 继承标准输入输出
    shell: true, // 在shell中运行命令，确保Windows兼容性
  });

  nextProcess.on('close', (code) => {
    console.log(`Next.js process exited with code ${code}`);
    process.exit(code);
  });

  nextProcess.on('error', (error) => {
    console.error('Failed to start Next.js server:', error);
    process.exit(1);
  });
}

// 改进的启动检查机制 - 动态检测端口
function getTargetUrl() {
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

// 通过登录API获取认证Cookie
function loginAndGetCookie() {
  return new Promise((resolve, _reject) => {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    const username = process.env.USERNAME;
    const password = process.env.PASSWORD;

    if (!password) {
      // 如果没有设置密码，返回空cookie
      resolve('');
      return;
    }

    const loginUrl = getTargetUrl() + '/api/login';
    const url = new URL(loginUrl);

    // 准备登录数据
    let loginData;
    if (storageType === 'localstorage') {
      loginData = { password: password };
    } else {
      loginData = { username: username, password: password };
    }

    const postData = JSON.stringify(loginData);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // 从响应头中提取Set-Cookie
            const setCookieHeader = res.headers['set-cookie'];
            if (setCookieHeader && setCookieHeader.length > 0) {
              // 解析cookie，提取auth部分
              const authCookie = setCookieHeader[0].split(';')[0];
              if (authCookie.startsWith('auth=')) {
                resolve(authCookie.substring(5)); // 去掉'auth='前缀
              } else {
                resolve('');
              }
            } else {
              resolve('');
            }
          } else {
            console.error('Login API failed:', res.statusCode, data);
            resolve('');
          }
        } catch (err) {
          console.error('Error parsing login response:', err);
          resolve('');
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error calling login API:', err);
      resolve('');
    });

    req.write(postData);
    req.end();
  });
}

const maxRetries = 30; // 最多重试30次
let retryCount = 0;
let authCookie = ''; // 存储认证cookie

console.log(`Waiting for Next.js server to start...`);

const intervalId = setInterval(() => {
  retryCount++;

  if (retryCount > maxRetries) {
    console.error(
      'Server startup check timeout, proceeding with cron jobs anyway.'
    );
    clearInterval(intervalId);
    return;
  }

  const targetUrl = getTargetUrl() + '/login';
  console.log(
    `Checking server status (${retryCount}/${maxRetries}): ${targetUrl}`
  );

  const req = http.get(targetUrl, (res) => {
    // 当返回 2xx 状态码时认为成功，然后停止轮询
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('✅ Next.js server is up and running!');
      clearInterval(intervalId);

      // 服务器启动后，执行登录获取认证cookie
      loginAndGetCookie()
        .then((cookie) => {
          authCookie = cookie;
          console.log('Authentication cookie obtained');
          startCronJobs();
        })
        .catch((err) => {
          console.error('Failed to get authentication cookie:', err);
        });
    }
  });

  req.on('error', (err) => {
    // 错误是预期的，服务器可能还没启动
    if (retryCount === maxRetries) {
      console.warn(
        '⚠️  Server check failed after maximum retries, proceeding with cron jobs.',
        err
      );
      clearInterval(intervalId);
    }
  });

  req.setTimeout(3000, () => {
    req.destroy();
  });

  req.end();
}, 5000); // 每5秒检查一次，给服务器更多启动时间

// 启动定时任务的函数
function startCronJobs() {
  console.log('🚀 Starting scheduled tasks...');

  // 等待5秒后立即执行一次 cron 任务
  setTimeout(() => {
    console.log('📅 Executing initial cron job...');
    executeCronJob();
  }, 5000);

  // 设置每小时执行一次 cron 任务
  setInterval(() => {
    console.log('📅 Executing scheduled cron job...');
    executeCronJob();
  }, 60 * 60 * 1000); // 每小时执行一次

  // 添加每分钟执行一次的缓存下载检查任务
  setInterval(() => {
    console.log('🔄 Executing cache download check...');
    executeCacheDownloadJob();
  }, 5 * 60 * 1000); // 每5分钟执行一次

  console.log('✅ All scheduled tasks started successfully!');
}

// 执行 cron 任务的函数
function executeCronJob() {
  const cronUrl = getTargetUrl() + '/api/cron';

  console.log(`Executing cron job: ${cronUrl}`);

  const url = new URL(cronUrl);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: 'GET',
    headers: authCookie
      ? {
          Cookie: `auth=${authCookie}`,
        }
      : {},
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
      } else {
        console.error('Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });

  req.end();
}

// 执行缓存下载任务的函数
function executeCacheDownloadJob() {
  const cronUrl = getTargetUrl() + '/api/download/control?action=execute-all';

  console.log(`Executing cache download job: ${cronUrl}`);

  const url = new URL(cronUrl);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: 'POST',
    headers: authCookie
      ? {
          'Content-Type': 'application/json',
          Cookie: `auth=${authCookie}`,
        }
      : {
          'Content-Type': 'application/json',
        },
  };

  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cache download job executed successfully:', data);
      } else {
        console.error('Cache download job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cache download job:', err);
  });

  req.setTimeout(120000, () => {
    // 增加超时时间到2分钟
    console.error('Cache download job timeout after 2 minutes');
    req.destroy();
  });

  req.end();
}
