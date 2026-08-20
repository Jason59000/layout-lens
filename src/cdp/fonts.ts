import type CDP from "chrome-remote-interface";

export interface PlatformFont {
  familyName: string;
  postScriptName: string;
  glyphCount: number;
}

export async function getPlatformFonts(
  client: CDP.Client,
  nodeId: number,
): Promise<PlatformFont[]> {
  const result = await (client.CSS as any).getPlatformFontsForNode({ nodeId });
  if (!result.fonts || result.fonts.length === 0) return [];
  return result.fonts.map((f: any) => ({
    familyName: f.familyName,
    postScriptName: f.postScriptName || "",
    glyphCount: f.glyphCount,
  }));
}
