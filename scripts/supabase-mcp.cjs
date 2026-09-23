#!/usr/bin/env node
const { spawn, execSync } = require('node:child_process');

// Retrieve Supabase Personal Access Token safely from environment or Windows User registry
let token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token && process.platform === 'win32') {
  try {
    const stdout = execSync('reg query "HKCU\\Environment" /v SUPABASE_ACCESS_TOKEN', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = stdout.match(/SUPABASE_ACCESS_TOKEN\s+REG_\w+\s+(\S+)/);
    if (match && match[1]) {
      token = match[1];
    }
  } catch {
    // Registry query failed or not found
  }
}

if (!token) {
  console.error('Error: SUPABASE_ACCESS_TOKEN is not set in environment or Windows User variables.');
  process.exit(1);
}

const projectRef = 'fpqipekjhcmrjozqmgwb';

const child = spawn(
  'npx',
  ['-y', '@supabase/mcp-server-supabase@latest', '--project-ref', projectRef],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: token
    }
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
