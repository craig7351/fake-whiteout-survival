import { type FnContext, json } from './_lib';

/** GET /api/online-history — 最近 7 天，每日的在線尖峰人數（舊→新） */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const { results } = await env.DB.prepare('SELECT day, peak FROM online_daily ORDER BY day DESC LIMIT 7').all<{
      day: number;
      peak: number;
    }>();
    const list = results.map((r) => ({ at: r.day * 86400000, peak: r.peak })).reverse();
    return json(list);
  } catch {
    return json([]);
  }
};
