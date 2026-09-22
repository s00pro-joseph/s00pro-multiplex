'use client';

import { Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isAIRecommendFeatureDisabled } from '@/lib/ai-recommend.client';

import AIRecommendModal from './AIRecommendModal';
import SideNav from './SideNav';
import { useSite } from './SiteProvider';
import { UserMenu } from './UserMenu';

// 不需要导航栏的独立路由
const STANDALONE_ROUTES = [
  '/login',
  '/setup',
  '/register',
  '/oidc-register',
  '/warning',
];

function isStandaloneRoute(pathname: string) {
  return STANDALONE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export default function NavigationShell() {
  const pathname = usePathname();
  const { siteName } = useSite();
  const isStandalone = isStandaloneRoute(pathname);

  // AI 推荐功能
  const [showAIRecommendModal, setShowAIRecommendModal] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(true);

  useEffect(() => {
    const disabled = isAIRecommendFeatureDisabled();
    setAiEnabled(!disabled);
  }, []);

  // 独立路由不显示导航栏
  if (isStandalone) {
    return null;
  }

  return (
    <>
      {/* SideNav - 桌面端侧边栏（移动端隐藏，走下方精简头部） */}
      <SideNav
        showAIButton={aiEnabled ?? false}
        onAIButtonClick={() => setShowAIRecommendModal(true)}
      />

      {/* 移动端头部 - Logo和用户菜单 */}
      <div className='md:hidden fixed top-0 left-0 right-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-sm'>
        <div className='flex items-center justify-between h-11 px-4'>
          {/* 账号按钮 + Logo（图标替代站点名文字） */}
          <div className='flex items-center gap-3'>
            <UserMenu variant='account' />
            <a href='/' aria-label={siteName}>
              <img
                src='/logo.png'
                alt={siteName}
                className='h-8 w-8 object-contain'
              />
            </a>
          </div>

          {/* AI Button & Settings Menu */}
          <div className='flex items-center gap-1.5'>
            {aiEnabled && (
              <button
                onClick={() => setShowAIRecommendModal(true)}
                className='relative p-1.5 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 active:scale-95 transition-all duration-200 shadow-lg shadow-blue-500/30 group'
                aria-label='AI 推荐'
              >
                <Sparkles className='h-4 w-4 group-hover:scale-110 transition-transform duration-300' />
              </button>
            )}
            <UserMenu variant='settings' />
          </div>
        </div>
      </div>

      {/* AI 推荐弹窗 */}
      <AIRecommendModal
        isOpen={showAIRecommendModal}
        onClose={() => setShowAIRecommendModal(false)}
      />
    </>
  );
}
