/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

import { Suspense } from 'react';
import HomeClient from './HomeClient';
import { CinematicLoadingFallback } from '@/components/CinematicLoadingFallback';

// 🔥 Server Component - 配置已移入客户端（首页不再需要服务端配置）
export default async function Home() {
  return (
    <Suspense fallback={<CinematicLoadingFallback />}>
      <HomeClient />
    </Suspense>
  );
}
