'use client';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';

export default function HistoryPage() {
  return (
    <PageLayout activePath='/history'>
      <div className='w-full max-w-[2560px] mx-auto px-4 md:px-6 lg:px-8'>
        <section className='mb-8'>
          <div className='mb-6 flex items-center justify-between'>
            <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              观看历史
            </h2>
          </div>
          <ContinueWatching />
        </section>
      </div>
    </PageLayout>
  );
}
