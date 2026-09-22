/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { AlertCircle, CheckCircle, Lock, ShieldCheck, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { ThemeToggle } from '@/components/ThemeToggle';

function SetupPageClient() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 已初始化则直接去登录
  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.initialized) router.replace('/login');
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!username || !password || password !== confirmPassword) return;
    try {
      setLoading(true);
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.replace('/login');
      } else {
        setError(data.error || '初始化失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className='fixed inset-0 z-50 flex items-center justify-center bg-gray-100 dark:bg-gray-900'>
        <p className='text-sm text-gray-500'>正在检查初始化状态…</p>
      </div>
    );
  }

  return (
    <div translate='no' className='fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4 py-8 bg-gradient-to-br from-purple-100 via-blue-50 to-pink-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900'>
      <div className='absolute top-3 right-3 z-20'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl shadow-xl p-6 sm:p-10 border border-white/50 dark:border-zinc-700/50'>
        <div className='text-center mb-6'>
          <div className='inline-flex items-center justify-center w-14 h-14 mb-3 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg'>
            <ShieldCheck className='w-7 h-7 text-white' />
          </div>
          <h1 className='text-2xl font-extrabold mb-2'>初始化设置</h1>
          <p className='text-gray-600 dark:text-gray-400 text-sm'>
            首次使用，请创建一个站长账号。设置后即进入登录页。
          </p>
        </div>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div>
            <label htmlFor='username' className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
              站长用户名
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                <User className='h-4 w-4 text-gray-400' />
              </div>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full pl-10 pr-3 py-2.5 rounded-lg border-0 text-gray-900 dark:text-gray-100 shadow-sm ring-2 ring-white/60 dark:ring-white/10 placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm bg-white/80 dark:bg-zinc-800/80'
                placeholder='字母、数字、下划线，3-20位'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor='password' className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
              密码
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                <Lock className='h-4 w-4 text-gray-400' />
              </div>
              <input
                id='password'
                type='password'
                autoComplete='new-password'
                className='block w-full pl-10 pr-3 py-2.5 rounded-lg border-0 text-gray-900 dark:text-gray-100 shadow-sm ring-2 ring-white/60 dark:ring-white/10 placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm bg-white/80 dark:bg-zinc-800/80'
                placeholder='至少 6 位'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor='confirmPassword' className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
              确认密码
            </label>
            <div className='relative'>
              <div className='absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none'>
                <CheckCircle className='h-4 w-4 text-gray-400' />
              </div>
              <input
                id='confirmPassword'
                type='password'
                autoComplete='new-password'
                className='block w-full pl-10 pr-3 py-2.5 rounded-lg border-0 text-gray-900 dark:text-gray-100 shadow-sm ring-2 ring-white/60 dark:ring-white/10 placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm bg-white/80 dark:bg-zinc-800/80'
                placeholder='再次输入密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div role='alert' className='flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50'>
              <AlertCircle className='h-4 w-4 text-red-600 shrink-0' />
              <p className='text-xs text-red-600 dark:text-red-400'>{error}</p>
            </div>
          )}

          <button
            type='submit'
            disabled={!username || !password || password !== confirmPassword || loading}
            className='w-full py-2.5 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-semibold shadow-lg disabled:opacity-50'
          >
            {loading ? '创建中…' : '创建站长并完成初始化'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageClient />
    </Suspense>
  );
}
