'use client';

import { FastLink } from './FastLink';

export interface CategoryStat {
  /** 0-100 进度；null = 占位（微光 + --） */
  availability: number | null;
  /** 速度文案（如 12.5 MB/s）；缺省显示 -- */
  speedText?: string;
  /** 0-100 进度；null = 占位 */
  speed: number | null;
  /** 资源数量文案；缺省显示 -- */
  countText?: string;
  /** 0-100 进度；null = 占位 */
  count: number | null;
}

interface CategoryCardProps {
  title: string;
  href: string;
  icon: React.ReactNode;
  accent: string;
  stats?: CategoryStat;
}

function StatBar({
  label,
  value,
  display,
  barClass,
}: {
  label: string;
  value: number | null;
  display: string;
  barClass: string;
}) {
  return (
    <div>
      <div className='mb-1 flex items-center justify-between text-[11px]'>
        <span className='text-gray-500 dark:text-gray-400'>{label}</span>
        <span className='font-semibold text-gray-700 dark:text-gray-200'>
          {display}
        </span>
      </div>
      <div className='h-1.5 overflow-hidden rounded-full bg-gray-200/80 dark:bg-gray-700/60'>
        {value === null ? (
          <div className='h-full w-full animate-pulse rounded-full bg-gray-300 dark:bg-gray-600' />
        ) : (
          <div
            className={`h-full rounded-full bg-linear-to-r ${barClass} transition-all duration-500`}
            style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function CategoryCard({
  title,
  href,
  icon,
  accent,
  stats,
}: CategoryCardProps) {
  const availability = stats?.availability ?? null;
  const speed = stats?.speed ?? null;
  const count = stats?.count ?? null;

  return (
    <FastLink
      href={href}
      useTransitionNav
      className='group flex aspect-[3/4.2] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-gray-700/60 dark:bg-gray-900'
      aria-label={title}
    >
      {/* 海报区（上 2/3，图片预留：之后补上） */}
      <div
        className={`relative flex-[2] overflow-hidden bg-linear-to-br ${accent}`}
      >
        <div className='absolute inset-0 flex items-center justify-center text-white/70 transition-transform duration-300 group-hover:scale-110'>
          {icon}
        </div>
        <div className='absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/40 to-transparent' />
      </div>

      {/* Dashboard（下 1/3） */}
      <div className='flex flex-1 flex-col justify-center gap-1.5 px-3 py-2'>
        <div className='truncate text-sm font-bold text-gray-900 dark:text-white'>
          {title}
        </div>
        <StatBar
          label='可用率'
          value={availability}
          display={availability === null ? '--' : `${availability}%`}
          barClass='from-green-500 to-emerald-500'
        />
        <StatBar
          label='速度'
          value={speed}
          display={stats?.speedText ?? '--'}
          barClass='from-blue-500 to-cyan-500'
        />
        <StatBar
          label='数量'
          value={count}
          display={stats?.countText ?? '--'}
          barClass='from-purple-500 to-pink-500'
        />
      </div>
    </FastLink>
  );
}
