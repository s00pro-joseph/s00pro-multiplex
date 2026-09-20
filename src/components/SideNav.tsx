'use client';

import { queryOptions,useQuery } from '@tanstack/react-query';
import {
  Cat,
  Clover,
  Film,
  FolderOpen,
  Globe,
  Heart,
  History,
  Home,
  PlaySquare,
  Radio,
  Search,
  Sparkles,
  Star,
  Tv,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo,useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import CapsuleSwitch from './CapsuleSwitch';
import { useSite } from './SiteProvider';
import { UserMenu } from './UserMenu';

interface SideNavItem {
  icon: any;
  label: string;
  href: string;
}

interface SideNavProps {
  showAIButton?: boolean;
  onAIButtonClick?: () => void;
}

const EXPANDED_WIDTH = 200;
const COLLAPSED_WIDTH = 75;
const COLLAPSE_KEY = 's00protv_sidenav_collapsed';

const userEmbyConfigOptions = () =>
  queryOptions({
    queryKey: ['user', 'emby-config'],
    queryFn: async () => {
      const res = await fetch('/api/user/emby-config');
      if (!res.ok) return null;
      const data = await res.json();
      return data.config;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

const publicSourcesOptions = () =>
  queryOptions({
    queryKey: ['emby', 'public-sources'],
    queryFn: async () => {
      const res = await fetch('/api/emby/public-sources');
      if (!res.ok) return { sources: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

const BASE_ITEMS: SideNavItem[] = [
  { icon: Home, label: '首页', href: '/' },
  { icon: Film, label: '电影', href: '/douban?type=movie' },
  { icon: Tv, label: '剧集', href: '/douban?type=tv' },
  { icon: PlaySquare, label: '短剧', href: '/shortdrama' },
  { icon: Cat, label: '动漫', href: '/douban?type=anime' },
  { icon: Clover, label: '综艺', href: '/douban?type=show' },
];

const TOOL_ITEMS: SideNavItem[] = [
  { icon: Search, label: '搜索', href: '/search' },
  { icon: Globe, label: '资源', href: '/source-browser' },
  { icon: Heart, label: '收藏', href: '/favorites' },
  { icon: History, label: '历史', href: '/history' },
];

const AI_ITEM: SideNavItem = { icon: Sparkles, label: '智能', href: '__ai' };

export default function SideNav({
  showAIButton = false,
  onAIButtonClick,
}: SideNavProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const [active, setActive] = useState(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [username, setUsername] = useState('');
  const [categoryItems, setCategoryItems] =
    useState<SideNavItem[]>(BASE_ITEMS);

  // 折叠状态持久化 + 内容区边距同步（CSS 变量）
  useEffect(() => {
    const initCollapsedState = async () => {
      try {
        const saved = localStorage.getItem(COLLAPSE_KEY);
        const initial = saved === 'true';
        setCollapsed(initial);
        document.documentElement.style.setProperty(
          '--sidenav-w',
          `${initial ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px`
        );
      } catch {
        document.documentElement.style.setProperty(
          '--sidenav-w',
          `${EXPANDED_WIDTH}px`
        );
      }
    };
    
    initCollapsedState();
  }, []);

  // 处理用户认证信息
  useEffect(() => {
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      setUsername(authInfo.username);
    }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      // 忽略持久化失败
    }
    document.documentElement.style.setProperty(
      '--sidenav-w',
      `${next ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px`
    );
  };

  const { data: userEmbyConfig } = useQuery(userEmbyConfigOptions());
  const { data: publicSourcesData } = useQuery(publicSourcesOptions());

  const computedCategoryItems = useMemo(() => {
    const runtimeConfig =
      typeof window === 'undefined'
        ? undefined
        : (window as any).RUNTIME_CONFIG;
    const newItems = [...BASE_ITEMS];

    const hasLive = newItems.some((item) => item.href === '/live');
    if (runtimeConfig?.ENABLE_WEB_LIVE && !hasLive) {
      newItems.push({ icon: Radio, label: '直播', href: '/live' });
    } else if (!runtimeConfig?.ENABLE_WEB_LIVE && hasLive) {
      const index = newItems.findIndex((item) => item.href === '/live');
      if (index > -1) newItems.splice(index, 1);
    }

    if (
      runtimeConfig?.CUSTOM_CATEGORIES?.length > 0 &&
      !newItems.some((item) => item.href === '/douban?type=custom')
    ) {
      newItems.push({
        icon: Star,
        label: '自定义',
        href: '/douban?type=custom',
      });
    }

    const hasUserEmby = userEmbyConfig?.sources?.some(
      (s: any) => s.enabled && s.ServerURL
    );
    const hasPublicEmby = (publicSourcesData?.sources?.length ?? 0) > 0;
    const hasEmbyInMenu = newItems.some((item) => item.href === '/emby');

    if ((hasUserEmby || hasPublicEmby) && !hasEmbyInMenu) {
      newItems.push({ icon: FolderOpen, label: 'Emby', href: '/emby' });
    } else if (!hasUserEmby && !hasPublicEmby && hasEmbyInMenu) {
      const index = newItems.findIndex((item) => item.href === '/emby');
      if (index > -1) newItems.splice(index, 1);
    }

    return newItems;
  }, [userEmbyConfig, publicSourcesData]);

  useEffect(() => {
    // Only update categoryItems if the computed value actually differs from current value
    if (JSON.stringify(computedCategoryItems) !== JSON.stringify(categoryItems)) {
      setCategoryItems(computedCategoryItems);
    }
  }, [computedCategoryItems, categoryItems]);

  useEffect(() => {
    const queryString = searchParams.toString();
    const fullPath = queryString ? `${pathname}?${queryString}` : pathname;
    setActive(fullPath);
  }, [pathname, searchParams]);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];
    const decodedActive = decodeURIComponent(active);
    const decodedHref = decodeURIComponent(href);

    return (
      decodedActive === decodedHref ||
      (decodedActive.startsWith('/douban') &&
        typeMatch &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  const toCapsuleOptions = (items: SideNavItem[]) =>
    items.map((item) => {
      const Icon = item.icon;
      return {
        label: collapsed ? '' : item.label,
        value: item.href,
        icon: <Icon className='h-5 w-5' />,
      };
    });

  const categoryValues = new Set([
    ...BASE_ITEMS.map((item) => item.href),
    ...categoryItems.map((item) => item.href),
  ]);
  const activeCategory = [...categoryValues].find((href) =>
    isActive(href)
  ) ?? '';
  const showAI = showAIButton && onAIButtonClick;
  const visibleTools = showAI
    ? [TOOL_ITEMS[0], AI_ITEM, ...TOOL_ITEMS.slice(1)]
    : TOOL_ITEMS;
  const activeTool =
    visibleTools.find((item) => isActive(item.href))?.href ?? '';

  const goNav = (href: string) => {
    setActive(href);
    router.push(href);
  };

  const goTool = (href: string) => {
    if (href === AI_ITEM.href) {
      onAIButtonClick?.();
      return;
    }
    goNav(href);
  };

  return (
    <aside
      className='fixed bottom-0 left-0 top-0 z-50 hidden flex-col border-r border-gray-200/60 bg-white/85 backdrop-blur-xl transition-[width] duration-300 dark:border-gray-700/60 dark:bg-gray-900/85 md:flex'
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
    >
      {/* App 图标 = 展开/折叠开关 + 品牌字（展开时显示） */}
      <div
        className={`flex items-center px-3 pt-4 ${
          collapsed ? 'justify-center' : 'justify-start gap-2'
        }`}
      >
        <button
          onClick={toggleCollapsed}
          title={collapsed ? '展开导航' : '收起导航'}
          aria-label={collapsed ? '展开导航' : '收起导航'}
          className='rounded-2xl transition-transform duration-200 hover:scale-105 active:scale-95'
        >
          <img
            src='/logo.png'
            alt={siteName}
            className='h-9 w-9 ml-2 mr-3 shrink-0 object-contain'
          />
        </button>
        {!collapsed && (
          <img
            src='/multiplex.png'
            alt={`${siteName} multiplex`}
            className='h-6 w-auto mt-3 max-w-[100px] object-contain'
          />
        )}
      </div>

      {/* 导航组（纵向胶囊，首页在分类容器内首位） */}
      <nav className='flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 scrollbar-hide'>
        {/* 分类容器 */}
        <CapsuleSwitch
          orientation='vertical'
          tone='green'
          options={toCapsuleOptions([
            { icon: Home, label: '首页', href: '/' },
            ...categoryItems.filter((item) => item.href !== '/'),
          ])}
          active={activeCategory}
          onChange={goNav}
        />

        {/* 工具容器 */}
        <CapsuleSwitch
          orientation='vertical'
          tone='green'
          options={toCapsuleOptions(visibleTools)}
          active={activeTool}
          onChange={goTool}
        />
      </nav>

      {/* 底部：账号左 + 设置右 */}
      <div className='flex flex-col items-center gap-1 px-3 pb-3'>
        <div
          className={`flex w-full items-center ${
            collapsed ? 'flex-col gap-1' : 'flex-row justify-between gap-2'
          }`}
        >
          <div
            className={`flex items-center gap-2 rounded-xl px-1 py-1 ${
              collapsed ? 'justify-center' : 'justify-start'
            }`}
          >
            <UserMenu variant='account' menuAnchor='bottom' />
            {!collapsed && (
              <span className='truncate text-sm font-semibold text-gray-800 dark:text-gray-100'>
                {username || 'default'}
              </span>
            )}
          </div>
          <UserMenu variant='settings' menuAlign='left' menuAnchor='bottom' />
        </div>
      </div>
    </aside>
  );
}
