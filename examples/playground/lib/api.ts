import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/*
 * The API reference, read from the library when the site builds: props, types and descriptions
 * from the published declarations (dist/*.d.ts, what an app's editor sees), defaults from the
 * components' own parameter lists in src/ or, where a list has none (a hook's options) or only
 * names a constant, the props' `@default` tags, and styling hooks from their markup. Only the tags
 * are written by hand, in the library's comments: test/api-descriptions.test.ts checks each against
 * the code that sets it. The API index (getApiIndex) lists every export of every entry point.
 */

// `next build` runs in examples/playground; the library is built first (pnpm build:lib). Everything
// here runs while pages prerender, so the file reads are kept out of the server bundle's tracing.
const KIT = join(process.cwd(), '../../packages/signoff-ui');
const DIST = join(KIT, 'dist');

interface Manifest {
  name: string;
  exports: Record<string, string | { types?: string }>;
}

/** The entry points that have types, in package.json's order: `signoff-ui`, `signoff-ui/core`, … */
function entryPoints() {
  const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ join(KIT, 'package.json'), 'utf8')) as Manifest;
  return Object.entries(manifest.exports).flatMap(([path, target]) =>
    typeof target === 'object' && target.types
      ? [{ name: path === '.' ? manifest.name : `${manifest.name}/${path.slice(2)}`, file: join(KIT, target.types) }]
      : [],
  );
}

export interface PropDoc {
  name: string;
  type: string;
  /** For a union of string literals behind an alias (`RiskLevel`), its members. */
  values?: string[];
  required: boolean;
  defaultValue?: string;
  description: string;
}

export interface InterfaceDoc {
  name: string;
  description: string;
  props: PropDoc[];
  /** The `extends` clause, when the interface takes an element's props or another interface's. */
  extends?: string;
  /** The element whose props pass through to the root, e.g. `section`. */
  element?: string;
  /** Another of the kit's props interfaces this one takes, minus some keys. */
  inherits?: { from: string; except: string[] };
}

export interface AliasDoc {
  name: string;
  /** On one line; a union of string literals spelled out even when written as `ToolPart['state']`. */
  type: string;
  /** As written, for a code block. */
  source: string;
  description: string;
}

let cache:
  | {
      checker: ts.TypeChecker;
      exports: Map<string, ts.Symbol>;
      entryPoints: Array<{ name: string; symbols: ts.Symbol[] }>;
    }
  | undefined;

function load() {
  if (cache) return cache;
  const points = entryPoints();
  const entries = points.map((point) => point.file);
  for (const entry of entries) {
    if (!existsSync(/* turbopackIgnore: true */ entry))
      throw new Error(`${entry} is missing: build the library first (pnpm build:lib).`);
  }
  const program = ts.createProgram(entries, {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
  });
  const checker = program.getTypeChecker();
  // By name, for the component pages: the first entry point's, so `AgentMessage` is the main
  // entry's and not signoff-ui/custom-markdown's.
  const exports = new Map<string, ts.Symbol>();
  const listed = points.map((point) => {
    const module = checker.getSymbolAtLocation(program.getSourceFile(point.file)!);
    const symbols = module ? checker.getExportsOfModule(module) : [];
    for (const symbol of symbols) {
      if (!exports.has(symbol.name)) exports.set(symbol.name, aliased(symbol, checker));
    }
    return { name: point.name, symbols };
  });
  cache = { checker, exports, entryPoints: listed };
  return cache;
}

/** What an export stands for: the declaration a re-export (`export { x } from`) points to. */
function aliased(symbol: ts.Symbol, checker = load().checker) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function exported(name: string) {
  const symbol = load().exports.get(name);
  if (!symbol) throw new Error(`signoff-ui exports no ${name}`);
  return symbol;
}

const docs = (symbol: ts.Symbol) => ts.displayPartsToString(symbol.getDocumentationComment(load().checker)).trim();

/** A prop's `@default` tag, as written: `3` for `@default 3`. */
function defaultTag(symbol: ts.Symbol) {
  const tag = symbol.getJsDocTags(load().checker).find((t) => t.name === 'default');
  return ts.displayPartsToString(tag?.text).trim() || undefined;
}

/** Drop parentheses that wrap the whole type: `((x) => y)` reads as `(x) => y`. */
function unwrap(type: string) {
  if (!type.startsWith('(') || !type.endsWith(')')) return type;
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    if (type[i] === '(') depth++;
    else if (type[i] === ')') depth--;
    if (depth === 0 && i < type.length - 1) return type;
  }
  return type.slice(1, -1);
}

function typeText(declaration: ts.Declaration | undefined, symbol: ts.Symbol) {
  const { checker } = load();
  if (declaration && ts.isMethodSignature(declaration)) {
    const params = declaration.parameters.map((p) => p.getText()).join(', ');
    return `(${params}) => ${declaration.type?.getText() ?? 'void'}`.replace(/\s+/g, ' ');
  }
  const node = declaration && (ts.isPropertySignature(declaration) ? declaration.type : undefined);
  const text = node ? node.getText() : checker.typeToString(checker.getTypeOfSymbol(symbol));
  return unwrap(text.replace(/\s+/g, ' ').replace(/ \| undefined$/, ''));
}

/** The members of a literal union behind an alias, such as `RiskLevel`. */
function literalValues(declaration: ts.Declaration | undefined, symbol: ts.Symbol) {
  if (!declaration || !ts.isPropertySignature(declaration) || !declaration.type) return undefined;
  if (!ts.isTypeReferenceNode(declaration.type)) return undefined;
  const { checker } = load();
  const type = checker.getNonNullableType(checker.getTypeOfSymbol(symbol));
  if (!type.isUnion() || !type.types.every((t) => t.isStringLiteral())) return undefined;
  return type.types.map((t) => `'${(t as ts.StringLiteralType).value}'`);
}

/** Default values from a component's parameter list: `({ risk = 'medium', ... })`. */
export function sourceDefaults(file: string, functions: string[]) {
  const defaults = new Map<string, string>();
  const source = ts.createSourceFile(
    file,
    readFileSync(/* turbopackIgnore: true */ join(KIT, 'src', file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node) => {
    const named =
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name &&
      functions.includes(node.name.text);
    if (named) {
      const pattern = (node as ts.FunctionLikeDeclaration).parameters[0]?.name;
      if (pattern && ts.isObjectBindingPattern(pattern)) {
        for (const element of pattern.elements) {
          if (!element.initializer) continue;
          const key = (element.propertyName ?? element.name).getText();
          if (!defaults.has(key)) defaults.set(key, element.initializer.getText());
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return defaults;
}

const isOwn = (symbol: ts.Symbol) =>
  (symbol.declarations ?? []).some((d) => d.getSourceFile().fileName.startsWith(DIST));

/**
 * An exported interface's own props (not the DOM attributes it inherits), with defaults read from
 * `functions` in `src/<file>`: the component and any it passes its props on to. A prop they give no
 * default to, such as a hook's option, shows its `@default` tag.
 */
export function getInterface(name: string, defaultsFrom?: { file: string; functions: string[] }): InterfaceDoc {
  const { checker } = load();
  const symbol = exported(name);
  const declaration = symbol.declarations?.find(ts.isInterfaceDeclaration);
  const defaults = defaultsFrom ? sourceDefaults(defaultsFrom.file, defaultsFrom.functions) : new Map<string, string>();
  const heritage = declaration?.heritageClauses?.[0]?.types[0]?.getText().replace(/\s+/g, ' ');
  // Extending another of the kit's interfaces (ToolApprovalCardProps from ApprovalCardProps): list
  // only what this one adds, and point at the other. Extending an element's props: list them all.
  const base = heritage && /^Omit<(\w+Props), (.+)>$/.exec(heritage);
  const ownDeclaration = (prop: ts.Symbol) =>
    base ? prop.declarations?.some((d) => d.parent === declaration) : isOwn(prop);
  const props = checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
    .filter((prop) => isOwn(prop) && ownDeclaration(prop))
    .map((prop): PropDoc => {
      const decl = prop.declarations?.[0];
      // The parameter list's default, unless it is only a constant's name (`DEFAULT_DECISIONS`) and
      // the prop's @default spells it out.
      const listed = defaults.get(prop.name);
      const tagged = defaultTag(prop);
      const defaultValue = listed && !(tagged && /^[A-Z][A-Z0-9_]*$/.test(listed)) ? listed : tagged;
      let description = docs(prop);
      // The default column says it already.
      if (defaultValue)
        description = description.replace(/\s*Defaults? (?:to )?(?:`[^`]+`|"[^"]+"|\d+)(?:\.|$)/, '').trim();
      return {
        name: prop.name,
        type: typeText(decl, prop),
        values: literalValues(decl, prop),
        required: !(prop.flags & ts.SymbolFlags.Optional),
        defaultValue,
        description,
      };
    })
    // Required props first, otherwise in the order they're declared.
    .sort((a, b) => Number(b.required) - Number(a.required));
  const element = heritage && /ComponentPropsWithoutRef<'(\w+)'>/.exec(heritage)?.[1];
  const inherits = base
    ? { from: base[1]!, except: [...base[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!) }
    : undefined;
  return { name, description: docs(symbol), props, extends: heritage, element, inherits };
}

/** An exported type alias, as written. */
export function getAlias(name: string): AliasDoc {
  const symbol = exported(name);
  const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
  const written = declaration ? declaration.type.getText() : name;
  const resolved = load().checker.getDeclaredTypeOfSymbol(symbol);
  const literals =
    resolved.isUnion() && resolved.types.every((t) => t.isStringLiteral())
      ? resolved.types.map((t) => `'${(t as ts.StringLiteralType).value}'`).join(' | ')
      : undefined;
  return {
    name,
    type: literals ?? written.replace(/\s+/g, ' '),
    source: `type ${name} = ${literals ?? written};`,
    description: docs(symbol),
  };
}

/** A component or hook's own description, from its JSDoc. */
export function getDescription(name: string) {
  return docs(exported(name));
}

/** A function's signature, as an app's editor shows it: `useAgUiAgent(agent: AgUiAgentLike): UseAgUiAgentResult`. */
export function getSignature(name: string) {
  const { checker } = load();
  const symbol = exported(name);
  const [signature] = checker.getSignaturesOfType(checker.getTypeOfSymbol(symbol), ts.SignatureKind.Call);
  return signature ? `${name}${checker.signatureToString(signature)}` : name;
}

/** Styling hooks in a component's markup: its `data-slot`s, state attributes and the tokens its classes use. */
export function getStylingHooks(file: string) {
  const source = readFileSync(/* turbopackIgnore: true */ join(KIT, 'src', file), 'utf8');
  const slots = [...new Set([...source.matchAll(/data-slot="([a-z-]+)"/g)].map((m) => m[1]!))];
  // The slot each state attribute sits on: the last data-slot written before it, in the same tag.
  const slotOf: Record<string, string> = {};
  for (const match of source.matchAll(/\b(data-(?!slot\b|signoff)[a-z-]+)=[{"]/g)) {
    const before = source.slice(Math.max(0, match.index - 400), match.index);
    const tag = before.slice(before.lastIndexOf('<'));
    const slot = [...tag.matchAll(/data-slot="([a-z-]+)"/g)].at(-1)?.[1];
    if (slot && !slotOf[match[1]!]) slotOf[match[1]!] = slot;
  }
  const states = [...new Set([...source.matchAll(/\b(data-(?!slot\b|signoff)[a-z-]+)=[{"]/g)].map((m) => m[1]!))];
  const tokens = new Set<string>();
  for (const [, name] of source.matchAll(
    /\b(?:bg|text|border|outline|from|to|via|divide|ring|fill|stroke|decoration|shadow)-signoff-([a-z0-9-]+)/g,
  )) {
    tokens.add(TOKEN_ALIASES[name!] ?? `--signoff-${name}`);
  }
  if (/\brounded-signoff\b/.test(source)) tokens.add('--signoff-radius');
  if (/\bfont-signoff-sans\b/.test(source)) tokens.add('--signoff-font-sans');
  if (/\bfont-signoff-mono\b/.test(source)) tokens.add('--signoff-font-mono');
  return { slots, states, slotOf, tokens: [...tokens].sort() };
}

// Utility names that don't match their variable one to one (lib/styles/tokens.css).
const TOKEN_ALIASES: Record<string, string> = {
  add: '--signoff-add-bg',
  del: '--signoff-del-bg',
};

export type TypeDoc = ({ kind: 'interface' } & InterfaceDoc) | ({ kind: 'alias' } & AliasDoc);

/** An exported type, whichever kind it is: an interface's members, or an alias as written. */
export function getType(name: string): TypeDoc {
  const symbol = exported(name);
  return symbol.declarations?.some(ts.isInterfaceDeclaration)
    ? { kind: 'interface', ...getInterface(name) }
    : { kind: 'alias', ...getAlias(name) };
}

export type ExportKind = 'component' | 'hook' | 'function' | 'constant' | 'interface' | 'type';

export interface ExportDoc {
  name: string;
  kind: ExportKind;
  /** As the published declarations have it, without comments: one line per overload, or a type's body. */
  declaration: string;
  description: string;
}

export interface EntryPointDoc {
  /** As an app imports it: `signoff-ui/core`. */
  name: string;
  /** What is listed under this entry point, components first and types last. */
  exports: ExportDoc[];
  /** What it exports too, listed under another entry point. */
  shared: Array<{ name: string; entryPoint: string }>;
}

/** The order of the groups on the page: interfaces and type aliases are one group. */
const KIND_RANK: Record<ExportKind, number> = {
  component: 0,
  hook: 1,
  function: 2,
  constant: 3,
  interface: 4,
  type: 4,
};

function kindOf(symbol: ts.Symbol): ExportKind {
  const { checker } = load();
  if (symbol.flags & ts.SymbolFlags.Interface) return 'interface';
  if (!(symbol.flags & ts.SymbolFlags.Value)) return 'type';
  const callable = checker.getSignaturesOfType(checker.getTypeOfSymbol(symbol), ts.SignatureKind.Call).length > 0;
  if (!callable) return 'constant';
  if (/^use[A-Z]/.test(symbol.name)) return 'hook';
  return /^[A-Z]/.test(symbol.name) ? 'component' : 'function';
}

const printer = ts.createPrinter({ removeComments: true });

/**
 * A declaration as the .d.ts has it, minus `export declare`, comments and `import("react").`
 * qualifiers. A destructured parameter reads as `props` (`options` for a function that is not a
 * component), as an editor's hover shows it, rather than every prop's name.
 */
function declarationOf(symbol: ts.Symbol) {
  const parameter = /^[A-Z]/.test(symbol.name) ? 'props' : 'options';
  return (symbol.declarations ?? [])
    .map((declaration) =>
      printer
        .printNode(
          ts.EmitHint.Unspecified,
          ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration,
          declaration.getSourceFile(),
        )
        .replace(/^export /, '')
        .replace(/^declare /, '')
        .replace(/\bimport\("[^"]+"\)\./g, '')
        .replace(/\{ (?:\.\.\.)?\w+(?:: \w+)?(?:, (?:\.\.\.)?\w+(?:: \w+)?)* \}(?=\??: )/g, parameter),
    )
    .join('\n');
}

/**
 * Every export of every entry point, read from the published declarations. An export more than one
 * entry point has is listed once: under signoff-ui/core when it is there (the main entry re-exports
 * all of core, and signoff-ui/acp core's ACP permission helpers), otherwise under the first entry
 * point in package.json's order; the others name it in `shared`.
 */
export function getApiIndex(): EntryPointDoc[] {
  const { entryPoints: points } = load();
  const core = points.find((point) => point.name.endsWith('/core'));
  const byPriority = core ? [core, ...points.filter((point) => point !== core)] : points;
  const home = new Map<ts.Symbol, string>();
  for (const point of byPriority) {
    for (const symbol of point.symbols) {
      const target = aliased(symbol);
      if (!home.has(target)) home.set(target, point.name);
    }
  }
  return points.map((point) => {
    const own: ExportDoc[] = [];
    const shared: EntryPointDoc['shared'] = [];
    for (const symbol of point.symbols) {
      const target = aliased(symbol);
      const entryPoint = home.get(target)!;
      if (entryPoint !== point.name) {
        shared.push({ name: symbol.name, entryPoint });
        continue;
      }
      own.push({
        name: symbol.name,
        kind: kindOf(target),
        declaration: declarationOf(target),
        description: docs(target),
      });
    }
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    own.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || byName(a, b));
    shared.sort(byName);
    return { name: point.name, exports: own, shared };
  });
}
