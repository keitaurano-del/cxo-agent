// 機微情報マスク util。
//
// クライアントに返す全テキスト（feed / lastAction / tool_result 要約など）に通して、
// API キー・トークン・秘密鍵・URL 内認証情報などを伏字に置換する。
//
// 方針: 「誤検知より漏れ防止優先」で広めにマッチさせる。マスクしすぎても実害は小さいが、
// 鍵が1本でも素通りすると公開 URL 経由で漏れるため、保守的（過剰）に倒す。

interface RedactRule {
  kind: string;
  re: RegExp;
}

// 注意: グローバルフラグ付き正規表現は lastIndex 状態を持つため、
// applyRedaction 内で毎回個別に replace を呼ぶ（共有 state による取りこぼし回避）。
const RULES: RedactRule[] = [
  // PEM 秘密鍵ブロック（BEGIN〜END をまるごと）。複数行に渡るので最優先・dotAll。
  {
    kind: 'PRIVATE_KEY',
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  // Anthropic API キー
  { kind: 'ANTHROPIC_KEY', re: /sk-ant-[\w-]+/g },
  // GitHub トークン（PAT / OAuth / server / refresh）
  { kind: 'GITHUB_TOKEN', re: /gh[poshu]_[A-Za-z0-9]+/g },
  // Slack トークン
  { kind: 'SLACK_TOKEN', re: /xox[baprs]-[\w-]+/g },
  // AWS アクセスキー ID
  { kind: 'AWS_KEY', re: /AKIA[0-9A-Z]{16}/g },
  // JWT（3 セグメント base64url、先頭 eyJ）。URL 認証より先に処理（JWT が URL に紛れても拾う）。
  { kind: 'JWT', re: /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+/g },
  // Postgres 接続文字列（パスワード混入の典型）
  { kind: 'DB_URL', re: /postgres(?:ql)?:\/\/\S+/g },
  // URL 内の user:pass@ 認証情報（http/https）。スキーム〜@ までを伏字。
  { kind: 'URL_CREDENTIALS', re: /https?:\/\/[^\s/@]+:[^\s/@]+@/g },
  // 汎用 sk- 始まりのシークレット（sk-ant は上で拾うが、その他 OpenAI 等もカバー）
  { kind: 'SECRET_KEY', re: /sk-[A-Za-z0-9]{20,}/g },
];

/**
 * 単一文字列の機微情報を伏字化する。
 * - null/undefined はそのまま返す（呼び出し側の型を維持）。
 * - 文字列以外は String 化せずそのまま返す（数値などは対象外）。
 */
export function redactText<T extends string | null | undefined>(input: T): T {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out: string = input;
  for (const rule of RULES) {
    // 各 rule の lastIndex を毎回リセットして使う（global 正規表現の state 持ち越し回避）。
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, `[REDACTED:${rule.kind}]`);
  }
  return out as T;
}

/**
 * 任意の値を再帰的にマスク。string はマスク、配列/オブジェクトは中身を走査。
 * feed item など構造体ごと通したい時に使う。
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}
