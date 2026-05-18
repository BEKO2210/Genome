#!/usr/bin/env node
// GENOME — Claude Code PreToolUse hook.
// Reads tool-call payload from stdin (JSON); if the targeted path matches a
// forbidden glob in genome/firewall.json, blocks the call with a clear reason.
// Fail-open: any unexpected condition lets the call through (never freezes the session).

import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, relative, sep, posix } from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function globToRegex(glob) {
  let r = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        r += '.*';
        i += 2;
        if (glob[i] === '/') i++;
      } else {
        r += '[^/]*';
        i++;
      }
    } else if ('.+?^${}()|[]\\\\'.includes(c)) {
      r += '\\' + c;
      i++;
    } else {
      r += c;
      i++;
    }
  }
  return new RegExp('^' + r + '$');
}

function toRelPosix(p, cwd) {
  if (!p) return '';
  let rel = p;
  if (isAbsolute(p)) {
    try { rel = relative(cwd, p); } catch { rel = p; }
  }
  return rel.split(sep).join(posix.sep);
}

function extractPath(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolName === 'Read' || toolName === 'NotebookRead') return toolInput.file_path || toolInput.notebook_path || '';
  if (toolName === 'Grep') return toolInput.path || '';
  if (toolName === 'Glob') return toolInput.path || toolInput.pattern || '';
  return toolInput.file_path || toolInput.path || '';
}

(async () => {
  try {
    const raw = await readStdin();
    if (!raw) { process.exit(0); }
    let payload;
    try { payload = JSON.parse(raw); } catch { process.exit(0); }

    const cwd = payload.cwd || process.cwd();
    const fwPath = join(cwd, 'genome', 'firewall.json');
    if (!existsSync(fwPath)) { process.exit(0); }

    let fw;
    try { fw = JSON.parse(readFileSync(fwPath, 'utf8')); }
    catch { process.exit(0); }

    if (fw.mode !== 'block') { process.exit(0); }
    const globs = Array.isArray(fw.forbidden_globs) ? fw.forbidden_globs : [];
    if (!globs.length) { process.exit(0); }

    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input || {};
    const target = extractPath(toolName, toolInput);
    if (!target) { process.exit(0); }

    const rel = toRelPosix(target, cwd);
    const regexes = globs.map(globToRegex);
    const hit = regexes.some((re) => re.test(rel));
    if (!hit) { process.exit(0); }

    const reason = `GENOME-Firewall: ${rel} ist gesperrt. Nutze die Context Capsule.`;
    const out = {
      decision: 'block',
      reason,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  } catch {
    process.exit(0); // fail-open
  }
})();
