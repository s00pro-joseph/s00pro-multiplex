/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, getAvailableApiSites } from '@/lib/config';
import { checkSourceWithKeyword } from '@/lib/source-validate';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log('[Source Validate] ========== API Route Called ==========');

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    console.log('[Source Validate] Unauthorized - no auth info');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q');
  console.log(`[Source Validate] Search keyword: ${searchKeyword}`);

  if (!searchKeyword) {
    return new Response(
      JSON.stringify({ error: '搜索关键词不能为空' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // 🔑 使用 getAvailableApiSites() 来获取源列表，自动应用代理配置
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 🔍 调试：记录前3个源的API地址，检查是否应用了代理
  console.log('[Source Validate] ========== Validation Start ==========');
  console.log(`[Source Validate] Username: ${authInfo.username}`);
  console.log(`[Source Validate] Total sources: ${apiSites.length}`);
  console.log('[Source Validate] Sample API URLs:', apiSites.slice(0, 3).map(s => ({
    name: s.name,
    api: s.api.substring(0, 100) + (s.api.length > 100 ? '...' : '')
  })));
  console.log('[Source Validate] =========================================');

  // 共享状态
  let streamClosed = false;

  // 创建可读流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 辅助函数：安全地向控制器写入数据
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed || (!controller.desiredSize && controller.desiredSize !== 0)) {
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        totalSources: apiSites.length
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return;
      }

      // 记录已完成的源数量
      let completedSources = 0;

      // 为每个源创建验证 Promise（原生检测：真关键词搜索）
      const validationPromises = apiSites.map(async (site) => {
        try {
          // 🔍 调试：记录实际请求的源
          console.log(`[Source Validate] Testing ${site.name}...`);

          const result = await checkSourceWithKeyword(site.api, searchKeyword, 10000);
          if (result.status === 'invalid') {
            console.warn(`验证失败 ${site.name}:`, result.reason);
          }

          // 发送该源的验证结果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: result.status === 'invalid' ? 'source_error' : 'source_result',
              source: site.key,
              status: result.status,
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }
        } catch (error) {
          console.warn(`验证失败 ${site.name}:`, error);

          // 发送源错误事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              status: 'invalid'
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        // 检查是否所有源都已完成
        if (completedSources === apiSites.length) {
          if (!streamClosed) {
            // 发送最终完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              completedSources
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      // 等待所有验证完成
      await Promise.allSettled(validationPromises);
    },

    cancel() {
      streamClosed = true;
      console.log('Client disconnected, cancelling validation stream');
    },
  });

  // 返回流式响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
