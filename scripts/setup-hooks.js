#!/usr/bin/env node
import { execSync } from 'node:child_process';
import process from 'node:process';

function isGitRepo() {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!isGitRepo()) {
  process.exit(0);
}

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to set core.hooksPath:', error);
  process.exit(1);
}
