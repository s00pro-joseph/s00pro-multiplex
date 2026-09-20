/* eslint-disable react-hooks/exhaustive-deps */

import React, { ReactNode, useEffect, useRef, useState } from 'react';

interface CapsuleOption {
  label: string;
  value: string;
  icon?: ReactNode;
  count?: number;
}

interface CapsuleSwitchProps {
  options: CapsuleOption[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
  /** horizontal = 胶囊条（默认），vertical = 纵向胶囊组（侧边栏） */
  orientation?: 'horizontal' | 'vertical';
  /** green = 绿色高亮（统一激活色，默认），default = 蓝紫渐变（旧款） */
  tone?: 'green' | 'default';
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
  orientation = 'horizontal',
  tone = 'green',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);
  const isVertical = orientation === 'vertical';
  const isGreen = tone === 'green';

  // 更新指示器位置；无匹配项时隐藏指示器（避免旧高亮残留）
  const updateIndicatorPosition = () => {
    if (activeIndex < 0) {
      setIndicatorStyle((prev) =>
        prev.width === 0 && prev.height === 0
          ? prev
          : { left: 0, top: 0, width: 0, height: 0 }
      );
      return;
    }
    if (
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const button = buttonRefs.current[activeIndex];
      const container = containerRef.current;
      if (button && container) {
        const buttonRect = button.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (buttonRect.width > 0 && buttonRect.height > 0) {
          setIndicatorStyle({
            left: buttonRect.left - containerRect.left,
            top: buttonRect.top - containerRect.top,
            width: buttonRect.width,
            height: buttonRect.height,
          });
        }
      }
    }
  };

  // 组件挂载时立即计算初始位置
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // 监听选中项变化
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, [activeIndex]);

  return (
    <div
      className={
        isVertical ? 'w-full overflow-visible' : 'max-w-full overflow-x-auto scrollbar-hide'
      }
    >
      <div
        ref={containerRef}
        className={`relative ${
          isVertical
            ? 'flex w-full flex-col items-stretch gap-0.5 rounded-2xl p-1 shadow-[inset_0_2px_6px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)]'
            : 'inline-flex rounded-full p-1 shadow-lg'
        } bg-linear-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 ${
          className || ''
        }`}
      >
        {/* 滑动的背景指示器 */}
        {(isVertical ? indicatorStyle.height > 0 : indicatorStyle.width > 0) && (
          <div
            className={`absolute shadow-xl transition-all duration-300 ease-out ${
              isVertical
                ? 'left-1 right-1 rounded-xl'
                : 'top-1 bottom-1 rounded-full'
            } ${
              isGreen
                ? 'bg-linear-to-r from-green-500 via-green-600 to-emerald-500 shadow-lg shadow-green-500/40'
                : 'bg-linear-to-r from-blue-500 via-purple-500 to-pink-500 dark:from-blue-600 dark:via-purple-600 dark:to-pink-600'
            }`}
            style={
              isVertical
                ? {
                    top: `${indicatorStyle.top}px`,
                    height: `${indicatorStyle.height}px`,
                    background:
                      'linear-gradient(90deg, #22c55e 0%, #167ba3ff 55%, #10b981 100%)',
                    boxShadow:
                      '0 8px 20px rgba(34, 197, 94, 0.4), inset 0 1px 0 rgba(255,255,255,0.35)',
                  }
                : {
                    left: `${indicatorStyle.left}px`,
                    width: `${indicatorStyle.width}px`,
                    boxShadow: isGreen
                      ? '0 0 20px rgba(34, 197, 94, 0.5), 0 0 40px rgba(16, 185, 129, 0.3)'
                      : '0 0 20px rgba(147, 51, 234, 0.5), 0 0 40px rgba(59, 130, 246, 0.3)',
                  }
            }
          >
            {/* 高光涂层（呼应紫色胶囊的光泽质感） */}
            <div
              className={`pointer-events-none absolute inset-0 bg-linear-to-b from-white/25 via-white/5 to-transparent ${
                isVertical ? 'rounded-xl' : 'rounded-full'
              }`}
            />
          </div>
        )}

        {options.map((opt, index) => {
          const isActive = active === opt.value;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={() => onChange(opt.value)}
              title={isVertical ? opt.label : undefined}
              className={`relative z-10 inline-flex items-center whitespace-nowrap font-bold transition-all duration-200 cursor-pointer ${
                isVertical
                  ? `w-full rounded-xl py-2.5 text-sm ${
                      opt.label
                        ? 'justify-center pl-[36px] pr-[36px]'
                        : 'justify-center px-3'
                    } ${
                      isActive
                        ? 'text-white dark:text-white drop-shadow-lg'
                        : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                    }`
                  : `justify-center px-3 py-0.5 text-xs sm:px-4 sm:py-1.5 sm:text-sm rounded-full ${
                      isActive
                        ? 'text-white dark:text-white drop-shadow-lg'
                        : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                    }`
              }`}
            >
              {opt.icon && (
                <span
                  className={
                    isVertical && opt.label
                      ? 'absolute left-[36px] shrink-0'
                      : 'shrink-0'
                  }
                >
                  {opt.icon}
                </span>
              )}
              {(!isVertical || opt.label) && (
                <span
                  className={
                    isVertical ? 'w-full truncate text-right' : 'truncate'
                  }
                >
                  {opt.label}
                </span>
              )}
              {opt.count !== undefined && opt.count > 0 && (
                <span
                  className={`ml-1.5 text-xs ${
                    isActive
                      ? 'text-white/80'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  ({opt.count})
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CapsuleSwitch;
