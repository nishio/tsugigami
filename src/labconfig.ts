// lab(?lab=1)と本体は保存領域が別(tsugigami-lab / tsugigami)。lab の画面で入れた GitHub の設定は、
// もとは lab の側('lab:github')にしか保存されず、本体の自動バックアップは未設定のまま残っていた(2026-11-07 に発覚)。
// 本体から lab の設定を見つけて引き継ぐための読み出し口。トークンの値は画面にもログにも出さない。
import type { GitHubConfig } from './github';
import { Store } from './store';

export const LAB_DB = 'tsugigami-lab';
export const LAB_GITHUB_KEY = 'lab:github';
/** 起動時の「lab の設定で始めますか」を断ったら、次からは起動時に聞かない(ノート一覧からは使える) */
export const LAB_OFFER_KEY = 'github:labOffer';

const valid = (c: unknown): c is GitHubConfig =>
  !!c && typeof (c as GitHubConfig).repo === 'string' && typeof (c as GitHubConfig).token === 'string' &&
  /^[\w.-]+\/[\w.-]+$/.test((c as GitHubConfig).repo) && !!(c as GitHubConfig).token;

/** lab の保存領域にある GitHub の設定。lab を一度も開いていなければ null(保存領域を新しく作らない) */
export async function readLabGitHub(): Promise<GitHubConfig | null> {
  try {
    const dbs = await indexedDB.databases?.();
    if (dbs && !dbs.some(d => d.name === LAB_DB)) return null;
    const cfg = await (await Store.open(LAB_DB)).getMeta<GitHubConfig>(LAB_GITHUB_KEY);
    return valid(cfg) ? { repo: cfg.repo, token: cfg.token } : null;
  } catch {
    return null;
  }
}
