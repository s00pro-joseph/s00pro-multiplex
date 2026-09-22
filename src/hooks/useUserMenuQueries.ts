/* eslint-disable no-console */

import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { checkForUpdates, type UpdateStatus } from '@/lib/version_check';
import type { PlayRecord } from '@/lib/types';

/**
 * Query options for server config
 */
const serverConfigOptions = () => queryOptions({
  queryKey: ['serverConfig'],
  queryFn: async () => {
    const response = await fetch('/api/server-config');
    if (response.ok) {
      const config = await response.json();
      return { downloadEnabled: config.DownloadEnabled ?? true };
    }
    return { downloadEnabled: true };
  },
  staleTime: 10 * 60 * 1000, // 10 minutes
  gcTime: 30 * 60 * 1000,
});

/**
 * Fetch server config (download enabled, etc.)
 */
export function useServerConfigQuery() {
  return useQuery(serverConfigOptions());
}

/**
 * Query options for version check
 */
const versionCheckOptions = () => queryOptions<UpdateStatus>({
  queryKey: ['versionCheck'],
  queryFn: () => checkForUpdates(),
  staleTime: 30 * 60 * 1000, // 30 minutes - no need to check frequently
  gcTime: 60 * 60 * 1000,
  retry: 1,
});

/**
 * Check for version updates
 */
export function useVersionCheckQuery() {
  return useQuery(versionCheckOptions());
}

interface UsePlayRecordsQueryOptions {
  enabled: boolean;
  enableFilter: boolean;
  minProgress: number;
  maxProgress: number;
}

/**
 * Query options for play records with filtering
 * 使用新的 usePlayRecordsQuery 作为数据源
 */
const playRecordsOptions = (
  enableFilter: boolean,
  minProgress: number,
  maxProgress: number
) => queryOptions({
  queryKey: ['playRecords', 'userMenu', enableFilter, minProgress, maxProgress],
  queryFn: async () => {
    // 使用 fetch 直接获取，因为这里需要在 queryFn 内部调用
    const response = await fetch('/api/playrecords');
    if (!response.ok) {
      throw new Error(`Failed to fetch play records: ${response.status}`);
    }
    const records = await response.json() as Record<string, PlayRecord>;

    const recordsArray = Object.entries(records).map(([key, record]) => ({
      ...record,
      key,
    }));

    // Filter records that need continue watching
    const validPlayRecords = recordsArray.filter(record => {
      const progress = record.total_time === 0
        ? 0
        : (record.play_time / record.total_time) * 100;

      // Play time must exceed 2 minutes
      if (record.play_time < 120) return false;

      // If filter is disabled, show all records with > 2 min playtime
      if (!enableFilter) return true;

      // Filter by user's custom progress range
      return progress >= minProgress && progress <= maxProgress;
    });

    // Sort by last play time descending
    const sortedRecords = validPlayRecords.sort((a, b) => b.save_time - a.save_time);
    return sortedRecords.slice(0, 12); // Only take the latest 12
  },
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 10 * 60 * 1000,
});

/**
 * Fetch play records with filtering
 */
export function usePlayRecordsQuery({
  enabled,
  enableFilter,
  minProgress,
  maxProgress,
}: UsePlayRecordsQueryOptions) {
  return useQuery({
    ...playRecordsOptions(enableFilter, minProgress, maxProgress),
    enabled,
  });
}

interface UseFavoritesQueryOptions {
  enabled: boolean;
}

/**
 * Query options for favorites list
 * 使用新的 useFavoritesQuery 作为数据源
 */
const favoritesOptions = () => queryOptions({
  queryKey: ['favorites', 'userMenu'],
  queryFn: async () => {
    const response = await fetch('/api/favorites');
    if (response.ok) {
      const favoritesData = await response.json() as Record<string, any>;
      const favoritesArray = Object.entries(favoritesData).map(([key, favorite]) => ({
        ...favorite,
        key,
      }));
      // Sort by save time descending
      return favoritesArray.sort((a, b) => b.save_time - a.save_time);
    }
    return [];
  },
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 10 * 60 * 1000,
});

/**
 * Fetch favorites list
 */
export function useFavoritesQuery({ enabled }: UseFavoritesQueryOptions) {
  return useQuery({
    ...favoritesOptions(),
    enabled,
  });
}

/**
 * Change password mutation
 * Based on TanStack Query useMutation pattern from source code
 */
export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: async ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) => {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败');
      }

      return data;
    },
  });
}

/**
 * Invalidate play records and favorites queries
 * Useful when external events update data
 */
export function useInvalidateUserMenuData() {
  const queryClient = useQueryClient();

  return {
    invalidatePlayRecords: () => {
      queryClient.invalidateQueries({ queryKey: ['playRecords'] });
    },
    invalidateFavorites: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['playRecords'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  };
}
