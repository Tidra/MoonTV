import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import logger from '@/lib/logger';
import {
  executeDownloadTask,
  getAllServerDownloadTasks,
  getServerDownloadTaskById,
  saveServerDownloadTask,
  stopDownloadTask,
} from '@/lib/serverDownload';

// GET /api/download/control - 获取任务状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // 获取下载状态
    if (action === 'status') {
      // 检查所有任务的运行标记文件以确定哪些任务正在下载
      const tasks = await getAllServerDownloadTasks();
      const downloadingTasks: string[] = [];

      for (const task of tasks) {
        const runningFlagPath = path.join(
          process.cwd(),
          'data',
          `download-task-${task.id}.running`
        );
        const isRunning = fs.existsSync(runningFlagPath);

        if (isRunning) {
          downloadingTasks.push(task.id);
        }
      }

      // 返回当前正在下载的任务ID列表
      return NextResponse.json({
        success: true,
        downloadingTasks: downloadingTasks,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { success: false, error: '无效的操作参数' },
      { status: 400 }
    );
  } catch (error) {
    logger.error('获取任务状态失败:', error);
    return NextResponse.json(
      { success: false, error: '获取任务状态失败' },
      { status: 500 }
    );
  }
}

// POST /api/download/control - 任务控制
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const id = searchParams.get('id');

    // 启用指定任务
    if (action === 'enable' && id) {
      const task = await getServerDownloadTaskById(id);
      if (!task) {
        return NextResponse.json(
          { success: false, error: '任务不存在' },
          { status: 404 }
        );
      }

      task.enabled = true;
      task.updatedAt = Date.now();
      await saveServerDownloadTask(task);

      return NextResponse.json({ success: true, message: '任务已启用' });
    }

    // 停止指定任务
    if (action === 'stop' && id) {
      const task = await getServerDownloadTaskById(id);
      if (!task) {
        return NextResponse.json(
          { success: false, error: '任务不存在' },
          { status: 404 }
        );
      }

      // 停止任务进程
      const stopped = stopDownloadTask(id);

      // 删除运行标记文件
      const runningFlagPath = path.join(
        process.cwd(),
        'data',
        `download-task-${id}.running`
      );
      if (fs.existsSync(runningFlagPath)) {
        fs.unlinkSync(runningFlagPath);
      }

      if (stopped) {
        return NextResponse.json({ success: true, message: '任务已停止' });
      } else {
        return NextResponse.json({
          success: true,
          message: '任务已停止或未在运行',
        });
      }
    }

    // 启用所有任务
    if (action === 'enable-all') {
      const tasks = await getAllServerDownloadTasks();
      for (const task of tasks) {
        task.enabled = true;
        task.updatedAt = Date.now();
        await saveServerDownloadTask(task);
      }

      return NextResponse.json({ success: true, message: '所有任务已启用' });
    }

    // 立即执行指定任务
    if (action === 'execute' && id) {
      const task = await getServerDownloadTaskById(id);
      if (!task) {
        return NextResponse.json(
          { success: false, error: '任务不存在' },
          { status: 404 }
        );
      }

      // 异步执行下载任务
      executeDownloadTask(task)
        .then(() => {
          logger.info(`任务执行完成: ${task.title}`);
        })
        .catch((taskError) => {
          logger.error(`执行任务 ${task.title} 时发生错误:`, taskError);
        });

      return NextResponse.json({ success: true, message: '任务开始执行' });
    }

    // 立即执行所有任务
    if (action === 'execute-all-now') {
      const tasks = await getAllServerDownloadTasks();
      let executedCount = 0;

      for (const task of tasks) {
        if (task.enabled) {
          // 异步执行下载任务
          executeDownloadTask(task)
            .then(() => {
              logger.info(`任务执行完成: ${task.title}`);
            })
            .catch((taskError) => {
              logger.error(`执行任务 ${task.title} 时发生错误:`, taskError);
            });
          executedCount++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `已启动 ${executedCount} 个任务的执行`,
        executedCount,
      });
    }

    // 立即执行所有任务
    if (action === 'execute-all') {
      const tasks = await getAllServerDownloadTasks();
      let executedCount = 0;

      for (const task of tasks) {
        if (task.enabled && (task.nextRun || 0) <= Date.now()) {
          // 异步执行下载任务
          executeDownloadTask(task)
            .then(() => {
              logger.info(`任务执行完成: ${task.title}`);
            })
            .catch((taskError) => {
              logger.error(`执行任务 ${task.title} 时发生错误:`, taskError);
            });
          executedCount++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `已启动 ${executedCount} 个任务的执行`,
        executedCount,
      });
    }

    return NextResponse.json(
      { success: false, error: '无效的操作参数' },
      { status: 400 }
    );
  } catch (error) {
    logger.error('任务控制失败:', error);
    return NextResponse.json(
      { success: false, error: '任务控制失败' },
      { status: 500 }
    );
  }
}
