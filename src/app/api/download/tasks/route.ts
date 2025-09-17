import { NextRequest, NextResponse } from 'next/server';

import logger from '@/lib/logger';
import {
  calculateNextRun,
  deleteServerDownloadTask,
  getAllServerDownloadTasks,
  getServerDownloadTaskById,
  saveServerDownloadTask,
} from '@/lib/serverDownload';

// GET /api/download/tasks - 获取所有下载任务或根据title查询特定任务
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');

    let tasks = await getAllServerDownloadTasks();

    // 如果提供了title参数，过滤任务
    if (title) {
      tasks = tasks.filter((task) => task.title === title);
    }

    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    logger.error('获取下载任务失败:', error);
    return NextResponse.json(
      { success: false, error: '获取下载任务失败' },
      { status: 500 }
    );
  }
}

// POST /api/download/tasks - 创建新的下载任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      source,
      sourceId,
      startEpisode,
      totalEpisodes,
      downloadPath,
      cronExpression,
      downloadTimeout,
      enabled,
    } = body;

    // 验证必要字段
    if (!title || !source || !sourceId || !cronExpression) {
      return NextResponse.json(
        { success: false, error: '缺少必要字段' },
        { status: 400 }
      );
    }

    // 验证任务参数
    const startEp = startEpisode || 1;
    const totalEp = totalEpisodes || 9999;
    // 如果起始集数大于总集数，任务改为不启用
    const taskEnabled =
      startEp > totalEp ? false : enabled !== undefined ? enabled : true;

    const now = Date.now();
    const task = {
      id: Date.now().toString(),
      title,
      poster: '',
      source,
      sourceId,
      startEpisode: startEp,
      totalEpisodes: totalEp,
      downloadPath: downloadPath || '',
      cronExpression,
      downloadTimeout: downloadTimeout || 3600, // 默认1小时
      enabled: taskEnabled,
      createdAt: now,
      updatedAt: now,
      nextRun: calculateNextRun(cronExpression),
    };

    await saveServerDownloadTask(task);

    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    logger.error('创建下载任务失败:', error);
    return NextResponse.json(
      { success: false, error: '创建下载任务失败' },
      { status: 500 }
    );
  }
}

// PUT /api/download/tasks - 更新指定任务
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少任务ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      title,
      source,
      sourceId,
      startEpisode,
      totalEpisodes,
      downloadPath,
      cronExpression,
      downloadTimeout,
      enabled,
    } = body;

    const existingTask = await getServerDownloadTaskById(id);
    if (!existingTask) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    // 验证任务参数
    const startEp =
      startEpisode !== undefined ? startEpisode : existingTask.startEpisode;
    const totalEp =
      totalEpisodes !== undefined ? totalEpisodes : existingTask.totalEpisodes;
    // 如果起始集数大于总集数，任务改为不启用
    const taskEnabled =
      startEp > totalEp
        ? false
        : enabled !== undefined
        ? enabled
        : existingTask.enabled;

    const now = Date.now();
    const task = {
      id,
      title: title || existingTask.title,
      poster: existingTask.poster,
      source: source || existingTask.source,
      sourceId: sourceId || existingTask.sourceId,
      startEpisode: startEp,
      totalEpisodes: totalEp,
      downloadPath:
        downloadPath !== undefined ? downloadPath : existingTask.downloadPath,
      cronExpression: cronExpression || existingTask.cronExpression,
      downloadTimeout:
        downloadTimeout !== undefined
          ? downloadTimeout
          : existingTask.downloadTimeout,
      enabled: taskEnabled,
      createdAt: existingTask.createdAt,
      updatedAt: now,
      nextRun: cronExpression
        ? calculateNextRun(cronExpression)
        : existingTask.nextRun,
    };

    await saveServerDownloadTask(task);

    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    logger.error('更新下载任务失败:', error);
    return NextResponse.json(
      { success: false, error: '更新下载任务失败' },
      { status: 500 }
    );
  }
}

// DELETE /api/download/tasks - 删除指定任务
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少任务ID' },
        { status: 400 }
      );
    }

    await deleteServerDownloadTask(id);

    return NextResponse.json({ success: true, message: '任务删除成功' });
  } catch (error) {
    logger.error('删除下载任务失败:', error);
    return NextResponse.json(
      { success: false, error: '删除下载任务失败' },
      { status: 500 }
    );
  }
}
