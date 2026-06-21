import { type FnContext, json } from './_lib';

/** POST /api/open — 遊戲被開啟一次（首頁載入時呼叫），累計開啟次數 */
export const onRequestPost = async ({ env }: FnContext): Promise<Response> => {
  try {
    await env.DB.prepare('UPDATE stats SET opens = COALESCE(opens, 0) + 1 WHERE id = 1').run();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
};
