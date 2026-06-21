import { type FnContext, json } from './_lib';

/** GET /api/online — 近 90 秒在線人數（心跳間隔 60s） */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const now = Date.now();
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?')
      .bind(now - 90000)
      .first<{ n: number }>();
    const n = Math.max(1, row?.n ?? 0);
    /** 記錄此小時的在線尖峰（取最大值），供歷史查詢 */
    const hour = Math.floor(now / 3600000);
    await env.DB.prepare('INSERT INTO online_hourly (hour, peak) VALUES (?, ?) ON CONFLICT(hour) DO UPDATE SET peak = MAX(peak, ?)')
      .bind(hour, n, n)
      .run();
    /** 機會性清除過期列 */
    await env.DB.prepare('DELETE FROM presence WHERE last_seen < ?')
      .bind(now - 600000)
      .run();
    return json({ online: n });
  } catch {
    return json({ online: 1 });
  }
};
