/**
 * Shared type definitions for prompt version management
 */

export type PromptVersion = {
  id: string;
  scopeKey: string;
  version: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
};

export type PromptScopeView = {
  scopeKey: string;
  scopeLabel: string;
  scopeDescription: string;
  versions: PromptVersion[];
  activePrompt: PromptVersion | null;
  resolvedPrompt: PromptVersion | null;
  inheritedFromDefault: boolean;
};
