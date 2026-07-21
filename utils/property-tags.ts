export function getPropertyTags(prop: any): string[] {
  if (!prop) return [];
  if (Array.isArray(prop.tags) && prop.tags.length > 0) {
    return prop.tags.map((t: any) => String(t).trim()).filter(Boolean);
  }
  if (prop.configurations) {
    try {
      const parsed = typeof prop.configurations === 'string' ? JSON.parse(prop.configurations) : prop.configurations;
      if (Array.isArray(parsed?.tags)) {
        return parsed.tags.map((t: any) => String(t).trim()).filter(Boolean);
      }
    } catch (e) {
      // Ignored
    }
  }
  return [];
}

export function formatPropertyConfigWithTags(existingConfig: any, tags: string[]): string {
  let parsedConfig: any = {};
  if (existingConfig) {
    try {
      parsedConfig = typeof existingConfig === 'string' ? JSON.parse(existingConfig) : existingConfig;
    } catch (e) {
      parsedConfig = {};
    }
  }
  const cleanTags = tags.map(t => t.trim()).filter(Boolean);
  return JSON.stringify({ ...parsedConfig, tags: cleanTags });
}
