'use client';

import FavoritesPanel from '@/components/FavoritesPanel';
import PageLayout from '@/components/PageLayout';

export default function FavoritesPage() {
  return (
    <PageLayout activePath='/favorites'>
      <div className='w-full max-w-[2560px] mx-auto px-4 md:px-6 lg:px-8'>
        <FavoritesPanel />
      </div>
    </PageLayout>
  );
}
