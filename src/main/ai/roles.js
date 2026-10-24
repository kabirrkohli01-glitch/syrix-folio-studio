// Resolves the provider chain for a task role from settings. In local-only
// privacy mode every role is restricted to Ollama targets, so no text leaves
// the machine.

import { DEFAULT_ROLES } from './providers.js';

export function chainFor(settings, role) {
  const s = settings.get();
  const configured = (s.roles && s.roles[role]) || DEFAULT_ROLES[role] || [];
  const chain = configured.filter((t) => t && t.provider && t.model);
  if (s.privacy?.mode === 'local') {
    const local = chain.filter((t) => t.provider === 'ollama');
    return local.length ? local : [{ provider: 'ollama', model: s.privacy.localModel || 'qwen3:8b' }];
  }
  return chain.length ? chain : DEFAULT_ROLES[role];
}
