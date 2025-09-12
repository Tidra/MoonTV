/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-console */

'use client';

import {
  Clock,
  HardDrive,
  Loader2,
  Play,
  Settings,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ServerCachedVideo, ServerDownloadTask } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import ConfirmDialog from '@/components/ConfirmDialog';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import Notification from '@/components/Notification';
import PageLayout from '@/components/PageLayout';
import ScheduleDownloadModal from '@/components/ScheduleDownloadModal';

export default function ServerCachePage() {
  const [serverTasks, setServerTasks] = useState<ServerDownloadTask[]>([]);
  const [serverVideos, setServerVideos] = useState<ServerCachedVideo[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'videos'>('tasks');
  const [downloadingTaskIds, setDownloadingTaskIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 定时下载弹窗状态
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ServerDownloadTask | null>(
    null
  );

  // 通知状态
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  } | null>(null);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // 获取所有数据
  const fetchData = async () => {
    try {
      const [tasksResponse, videosResponse] = await Promise.all([
        fetch('/api/download/tasks'),
        fetch('/api/download/videos'),
      ]);

      const tasksData = await tasksResponse.json();
      const videosData = await videosResponse.json();

      if (tasksData.success) {
        setServerTasks(tasksData.data);
      }

      if (videosData.success) {
        setServerVideos(videosData.data);
      }
    } catch (error) {
      console.error('获取数据失败:', error);
      setNotification({
        message: '获取数据失败，请刷新页面重试',
        type: 'error',
      });
    }
  };

  // 显示通知的全局函数
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).showNotification = (
        message: string,
        type: 'success' | 'error' | 'warning' | 'info'
      ) => {
        setNotification({ message, type });
      };
    }

    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).showNotification;
      }
    };
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // // 轮询下载状态
  // useEffect(() => {
  //   const intervalId = setInterval(async () => {
  //     try {
  //       const response = await fetch('/api/download/control?action=status');
  //       const result = await response.json();

  //       if (result.success) {
  //         setDownloadingTaskIds(result.downloadingTasks || []);
  //       }
  //     } catch (error) {
  //       console.error('获取下载状态失败:', error);
  //     }
  //   }, 3000); // 每3秒检查一次下载状态

  //   return () => clearInterval(intervalId);
  // }, []);

  // 根据当前标签页轮询数据
  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        if (activeTab === 'tasks') {
          // 只在任务标签页时获取任务数据
          const response = await fetch('/api/download/control?action=status');
          const result = await response.json();

          if (result.success) {
            setDownloadingTaskIds(result.downloadingTasks || []);
          }
        } else if (activeTab === 'videos') {
          // 只在视频标签页时获取视频数据
          const response = await fetch('/api/download/videos');
          const result = await response.json();

          if (result.success) {
            setServerVideos(result.data);
          }
        }
      } catch (error) {
        console.error('获取数据失败:', error);
      }
    }, 5000); // 每5秒检查一次数据

    return () => clearInterval(intervalId);
  }, [activeTab]);

  // 删除下载任务
  const handleDeleteTask = async (taskId: string) => {
    setConfirmDialog({
      isOpen: true,
      message: '确定要删除这个下载任务吗？',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/download/tasks?id=${taskId}`, {
            method: 'DELETE',
          });
          const result = await response.json();

          if (result.success) {
            setServerTasks(serverTasks.filter((task) => task.id !== taskId));
            // 显示成功提示
            setNotification({
              message: '定时下载任务删除成功！',
              type: 'success',
            });
          } else {
            throw new Error(result.error || '删除失败');
          }
        } catch (error) {
          console.error('删除任务失败:', error);
          setNotification({
            message: '删除任务失败，请重试',
            type: 'error',
          });
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  // 删除缓存视频
  const handleDeleteVideo = async (uniqueId: string) => {
    setConfirmDialog({
      isOpen: true,
      message: '确定要删除这个缓存视频吗？',
      onConfirm: async () => {
        try {
          const response = await fetch(
            `/api/download/videos?uniqueId=${uniqueId}`,
            {
              method: 'DELETE',
            }
          );
          const result = await response.json();

          if (result.success) {
            setServerVideos(
              serverVideos.filter((video) => video.unique_id !== uniqueId)
            );
            setNotification({
              message: '缓存视频删除成功！',
              type: 'success',
            });
          } else {
            throw new Error(result.error || '删除失败');
          }
        } catch (error) {
          console.error('删除缓存视频失败:', error);
          setNotification({
            message: '删除缓存视频失败，请重试',
            type: 'error',
          });
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  // 停止下载任务
  const handleStopTask = async (taskId: string) => {
    setConfirmDialog({
      isOpen: true,
      message: '确定要停止这个下载任务吗？',
      onConfirm: async () => {
        try {
          const response = await fetch(
            `/api/download/control?action=stop&id=${taskId}`,
            {
              method: 'POST',
            }
          );
          const result = await response.json();

          if (result.success) {
            setNotification({
              message: '下载任务已停止',
              type: 'success',
            });
            // 更新任务列表以反映停止状态
            fetchData();
          } else {
            setNotification({
              message: result.error || '停止任务失败',
              type: 'error',
            });
          }
        } catch (error) {
          console.error('停止任务失败:', error);
          setNotification({
            message: '停止任务失败，请重试',
            type: 'error',
          });
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  // 重新启动下载任务
  const handleRestartTask = async (taskId: string) => {
    try {
      // 立即执行指定任务
      const response = await fetch(
        `/api/download/control?action=execute&id=${taskId}`,
        {
          method: 'POST',
        }
      );
      const result = await response.json();

      if (result.success) {
        setNotification({
          message: '任务已开始执行',
          type: 'success',
        });
        // 更新任务列表以反映执行状态
        fetchData();
      } else {
        setNotification({
          message: result.error || '执行任务失败',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('执行任务失败:', error);
      setNotification({
        message: '执行任务失败，请重试',
        type: 'error',
      });
    }
  };

  return (
    <PageLayout activePath='/server-cache'>
      <div className='px-4 py-6 sm:px-6 lg:px-8'>
        <div className='max-w-6xl mx-auto'>
          <div className='mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-white'>
              服务器缓存视频管理
            </h1>
            <p className='mt-2 text-gray-600 dark:text-gray-400'>
              管理您的服务器定时下载任务和已缓存的视频
            </p>
          </div>

          {/* 通知组件 */}
          {notification && (
            <Notification
              message={notification.message}
              type={notification.type}
              onClose={() => setNotification(null)}
            />
          )}

          {/* 确认对话框 */}
          {confirmDialog && (
            <ConfirmDialog
              isOpen={confirmDialog.isOpen}
              message={confirmDialog.message}
              onConfirm={confirmDialog.onConfirm}
              onCancel={() => setConfirmDialog(null)}
            />
          )}

          {/* 标签页切换 */}
          <div className='mb-6 flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit'>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'tasks'
                  ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <div className='flex items-center'>
                <Clock className='w-4 h-4 mr-2' />
                定时任务 ({serverTasks.length})
              </div>
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'videos'
                  ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <div className='flex items-center'>
                <HardDrive className='w-4 h-4 mr-2' />
                缓存视频 ({serverVideos.length})
              </div>
            </button>
          </div>

          {/* 定时任务列表 */}
          {activeTab === 'tasks' && (
            <div className='bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden'>
              <div className='px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                <div className='flex justify-between items-center'>
                  <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
                    定时下载任务
                  </h2>
                  <button
                    onClick={() => {
                      setEditingTask(null);
                      setIsScheduleModalOpen(true);
                    }}
                    className='px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center'
                  >
                    <Settings className='w-4 h-4 mr-2' />
                    新建任务
                  </button>
                </div>
              </div>
              {serverTasks.length === 0 ? (
                <div className='px-6 py-12 text-center'>
                  <Clock className='w-12 h-12 mx-auto text-gray-400 dark:text-gray-500' />
                  <h3 className='mt-4 text-lg font-medium text-gray-900 dark:text-white'>
                    暂无定时任务
                  </h3>
                  <p className='mt-1 text-gray-500 dark:text-gray-400'>
                    创建定时任务来自动下载您喜欢的视频
                  </p>
                  <div className='mt-6'>
                    <button
                      onClick={() => {
                        setEditingTask(null);
                        setIsScheduleModalOpen(true);
                      }}
                      className='inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors'
                    >
                      <Settings className='w-4 h-4 mr-2' />
                      创建第一个任务
                    </button>
                  </div>
                </div>
              ) : (
                <ul className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {serverTasks.map((task) => (
                    <li
                      key={task.id}
                      className='px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700'
                    >
                      <div className='flex items-center justify-between'>
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center'>
                            <h3 className='text-base font-medium text-gray-900 dark:text-white truncate'>
                              {task.title}
                            </h3>
                            <span
                              className={`ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                task.enabled
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                              }`}
                            >
                              {task.enabled ? '启用' : '禁用'}
                            </span>
                            {downloadingTaskIds.includes(task.id) && (
                              <span className='ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'>
                                <Loader2 className='w-3 h-3 mr-1 animate-spin' />
                                缓存下载中
                              </span>
                            )}
                          </div>
                          <div className='mt-1 flex flex-col sm:flex-row sm:flex-wrap sm:mt-0 sm:space-x-4'>
                            <div className='flex items-center text-sm text-gray-500 dark:text-gray-400'>
                              <span>源: {task.source}</span>
                            </div>
                            <div className='flex items-center text-sm text-gray-500 dark:text-gray-400'>
                              <span>
                                集数: {task.startEpisode} - {task.totalEpisodes}
                              </span>
                            </div>
                            <div className='flex items-center text-sm text-gray-500 dark:text-gray-400'>
                              <span>
                                下次运行:{' '}
                                {task.nextRun
                                  ? new Date(task.nextRun).toLocaleString(
                                      'zh-CN',
                                      {
                                        year: 'numeric',
                                        month: '2-digit',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      }
                                    )
                                  : 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className='flex items-center space-x-2'>
                          <button
                            onClick={() => {
                              setEditingTask(task);
                              setIsScheduleModalOpen(true);
                            }}
                            className='p-2 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors'
                            title='编辑任务'
                          >
                            <Settings className='w-5 h-5' />
                          </button>
                          {downloadingTaskIds.includes(task.id) ? (
                            <button
                              onClick={() => handleStopTask(task.id)}
                              className='p-2 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors'
                              title='停止下载'
                            >
                              <div className='w-5 h-5 flex items-center justify-center'>
                                <div className='w-4 h-4 border-2 border-current'></div>
                              </div>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRestartTask(task.id)}
                              className='p-2 text-gray-400 hover:text-green-500 dark:text-gray-500 dark:hover:text-green-400 rounded-full hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors'
                              title='开始下载'
                            >
                              <Play className='w-5 h-5' />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className='p-2 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors'
                            title='删除任务'
                          >
                            <Trash2 className='w-5 h-5' />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 缓存视频列表 */}
          {activeTab === 'videos' && (
            <div className='bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden'>
              <div className='px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
                  已缓存视频
                </h2>
              </div>
              {serverVideos.length === 0 ? (
                <div className='px-6 py-12 text-center'>
                  <HardDrive className='w-12 h-12 mx-auto text-gray-400 dark:text-gray-500' />
                  <h3 className='mt-4 text-lg font-medium text-gray-900 dark:text-white'>
                    暂无缓存视频
                  </h3>
                  <p className='mt-1 text-gray-500 dark:text-gray-400'>
                    您的缓存视频将显示在这里
                  </p>
                </div>
              ) : (
                <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-6'>
                  {serverVideos.map((video) => (
                    <div
                      key={`${video.id}-${video.episode_number}`}
                      className='group relative bg-gray-100 dark:bg-gray-750 rounded-lg overflow-hidden aspect-[2/3] hover:shadow-lg transition-shadow'
                    >
                      {/* 视频海报图片 */}
                      {video.poster ? (
                        <div className='absolute inset-0'>
                          {!isLoading && (
                            <ImagePlaceholder aspectRatio='aspect-[2/3]' />
                          )}
                          <Image
                            src={processImageUrl(video.poster)}
                            alt={video.title}
                            fill
                            className='object-cover'
                            referrerPolicy='no-referrer'
                            onLoad={() => setIsLoading(true)}
                            // src={video.poster}
                            // alt={video.title}
                            // className="w-full h-full object-cover"
                            // onLoad={(e) => {
                            //   // 图片加载成功，确保显示
                            //   e.currentTarget.style.opacity = '1';
                            // }}
                            onError={(e) => {
                              // 如果图片加载失败，显示默认背景
                              e.currentTarget.style.display = 'none';
                              const parentElement =
                                e.currentTarget.parentElement;
                              if (parentElement) {
                                parentElement.style.background =
                                  'linear-gradient(45deg, #667eea 0%, #764ba2 100%)';
                              }
                            }}
                          />
                          <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent'></div>
                        </div>
                      ) : (
                        <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent'></div>
                      )}

                      <div className='absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <Link
                          href={`/play?source=server_cache&id=${
                            video.id
                          }&episode=${
                            video.episode_number
                          }&title=${encodeURIComponent(video.title)}&year=${
                            video.year || ''
                          }&stitle=${encodeURIComponent(video.title)}&stype=${
                            video.type_name === '电影' ? 'movie' : 'tv'
                          }`}
                          className='p-2 bg-white/90 dark:bg-gray-700/90 rounded-full text-gray-900 dark:text-white hover:bg-white dark:hover:bg-gray-600 transition-colors'
                          title='播放视频'
                        >
                          <Play className='w-6 h-6' />
                        </Link>
                      </div>
                      <div className='absolute top-2 right-2'>
                        <button
                          onClick={() => handleDeleteVideo(video.unique_id)}
                          className='p-1.5 bg-black/50 dark:bg-gray-900/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600'
                          title='删除缓存'
                        >
                          <Trash2 className='w-3 h-3' />
                        </button>
                      </div>
                      <div className='absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2'>
                        <h3
                          className='text-xs font-medium text-white truncate'
                          title={video.title}
                        >
                          {video.title}
                        </h3>
                        <p className='text-xs text-gray-300 mt-1'>
                          第{video.episode_number}集
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 定时下载任务弹窗 */}
      <ScheduleDownloadModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setEditingTask(null);
          // 重新获取数据以更新列表
          fetchData();
        }}
        initialTask={editingTask}
      />
    </PageLayout>
  );
}
