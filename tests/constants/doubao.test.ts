import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDoubaoKeyMissingError,
  getBuiltinDoubaoApiKey,
  hasBuiltinDoubaoApiKey,
  resolveDoubaoApiKey,
} from '../../src/constants/doubao';

describe('doubao builtin API key', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolveDoubaoApiKey prefers user key over builtin', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', 'ark-builtin');
    expect(resolveDoubaoApiKey('ark-user')).toBe('ark-user');
  });

  it('resolveDoubaoApiKey falls back to builtin when user empty', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', 'ark-builtin');
    expect(resolveDoubaoApiKey('')).toBe('ark-builtin');
    expect(resolveDoubaoApiKey('   ')).toBe('ark-builtin');
  });

  it('hasBuiltinDoubaoApiKey is false when env unset', () => {
    vi.stubEnv('VITE_BUILTIN_DOUBAO_API_KEY', '');
    expect(getBuiltinDoubaoApiKey()).toBe('');
    expect(hasBuiltinDoubaoApiKey()).toBe(false);
    expect(resolveDoubaoApiKey('')).toBe('');
  });

  it('formatDoubaoKeyMissingError mentions Netlify in production', () => {
    vi.stubEnv('PROD', true);
    expect(formatDoubaoKeyMissingError()).toMatch(/Netlify/);
    expect(formatDoubaoKeyMissingError()).toMatch(/无需自行配置/);
  });

  it('formatDoubaoKeyMissingError mentions setup script in dev', () => {
    vi.stubEnv('PROD', false);
    expect(formatDoubaoKeyMissingError()).toMatch(/setup:doubao-key/);
  });
});
