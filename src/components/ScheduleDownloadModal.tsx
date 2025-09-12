/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-console */

import { Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ServerDownloadTask } from '@/lib/types';

interface ScheduleDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  source?: string;
  sourceId?: string;
  title?: string;
  episodesCount?: number;
  isMovie?: boolean;
  returnUrl?: string;
  initialTask?: ServerDownloadTask | null; // 用于编辑模式的初始任务数据
}

export default function ScheduleDownloadModal({
  isOpen,
  onClose,
  source,
  sourceId,
  title,
  episodesCount,
  isMovie,
  initialTask,
}: ScheduleDownloadModalProps) {
  const [formData, setFormData] = useState({
    title: title || '',
    source: source || '',
    sourceId: sourceId || '',
    startEpisode: 1,
    totalEpisodes: 1,
    downloadPath: '',
    cronExpression: '0 2 * * *', // 每天凌晨2点
    enabled: true,
  });
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  // 初始化表单数据
  useEffect(() => {
    if (isOpen) {
      // 如果提供了初始任务数据（编辑模式）
      if (initialTask) {
        setTaskId(initialTask.id);
        setFormData({
          title: initialTask.title || '',
          source: initialTask.source || '',
          sourceId: initialTask.sourceId || '',
          startEpisode: initialTask.startEpisode || 1,
          totalEpisodes: initialTask.totalEpisodes || 1,
          downloadPath: initialTask.downloadPath || '',
          cronExpression: initialTask.cronExpression || '0 2 * * *',
          enabled:
            initialTask.enabled !== undefined ? initialTask.enabled : true,
        });
      }
      // 否则检查是否已存在相同视频的定时任务
      else if (title) {
        // 调用服务器端API检查是否存在下载任务
        fetch(`/api/download/tasks?title=${encodeURIComponent(title)}`)
          .then((response) => response.json())
          .then((result) => {
            if (result.success && result.data && result.data.length > 0) {
              const existingTask = result.data[0];
              // 如果已存在，加载现有任务数据
              setTaskId(existingTask.id);
              setFormData({
                title: existingTask.title || '',
                source: existingTask.source || '',
                sourceId: existingTask.sourceId || '',
                startEpisode: existingTask.startEpisode || 1,
                totalEpisodes: existingTask.totalEpisodes || 1,
                downloadPath: existingTask.downloadPath || '',
                cronExpression: existingTask.cronExpression || '0 2 * * *',
                enabled:
                  existingTask.enabled !== undefined
                    ? existingTask.enabled
                    : true,
              });
            } else {
              // 设置默认下载路径，为每个剧集创建独立文件夹（使用相对路径）
              const sanitizedTitle = (title || '').replace(
                /[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu,
                '_'
              ); // 清理文件名中的非法字符
              const finalDownloadPath = title ? sanitizedTitle : ''; // 只使用视频标题作为相对路径

              setFormData((prev) => ({
                ...prev,
                source: source || '',
                sourceId: sourceId || '',
                title: title || '',
                startEpisode: 1,
                totalEpisodes: isMovie
                  ? 1
                  : episodesCount && episodesCount > 1
                  ? episodesCount
                  : 9999,
                downloadPath: finalDownloadPath,
              }));
              // 重置任务ID，确保新建任务不会覆盖之前的编辑任务
              setTaskId(null);
            }
          });
      }
      // 完全新建任务
      else {
        // 设置默认下载路径（使用相对路径）
        const sanitizedTitle = (title || '').replace(
          /[^\p{L}\p{N}\p{P}\p{S}\p{Z}]/gu,
          '_'
        ); // 清理文件名中的非法字符
        const finalDownloadPath = title ? sanitizedTitle : ''; // 只使用视频标题作为相对路径

        setFormData((prev) => ({
          ...prev,
          source: source || '',
          sourceId: sourceId || '',
          title: title || '',
          startEpisode: 1,
          totalEpisodes: isMovie
            ? 1
            : episodesCount && episodesCount > 1
            ? episodesCount
            : 9999,
          downloadPath: finalDownloadPath,
        }));
        // 重置任务ID，确保新建任务不会覆盖之前的编辑任务
        setTaskId(null);
      }
    }
  }, [isOpen, source, sourceId, title, episodesCount, isMovie, initialTask]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response;

      if (taskId) {
        // 更新现有任务
        const taskData = {
          title: formData.title,
          source: formData.source,
          sourceId: formData.sourceId,
          startEpisode: Number(formData.startEpisode),
          totalEpisodes: Number(formData.totalEpisodes),
          downloadPath: formData.downloadPath,
          cronExpression: formData.cronExpression,
          enabled: formData.enabled,
        };

        response = await fetch(`/api/download/tasks?id=${taskId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(taskData),
        });
      } else {
        // 创建新任务
        const taskData = {
          title: formData.title,
          source: formData.source,
          sourceId: formData.sourceId,
          startEpisode: Number(formData.startEpisode),
          totalEpisodes: Number(formData.totalEpisodes),
          downloadPath: formData.downloadPath,
          cronExpression: formData.cronExpression,
          enabled: formData.enabled,
        };

        response = await fetch('/api/download/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(taskData),
        });
      }

      const result = await response.json();

      if (result.success) {
        // 显示成功提示
        if (typeof window !== 'undefined' && (window as any).showNotification) {
          (window as any).showNotification(
            taskId ? '定时下载任务更新成功！' : '定时下载任务创建成功！',
            'success'
          );
        }

        // 关闭弹窗
        onClose();
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (error) {
      console.error('保存任务失败:', error);
      // 显示错误提示
      if (typeof window !== 'undefined' && (window as any).showNotification) {
        (window as any).showNotification('保存任务失败，请重试', 'error');
      } else {
        alert('保存任务失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm'>
      <div className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto'>
        <div className='sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between rounded-t-xl'>
          <h2 className='text-xl font-bold text-gray-900 dark:text-white'>
            {taskId ? '编辑定时下载任务' : '新建定时下载任务'}
          </h2>
          <button
            onClick={onClose}
            className='p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
            aria-label='关闭'
          >
            <X className='w-6 h-6 text-gray-500 dark:text-gray-400' />
          </button>
        </div>

        <div className='p-6'>
          <form onSubmit={handleSubmit} className='space-y-6'>
            <div>
              <label
                htmlFor='title'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
              >
                视频标题
              </label>
              <input
                type='text'
                id='title'
                name='title'
                value={formData.title}
                onChange={handleChange}
                required
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                placeholder='请输入视频标题'
              />
            </div>

            <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
              <div>
                <label
                  htmlFor='source'
                  className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
                >
                  视频源
                </label>
                <input
                  type='text'
                  id='source'
                  name='source'
                  value={formData.source}
                  onChange={handleChange}
                  required
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                  placeholder='如: douban'
                />
              </div>

              <div>
                <label
                  htmlFor='sourceId'
                  className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
                >
                  视频ID
                </label>
                <input
                  type='text'
                  id='sourceId'
                  name='sourceId'
                  value={formData.sourceId}
                  onChange={handleChange}
                  required
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                  placeholder='视频的唯一标识符'
                />
              </div>
            </div>

            <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
              <div>
                <label
                  htmlFor='startEpisode'
                  className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
                >
                  起始集数
                </label>
                <input
                  type='number'
                  id='startEpisode'
                  name='startEpisode'
                  value={formData.startEpisode}
                  onChange={handleChange}
                  min='1'
                  required
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                />
              </div>

              <div>
                <label
                  htmlFor='totalEpisodes'
                  className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
                >
                  总集数
                </label>
                <input
                  type='number'
                  id='totalEpisodes'
                  name='totalEpisodes'
                  value={formData.totalEpisodes}
                  onChange={handleChange}
                  min='1'
                  required
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                />
              </div>
            </div>

            <div>
              <label
                htmlFor='downloadPath'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
              >
                下载路径
              </label>
              <input
                type='text'
                id='downloadPath'
                name='downloadPath'
                value={formData.downloadPath}
                onChange={handleChange}
                required
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                placeholder='如: /downloads/tvshows'
              />
            </div>

            <div>
              <label
                htmlFor='cronExpression'
                className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
              >
                定时表达式
              </label>
              <input
                type='text'
                id='cronExpression'
                name='cronExpression'
                value={formData.cronExpression}
                onChange={handleChange}
                required
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 text-gray-900'
                placeholder='如: 0 2 * * * (每天凌晨2点)'
              />
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                Cron表达式，用于设置定时任务的执行时间
              </p>
            </div>

            <div className='flex items-center'>
              <input
                type='checkbox'
                id='enabled'
                name='enabled'
                checked={formData.enabled}
                onChange={handleChange}
                className='h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded'
              />
              <label
                htmlFor='enabled'
                className='ml-2 block text-sm text-gray-700 dark:text-gray-300'
              >
                启用任务
              </label>
            </div>

            <div className='flex justify-end space-x-3 pt-4'>
              <button
                type='button'
                onClick={onClose}
                className='px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
              >
                取消
              </button>
              <button
                type='submit'
                disabled={loading}
                className='px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center disabled:opacity-50'
              >
                <Save className='w-4 h-4 mr-2' />
                {loading ? '保存中...' : taskId ? '更新任务' : '保存任务'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
