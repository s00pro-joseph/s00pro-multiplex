/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { Cat, Clover, Film, PlaySquare, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import CategoryCard from '@/components/CategoryCard';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import { TelegramWelcomeModal } from '@/components/TelegramWelcomeModal';

// 首页类别卡：海报预留 + 状态仪表盘（占位数据，后续接入真实源状态）
const CATEGORIES = [
  {
    title: '电影',
    href: '/douban?type=movie',
    icon: <Film className='h-16 w-16 sm:h-20 sm:w-20' />,
    accent: 'from-red-500 to-pink-600',
  },
  {
    title: '剧集',
    href: '/douban?type=tv',
    icon: <Tv className='h-16 w-16 sm:h-20 sm:w-20' />,
    accent: 'from-blue-600 to-indigo-600',
  },
  {
    title: '短剧',
    href: '/shortdrama',
    icon: <PlaySquare className='h-16 w-16 sm:h-20 sm:w-20' />,
    accent: 'from-purple-500 to-violet-600',
  },
  {
    title: '动漫',
    href: '/douban?type=anime',
    icon: <Cat className='h-16 w-16 sm:h-20 sm:w-20' />,
    accent: 'from-pink-500 to-rose-500',
  },
  {
    title: '综艺',
    href: '/douban?type=show',
    icon: <Clover className='h-16 w-16 sm:h-20 sm:w-20' />,
    accent: 'from-orange-500 to-amber-500',
  },
];

function HomeClient() {
  const { announcement } = useSite();
  const [username, setUsername] = useState('');
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      setUsername(authInfo.username);
    }

    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(
          Boolean(!hasSeenAnnouncement && announcement)
        );
      }
    }
  }, [announcement]);

  const handleCloseAnnouncement = (text: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', text);
  };

  return (
    <PageLayout>
      {/* Telegram 新用户欢迎弹窗 */}
      <TelegramWelcomeModal />

      <div className='overflow-visible pb-8'>
        {/* 类别卡（5列自适应） */}
        <section className='mb-8'>
          <div className='grid grid-cols-5 gap-4 sm:gap-6'>
            {CATEGORIES.map((cat) => (
              <CategoryCard
                key={cat.title}
                title={cat.title}
                href={cat.href}
                icon={cat.icon}
                accent={cat.accent}
              />
            ))}
          </div>
        </section>
      </div>

      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onTouchMove={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchEnd={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          style={{
            touchAction: 'none',
          }}
        >
          <div
            className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'
            onTouchMove={(e) => {
              e.stopPropagation();
            }}
            style={{
              touchAction: 'auto',
            }}
          >
            <div className='mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                提示
              </h3>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-linear-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-green-700 hover:to-green-800 dark:from-green-600 dark:to-green-700 dark:hover:from-green-700 dark:hover:to-green-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default HomeClient;
