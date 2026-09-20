/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useClearFavoritesMutation } from '@/hooks/useFavoritesMutations';
import { favoritesQueryOptions } from '@/hooks/useFavoritesQuery';
import { playRecordsQueryOptions } from '@/hooks/usePlayRecordsQuery';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import VideoCard from '@/components/VideoCard';

type FavoriteItem = {
  id: string;
  source: string;
  title: string;
  poster: string;
  episodes: number;
  source_name: string;
  currentEpisode?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  type?: string;
  releaseDate?: string;
  remarks?: string;
};

type FavoriteFilter =
  | 'all'
  | 'movie'
  | 'tv'
  | 'anime'
  | 'shortdrama'
  | 'live'
  | 'variety';

export default function FavoritesPanel() {
  const [favoriteFilter, setFavoriteFilter] =
    useState<FavoriteFilter>('all');
  const [favoriteSortBy, setFavoriteSortBy] = useState<
    'recent' | 'title' | 'rating'
  >('recent');
  const [showClearFavoritesDialog, setShowClearFavoritesDialog] =
    useState(false);
  const [requireClearConfirmation, setRequireClearConfirmation] =
    useState(false);

  // 今天的日期（上映日期计算用，Asia/Shanghai）
  const today = useMemo(() => {
    const dateStr = new Date().toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return dateStr.replace(/\//g, '-');
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('requireClearConfirmation');
      if (saved !== null) {
        setRequireClearConfirmation(saved === 'true');
      }
    }
  }, []);

  const { data: allFavorites = {} } = useQuery(favoritesQueryOptions);
  const { data: allPlayRecords = {} } = useQuery(playRecordsQueryOptions);

  const favoriteItems = useMemo(() => {
    return Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
          origin: fav?.origin,
          type: fav?.type,
          releaseDate: fav?.releaseDate,
          remarks: fav?.remarks,
        } as FavoriteItem;
      });
  }, [allFavorites, allPlayRecords]);

  const favoriteStats = useMemo(() => {
    if (favoriteItems.length === 0) return null;

    return {
      total: favoriteItems.length,
      movie: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'movie';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes === 1;
      }).length,
      tv: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'tv';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes > 1;
      }).length,
      anime: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'anime';
        return item.source === 'bangumi';
      }).length,
      shortdrama: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'shortdrama';
        return item.source === 'shortdrama' || item.source_name === '短剧';
      }).length,
      live: favoriteItems.filter((item) => item.origin === 'live').length,
      variety: favoriteItems.filter((item) => {
        if (item.type) return item.type === 'variety';
        return false;
      }).length,
    };
  }, [favoriteItems]);

  const clearFavoritesMutation = useClearFavoritesMutation();

  const filteredItems = useMemo(() => {
    let filtered = favoriteItems;
    if (favoriteFilter === 'movie') {
      filtered = favoriteItems.filter((item) => {
        if (item.type) return item.type === 'movie';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes === 1;
      });
    } else if (favoriteFilter === 'tv') {
      filtered = favoriteItems.filter((item) => {
        if (item.type) return item.type === 'tv';
        if (item.source === 'shortdrama' || item.source_name === '短剧')
          return false;
        if (item.source === 'bangumi') return false;
        if (item.origin === 'live') return false;
        return item.episodes > 1;
      });
    } else if (favoriteFilter === 'anime') {
      filtered = favoriteItems.filter((item) => {
        if (item.type) return item.type === 'anime';
        return item.source === 'bangumi';
      });
    } else if (favoriteFilter === 'shortdrama') {
      filtered = favoriteItems.filter((item) => {
        if (item.type) return item.type === 'shortdrama';
        return item.source === 'shortdrama' || item.source_name === '短剧';
      });
    } else if (favoriteFilter === 'live') {
      filtered = favoriteItems.filter((item) => item.origin === 'live');
    } else if (favoriteFilter === 'variety') {
      filtered = favoriteItems.filter((item) => {
        if (item.type) return item.type === 'variety';
        return false;
      });
    }

    if (favoriteSortBy === 'title') {
      filtered = [...filtered].sort((a, b) =>
        a.title.localeCompare(b.title, 'zh-CN')
      );
    }

    return filtered;
  }, [favoriteItems, favoriteFilter, favoriteSortBy]);

  return (
    <section className='mb-8'>
      <div className='mb-6 flex items-center justify-between'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          我的收藏
        </h2>
        {favoriteItems.length > 0 && (
          <button
            className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-white hover:bg-red-600 dark:text-red-400 dark:hover:text-white dark:hover:bg-red-500 border border-red-300 dark:border-red-700 hover:border-red-600 dark:hover:border-red-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
            onClick={() => {
              if (requireClearConfirmation) {
                setShowClearFavoritesDialog(true);
              } else {
                clearFavoritesMutation.mutate();
              }
            }}
          >
            <Trash2 className='w-4 h-4' />
            <span>清空收藏</span>
          </button>
        )}
      </div>

      {/* 统计信息 */}
      {favoriteStats && (
        <div className='mb-4 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400'>
          <span className='px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full'>
            共{' '}
            <strong className='text-gray-900 dark:text-gray-100'>
              {favoriteStats.total}
            </strong>{' '}
            项
          </span>
          {favoriteStats.movie > 0 && (
            <span className='px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-full'>
              电影 {favoriteStats.movie}
            </span>
          )}
          {favoriteStats.tv > 0 && (
            <span className='px-3 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-full'>
              剧集 {favoriteStats.tv}
            </span>
          )}
          {favoriteStats.anime > 0 && (
            <span className='px-3 py-1 bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300 rounded-full'>
              动漫 {favoriteStats.anime}
            </span>
          )}
          {favoriteStats.shortdrama > 0 && (
            <span className='px-3 py-1 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-full'>
              短剧 {favoriteStats.shortdrama}
            </span>
          )}
          {favoriteStats.live > 0 && (
            <span className='px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-full'>
              直播 {favoriteStats.live}
            </span>
          )}
          {favoriteStats.variety > 0 && (
            <span className='px-3 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-full'>
              综艺 {favoriteStats.variety}
            </span>
          )}
        </div>
      )}

      {/* 筛选标签（统一胶囊设计） */}
      {favoriteItems.length > 0 && (
        <div className='mb-4 flex justify-start'>
          <CapsuleSwitch
            options={[
              { label: '全部', value: 'all', icon: '📚' },
              { label: '电影', value: 'movie', icon: '🎬' },
              { label: '剧集', value: 'tv', icon: '📺' },
              { label: '动漫', value: 'anime', icon: '🎌' },
              { label: '短剧', value: 'shortdrama', icon: '🎭' },
              { label: '直播', value: 'live', icon: '📡' },
              { label: '综艺', value: 'variety', icon: '🎪' },
            ]}
            active={favoriteFilter}
            onChange={(value) => setFavoriteFilter(value as FavoriteFilter)}
          />
        </div>
      )}

      {/* 排序选项 */}
      {favoriteItems.length > 0 && (
        <div className='mb-4 flex items-center gap-2 text-sm'>
          <span className='text-gray-600 dark:text-gray-400'>排序：</span>
          <div className='flex gap-2'>
            {[
              { key: 'recent' as const, label: '最近添加' },
              { key: 'title' as const, label: '标题 A-Z' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFavoriteSortBy(key)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  favoriteSortBy === key
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
        {filteredItems.map((item) => {
          let calculatedRemarks = item.remarks;

          if (item.releaseDate) {
            const releaseDate = item.releaseDate;

            if (releaseDate < today) {
              const releaseParts = releaseDate.split('-').map(Number);
              const todayParts = today.split('-').map(Number);
              const releaseMs = new Date(
                releaseParts[0],
                releaseParts[1] - 1,
                releaseParts[2]
              ).getTime();
              const todayMs = new Date(
                todayParts[0],
                todayParts[1] - 1,
                todayParts[2]
              ).getTime();
              const daysAgo = Math.floor(
                (todayMs - releaseMs) / (1000 * 60 * 60 * 24)
              );
              calculatedRemarks = `已上映${daysAgo}天`;
            } else if (releaseDate === today) {
              calculatedRemarks = '今日上映';
            } else {
              const releaseParts = releaseDate.split('-').map(Number);
              const todayParts = today.split('-').map(Number);
              const releaseMs = new Date(
                releaseParts[0],
                releaseParts[1] - 1,
                releaseParts[2]
              ).getTime();
              const todayMs = new Date(
                todayParts[0],
                todayParts[1] - 1,
                todayParts[2]
              ).getTime();
              const daysUntil = Math.ceil(
                (releaseMs - todayMs) / (1000 * 60 * 60 * 24)
              );
              calculatedRemarks = `${daysUntil}天后上映`;
            }
          }

          return (
            <div key={item.id + item.source} className='w-full'>
              <VideoCard
                query={item.search_title}
                {...item}
                from='favorite'
                remarks={calculatedRemarks}
              />
            </div>
          );
        })}
        {favoriteItems.length === 0 && (
          <div className='col-span-full flex flex-col items-center justify-center py-16 px-4'>
            {/* SVG 插画 - 空收藏夹 */}
            <div className='mb-6 relative'>
              <div className='absolute inset-0 bg-linear-to-r from-pink-300 to-purple-300 dark:from-pink-600 dark:to-purple-600 opacity-20 blur-3xl rounded-full animate-pulse'></div>
              <svg className='w-32 h-32 relative z-10' viewBox='0 0 200 200' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M100 170C100 170 30 130 30 80C30 50 50 30 70 30C85 30 95 40 100 50C105 40 115 30 130 30C150 30 170 50 170 80C170 130 100 170 100 170Z'
                  className='fill-gray-300 dark:fill-gray-600 stroke-gray-400 dark:stroke-gray-500 transition-colors duration-300'
                  strokeWidth='3'
                />
                <path d='M100 170C100 170 30 130 30 80C30 50 50 30 70 30C85 30 95 40 100 50C105 40 115 30 130 30C150 30 170 50 170 80C170 130 100 170 100 170Z'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeDasharray='5,5'
                  className='text-gray-400 dark:text-gray-500'
                />
              </svg>
            </div>

            <h3 className='text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2'>
              收藏夹空空如也
            </h3>
            <p className='text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs'>
              快去发现喜欢的影视作品，点击 ❤️ 添加到收藏吧！
            </p>
          </div>
        )}
      </div>

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={showClearFavoritesDialog}
        title='确认清空收藏'
        message={`确定要清空所有收藏吗？\n\n这将删除 ${favoriteItems.length} 项收藏，此操作无法撤销。`}
        confirmText='确认清空'
        cancelText='取消'
        variant='danger'
        onConfirm={() => {
          clearFavoritesMutation.mutate();
          setShowClearFavoritesDialog(false);
        }}
        onCancel={() => setShowClearFavoritesDialog(false)}
      />
    </section>
  );
}
