/* eslint-disable no-console */
/**
 * 日志工具类
 * 提供带时间戳的日志输出功能
 */

interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

/**
 * 生成带时间戳的日志消息
 * @param args 日志参数
 * @returns 格式化后的日志消息
 */
function formatLogMessage(...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
  return `[${timestamp}] ${message}`;
}

/**
 * 带时间戳的日志工具
 */
export const logger: Logger = {
  /**
   * 普通日志输出
   */
  log: (...args: unknown[]): void => {
    console.log(formatLogMessage(...args));
  },

  /**
   * 错误日志输出
   */
  error: (...args: unknown[]): void => {
    console.error(formatLogMessage(...args));
  },

  /**
   * 警告日志输出
   */
  warn: (...args: unknown[]): void => {
    console.warn(formatLogMessage(...args));
  },

  /**
   * 信息日志输出
   */
  info: (...args: unknown[]): void => {
    console.info(formatLogMessage(...args));
  },
};

export default logger;
