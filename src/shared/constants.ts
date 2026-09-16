export const JS_SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,vue}';
export const ANALYZE_SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,py,java}';
/** @deprecated Use JS_SOURCE_GLOB for JS-only tools. */
export const SOURCE_GLOB = JS_SOURCE_GLOB;
export const EXCLUDE_GLOB = '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}';
