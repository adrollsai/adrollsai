export function parsePropertyConfigurations(rawConfig: any): Record<string, any> {
  if (!rawConfig) return {};
  if (typeof rawConfig === 'object' && rawConfig !== null) return rawConfig;
  try {
    const parsed = JSON.parse(rawConfig);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function getPropertyTags(prop: any): string[] {
  if (!prop) return [];
  const tagList: string[] = [];

  if (Array.isArray(prop.tags)) {
    tagList.push(...prop.tags.map((t: any) => String(t).trim()).filter(Boolean));
  }
  if (Array.isArray(prop.internal_tags)) {
    tagList.push(...prop.internal_tags.map((t: any) => String(t).trim()).filter(Boolean));
  }
  if (prop.configurations) {
    const parsed = parsePropertyConfigurations(prop.configurations);
    if (Array.isArray(parsed?.tags)) {
      tagList.push(...parsed.tags.map((t: any) => String(t).trim()).filter(Boolean));
    }
    if (Array.isArray(parsed?.internal_tags)) {
      tagList.push(...parsed.internal_tags.map((t: any) => String(t).trim()).filter(Boolean));
    }
  }
  return Array.from(new Set(tagList));
}

export function formatPropertyConfigWithTags(
  existingConfig: any,
  tags: string[],
  additionalConfig: Record<string, any> = {}
): string {
  const parsedConfig = parsePropertyConfigurations(existingConfig);
  const cleanTags = (Array.isArray(tags) ? tags : []).map(t => String(t).trim()).filter(Boolean);
  return JSON.stringify({
    ...parsedConfig,
    ...additionalConfig,
    tags: cleanTags
  });
}

