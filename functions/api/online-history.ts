import { type FnContext, json } from './_lib';

/** GET /api/online-history — 最近 24 小時，每小時的在線尖峰人數（舊→新） */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const { results } = await env.DB.prepare('SELECT hour, peak FROM online_hourly ORDER BY hour DESC LIMIT 24').all<{
      hour: number;
      peak: number;
    }>();
    const list = results.map((r) => ({ at: r.hour * 3600000, peak: r.peak })).reverse();
    return json(list);
  } catch {
    return json([]);
  }
};
