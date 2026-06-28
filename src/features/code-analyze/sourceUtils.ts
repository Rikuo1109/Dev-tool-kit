export function scriptContent(content: string, filePath: string): string {
  if (!filePath.endsWith(".vue")) {
    return content;
  }
  const blocks = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  return blocks?.join("\n") ?? content;
}

export function countLoc(content: string): number {
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

export function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export interface CodeBlock {
  startLine: number;
  endLine: number;
  text: string;
}

export function extractCodeBlocks(source: string, filePath: string): CodeBlock[] {
  if (filePath.endsWith(".py")) {
    return extractPythonBlocks(source);
  }
  if (filePath.endsWith(".java")) {
    return extractJavaBlocks(source);
  }
  return extractBraceBlocks(source);
}

export function extractPythonBlocks(source: string): CodeBlock[] {
  const lines = source.split("\n");
  const blocks: CodeBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)(?:async\s+)?(?:def|class)\s+(\w+)/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const startLine = i + 1;
    let endLine = startLine;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next.trim()) {
        endLine = j + 1;
        continue;
      }

      const nextIndent = next.match(/^(\s*)/)?.[1].length ?? 0;
      if (nextIndent <= indent) {
        break;
      }
      endLine = j + 1;
    }

    blocks.push({
      startLine,
      endLine,
      text: lines.slice(i, endLine).join("\n"),
    });
  }

  return dedupeBlocks(blocks);
}

export function extractJavaBlocks(source: string): CodeBlock[] {
  const openers = [
    /(?:^|\n)\s*(?:@[\w().,\s"=]+\s+)*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:<[^>]+>\s+)?[\w\[\].,\s<>?]+\s+\w+\s*\([^{;]*\)\s*\{/g,
    /(?:^|\n)\s*(?:@[\w().,\s"=]+\s+)*[\w\[\].,\s<>?]+\s+\w+\s*\([^{;]*\)\s*\{/g,
  ];

  const starts = new Set<number>();
  for (const pattern of openers) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const braceIndex = source.indexOf("{", match.index);
      if (braceIndex >= 0) {
        starts.add(braceIndex);
      }
    }
  }

  const blocks: CodeBlock[] = [];
  for (const braceIndex of [...starts].sort((a, b) => a - b)) {
    const block = readBraceBlock(source, braceIndex);
    if (block) {
      blocks.push(block);
    }
  }

  return dedupeBlocks(blocks);
}

export function extractBraceBlocks(source: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const openers = [
    /export\s+(?:async\s+)?function\s+\w+/g,
    /(?:^|\s)(?:async\s+)?function\s+\w+/g,
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|\()/g,
    /(?:^|\s)(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g,
    /(?:^|\s)\w+\s*\([^)]*\)\s*\{/g,
    /(?:^|\s)(?:public|private|protected|static|async)\s+\w+\s*\([^)]*\)\s*\{/g,
  ];

  const starts = new Set<number>();
  for (const pattern of openers) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const braceIndex = source.indexOf("{", match.index);
      if (braceIndex >= 0) {
        starts.add(braceIndex);
      }
    }
  }

  for (const braceIndex of [...starts].sort((a, b) => a - b)) {
    const block = readBraceBlock(source, braceIndex);
    if (block) {
      blocks.push(block);
    }
  }

  return dedupeBlocks(blocks);
}

function readBraceBlock(source: string, openBrace: number): CodeBlock | undefined {
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const text = source.slice(openBrace, i + 1);
        return {
          startLine: lineAt(source, openBrace),
          endLine: lineAt(source, i),
          text,
        };
      }
    }
  }
  return undefined;
}

function dedupeBlocks(blocks: CodeBlock[]): CodeBlock[] {
  const seen = new Set<string>();
  const unique: CodeBlock[] = [];
  for (const block of blocks.sort((a, b) => a.startLine - b.startLine)) {
    const key = `${block.startLine}:${block.endLine}:${block.text.length}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(block);
  }
  return unique;
}

export function stripComments(code: string, filePath?: string): string {
  if (filePath?.endsWith(".py")) {
    return code
      .replace(/"""[\s\S]*?"""/g, "")
      .replace(/'''[\s\S]*?'''/g, "")
      .replace(/#.*$/gm, "");
  }

  if (filePath?.endsWith(".java")) {
    return code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

export function exactNormalize(code: string, filePath?: string): string {
  return stripComments(code, filePath).replace(/\s+/g, " ").trim();
}

export function structuralNormalize(code: string, filePath?: string): string {
  return stripComments(code, filePath)
    .replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])*'|`(\\.|[^`\\])*`/g, "STR")
    .replace(/\b\d+\.?\d*\b/g, "NUM")
    .replace(/\b[a-zA-Z_$][\w$]*/g, "ID")
    .replace(/\s+/g, " ")
    .trim();
}

export function blockLineCount(block: CodeBlock): number {
  return block.text.split("\n").filter((line) => line.trim().length > 0).length;
}

export function previewLines(text: string, maxLines = 3): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}
