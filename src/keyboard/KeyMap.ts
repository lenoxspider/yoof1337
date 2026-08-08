import { Key } from 'ink';

type Action = () => void;

export interface Shortcut {
  key: {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  };
  ctx?: string;
  priority: number;
}

export class KeyMap {
  private map = new Map<string, {action: Action; priority: number}>();

  private id(key: { name?: string; ctrl?: boolean; shift?: boolean }, ctx?: string) {
    return `${ctx ?? 'global'}:${key.name ?? ''}:${key.ctrl ? 'C' : ''}:${key.shift ? 'S' : ''}`;
  }

  bind(s: Shortcut, action: Action) {
    const id = this.id(s.key, s.ctx);
    const existing = this.map.get(id);
    if (!existing || s.priority > existing.priority) {
      this.map.set(id, {action, priority: s.priority});
    }
  }

  resolve(key: Key, ctx?: string): Action | undefined {
    const contexts = ctx ? [ctx, "global"] : ["global"];
    for (const c of contexts) {
      const id = this.id(key, c);
      const matched = this.map.get(id);
      if (matched) return matched.action;
    }
    return undefined;
  }
}
