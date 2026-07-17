const ROUTE_SKIP_NAMES = new Set([
  "_app",
  "_document",
  "_error",
  "layout",
  "loading",
  "error",
  "template",
  "not-found",
  "default",
  "global-error",
]);

const PATH_REF_RE =
  /(?:href|to)\s*=\s*["'`]([^"'`#?]+)["'`]|router\.(?:push|replace)\(\s*["'`]([^"'`#?]+)["'`]|redirect\(\s*["'`]([^"'`#?]+)["'`]|["'`](\/[A-Za-z0-9_\-./[\]]*)["'`]/g;

const API_HANDLER_RE =
  /(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete|all|use)\s*\(\s*["'`]([^"'`]+)["'`]|@(?:app|router)\.(?:get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

const CLIENT_API_RE =
  /(?:fetch|axios\.(?:get|post|put|patch|delete)|ky)\s*(?:\(\s*)?["'`]([^"'`]+)["'`]|["'`](\/[A-Za-z0-9_\-./:[\]{}]*)["'`]/g;

export function fileToRoutePath(relativePath: string): string | null {
  const norm = relativePath.replace(/\\/g, "/");

  const pagesMatch = norm.match(/(?:^|\/)pages\/(.+)\.(?:tsx?|jsx?)$/i);
  if (pagesMatch) {
    return nextSegmentToPath(pagesMatch[1]);
  }

  const appPageMatch = norm.match(
    /(?:^|\/)app\/(.+)\/page\.(?:tsx?|jsx?)$/i,
  );
  if (appPageMatch) {
    return nextSegmentToPath(appPageMatch[1]);
  }

  const routesMatch = norm.match(
    /(?:^|\/)routes\/(.+)\.(?:tsx?|jsx?|py)$/i,
  );
  if (routesMatch) {
    const base = routesMatch[1]
      .replace(/\/index$/i, "")
      .replace(/\[[^\]]+\]/g, ":param");
    if (!base || ROUTE_SKIP_NAMES.has(base.split("/").pop() ?? "")) {
      return null;
    }
    return `/${base}`.replace(/\/+/g, "/");
  }

  return null;
}

function nextSegmentToPath(segment: string): string | null {
  const parts = segment.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  if (ROUTE_SKIP_NAMES.has(last) || last.startsWith("_")) {
    return null;
  }

  const cleaned = parts
    .map((part) => {
      if (part === "index") {
        return "";
      }
      if (part.startsWith("[[...") && part.endsWith("]]")) {
        return ":catchAll?";
      }
      if (part.startsWith("[...") && part.endsWith("]")) {
        return ":catchAll";
      }
      if (part.startsWith("[") && part.endsWith("]")) {
        return ":param";
      }
      if (part.startsWith("(") && part.endsWith(")")) {
        return "";
      }
      return part;
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    return "/";
  }
  return `/${cleaned.join("/")}`.replace(/\/+/g, "/");
}

export function fileToApiPath(relativePath: string): string | null {
  const norm = relativePath.replace(/\\/g, "/");
  const appRoute = norm.match(/(?:^|\/)app\/(.+)\/route\.(?:tsx?|jsx?)$/i);
  if (appRoute) {
    const cleaned = appRoute[1]
      .split("/")
      .filter((part) => !(part.startsWith("(") && part.endsWith(")")))
      .map((part) =>
        part.startsWith("[") && part.endsWith("]") ? ":param" : part,
      )
      .filter(Boolean);
    return `/${cleaned.join("/")}`.replace(/\/+/g, "/") || "/";
  }

  const pagesApi = norm.match(/(?:^|\/)pages\/api\/(.+)\.(?:tsx?|jsx?)$/i);
  if (pagesApi) {
    const base = pagesApi[1].replace(/\/index$/i, "");
    return `/api/${base}`.replace(/\/+/g, "/");
  }

  return null;
}

export function extractPathRefs(content: string): Set<string> {
  const refs = new Set<string>();
  PATH_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_REF_RE.exec(content)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (!raw || !raw.startsWith("/")) {
      continue;
    }
    refs.add(normalizeUrlPath(raw));
  }
  return refs;
}

export function extractApiHandlers(
  content: string,
): Array<{ path: string; line: number }> {
  const items: Array<{ path: string; line: number }> = [];
  API_HANDLER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = API_HANDLER_RE.exec(content)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw || !raw.startsWith("/")) {
      continue;
    }
    items.push({
      path: normalizeUrlPath(raw),
      line: lineAt(content, match.index),
    });
  }
  return items;
}

export function extractClientApiRefs(content: string): Set<string> {
  const refs = new Set<string>();
  CLIENT_API_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLIENT_API_RE.exec(content)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw || !raw.startsWith("/")) {
      continue;
    }
    refs.add(normalizeUrlPath(raw));
  }
  return refs;
}

export function extractCssClasses(
  content: string,
): Array<{ name: string; line: number }> {
  const items: Array<{ name: string; line: number }> = [];
  const seen = new Set<string>();
  const source = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("@")) {
      continue;
    }
    const beforeBrace = line.split("{")[0].trim();
    if (!beforeBrace) {
      continue;
    }
    const parts = beforeBrace.split(",");
    const names: string[] = [];
    let allSimple = true;
    for (const part of parts) {
      const trimmed = part.trim();
      if (!/^\.[A-Za-z_][\w-]*$/.test(trimmed)) {
        allSimple = false;
        break;
      }
      names.push(trimmed.slice(1));
    }
    if (!allSimple) {
      continue;
    }
    for (const name of names) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      items.push({ name, line: i + 1 });
    }
  }

  return items;
}

export function pathReferenced(target: string, refs: Set<string>): boolean {
  if (refs.has(target)) {
    return true;
  }
  for (const ref of refs) {
    if (ref === target) {
      return true;
    }
    const pattern = target
      .replace(/:param\?/g, "[^/]*")
      .replace(/:catchAll\?/g, ".*")
      .replace(/:catchAll/g, ".+")
      .replace(/:param/g, "[^/]+");
    if (pattern !== target) {
      try {
        if (new RegExp(`^${pattern}$`).test(ref)) {
          return true;
        }
      } catch {
        // ignore bad pattern
      }
    }
    if (ref.startsWith(`${target}/`) || target.startsWith(`${ref}/`)) {
      return true;
    }
  }
  return false;
}

function normalizeUrlPath(raw: string): string {
  let value = raw.split("?")[0].split("#")[0];
  if (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value.replace(/\/+/g, "/") || "/";
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** ponytail: fixture-only check for route/API/CSS extract. */
export function selfCheckDeadHeuristics(): void {
  const route = fileToRoutePath("src/pages/users/[id].tsx");
  if (route !== "/users/:param") {
    throw new Error(`route map failed: ${route}`);
  }

  const appRoute = fileToRoutePath("app/(marketing)/about/page.tsx");
  if (appRoute !== "/about") {
    throw new Error(`app route map failed: ${appRoute}`);
  }

  const api = fileToApiPath("app/api/users/route.ts");
  if (api !== "/api/users") {
    throw new Error(`api map failed: ${api}`);
  }

  const handlers = extractApiHandlers(
    `app.get('/health', ok);\n@app.post("/v1/items")\ndef create(): pass\n`,
  );
  if (handlers.length !== 2 || handlers[0].path !== "/health") {
    throw new Error(`api handler extract failed: ${JSON.stringify(handlers)}`);
  }

  const classes = extractCssClasses(`
.foo { color: red; }
.bar-baz, .other { }
.a .b { }
@media (min-width: 1px) { .nested {} }
`);
  const names = classes.map((c) => c.name).sort();
  if (names.join(",") !== "bar-baz,foo,other") {
    throw new Error(`css extract failed: ${names.join(",")}`);
  }

  const refs = extractPathRefs(
    `<Link href="/about">; router.push('/users/1');`,
  );
  if (!refs.has("/about") || !refs.has("/users/1")) {
    throw new Error("path refs failed");
  }

  if (!pathReferenced("/users/:param", refs)) {
    throw new Error("dynamic path match failed");
  }
}
