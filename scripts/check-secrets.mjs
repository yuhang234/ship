#!/usr/bin/env node
/**
 * 提交前的密钥扫描：只检查 Git 跟踪的文件（含可选的历史扫描）。
 *
 * 设计取舍：
 * - 只匹配**已知的高风险形态**（GitHub / Cloudflare / AWS / Slack / 私钥 / 常见 key 命名），
 *   不做高熵猜测，避免把 SHA、CSS 变量、占位符误报成密钥。
 * - 占位符（`xxxx`、`<owner>`、`your-`、`example`、`placeholder`）直接放行，
 *   这样文档和 `.env.example` 不会制造噪音。
 * - 命中即非零退出，可用于 pre-commit 与 CI。
 *
 * 用法：
 *   node scripts/check-secrets.mjs            # 扫描已跟踪文件
 *   node scripts/check-secrets.mjs --history  # 额外扫描全部提交历史
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** 已知密钥形态：命中即高危。 */
const HARD_PATTERNS = [
  { name: 'GitHub OAuth/App token', re: /\bgh[ousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'AWS access key id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Cloudflare API token assignment', re: /(?:CLOUDFLARE|CF)_(?:API_)?TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/ },
  { name: 'OAuth client secret assignment', re: /CLIENT_SECRET\s*[:=]\s*["'][^"']{16,}["']/ },
  { name: 'wrangler oauth_token', re: /^\s*oauth_token\s*=\s*"[^"]{16,}"/m },
];

/** 看起来像占位符的值，直接放行。 */
const PLACEHOLDER = /(xxxx|placeholder|<[^>]+>|your-|example|dummy|redacted|change-?me|\$\{)/i;

/** 不扫描的文件：锁文件与二进制。 */
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

/**
 * 在给定文本里查找高危密钥。
 * @param {string} text 文件内容
 * @returns {Array<{ name: string; sample: string }>}
 */
function scanText(text) {
  const findings = [];
  for (const { name, re } of HARD_PATTERNS) {
    const match = text.match(re);
    if (!match) continue;
    const sample = match[0];
    if (PLACEHOLDER.test(sample)) continue;
    findings.push({ name, sample });
  }
  return findings;
}

/** 返回 Git 跟踪的文件列表。 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/** 扫描工作区里已跟踪的文件。 */
function scanWorkingTree() {
  const problems = [];
  for (const file of trackedFiles()) {
    if (SKIP_FILES.has(file)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // 明显是二进制的文件不按文本扫描
    if (text.includes('\u0000')) continue;
    for (const finding of scanText(text)) {
      problems.push({ where: file, ...finding });
    }
  }
  return problems;
}

/** 扫描全部提交历史（用于确认"以前没漏过"）。 */
function scanHistory() {
  const problems = [];
  const revs = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const { name, re } of HARD_PATTERNS) {
    const args = ['grep', '-I', '-n', '-E', re.source, ...revs];
    let out = '';
    try {
      out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch {
      continue; // grep 无命中时退出码为 1
    }
    for (const line of out.split('\n').filter(Boolean).slice(0, 5)) {
      if (PLACEHOLDER.test(line)) continue;
      problems.push({ where: 'history', name, sample: line.slice(0, 160) });
    }
  }
  return problems;
}

const withHistory = process.argv.includes('--history');
const problems = [...scanWorkingTree(), ...(withHistory ? scanHistory() : [])];

if (problems.length === 0) {
  console.log('✅ 密钥扫描通过：未发现疑似 token / key / 私钥。');
  process.exit(0);
}

console.error('❌ 检测到疑似密钥，已阻止提交：');
for (const problem of problems) {
  console.error(`  - [${problem.name}] ${problem.where}\n    ${problem.sample}`);
}
console.error('\n处理方式：把密钥移到 Cloudflare Secret / GitHub Actions Secrets，或改用占位符后再提交。');
process.exit(1);