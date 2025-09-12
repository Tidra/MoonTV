import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ConfirmDialogProps {
  message: string;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  message,
  isOpen,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
    }
  }, [isOpen]);

  if (!isOpen && !isAnimating) return null;

  const handleConfirm = () => {
    setIsAnimating(false);
    setTimeout(() => {
      onConfirm();
    }, 300);
  };

  const handleCancel = () => {
    setIsAnimating(false);
    setTimeout(() => {
      onCancel();
    }, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-[1002] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm transform transition-all duration-300 ${
          isAnimating ? 'scale-100' : 'scale-95'
        }`}
      >
        <div className='p-6'>
          <div className='flex justify-between items-center mb-4'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>
              确认操作
            </h3>
            <button
              onClick={handleCancel}
              className='p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
              aria-label='关闭'
            >
              <X className='w-5 h-5 text-gray-500 dark:text-gray-400' />
            </button>
          </div>

          <p className='text-gray-700 dark:text-gray-300 mb-6'>{message}</p>

          <div className='flex justify-end space-x-3'>
            <button
              onClick={handleCancel}
              className='px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className='px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors'
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
