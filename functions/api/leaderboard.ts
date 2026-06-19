import { type FnContext, json } from './_lib';

interface RunRow {
  name: string;
  wave: number;
  money: number;
  won: number;
  created_at: number;
}

/** GET /api/leaderboard?limit=10 — 依撐到的波數（再依賺錢）排序的前 N 名 */
export const onRequestGet = async ({ request, env }: FnContext): Promise<Response> => {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 50);
  try {
    const { results } = await env.DB.prepare(
      'SELECT name,wave,money,won,created_at FROM runs ORDER BY wave DESC, money DESC LIMIT ?',
    )
      .bind(limit)
      .all<RunRow>();
    return json(results.map((r) => ({ name: r.name, wave: r.wave, money: r.money, won: !!r.won, at: r.created_at })));
  } catch {
    return json({ error: 'db error' }, 500);
  }
};
