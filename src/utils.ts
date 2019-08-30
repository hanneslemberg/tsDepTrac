import { fold, isLeft } from 'fp-ts/lib/Either';
import { pipe } from 'fp-ts/lib/pipeable';
import * as t from 'io-ts';
import * as ts from 'typescript';
import * as path from 'path';
import { match } from 'minimatch';

export function fromNullable<C extends t.Mixed>(
    codec: C,
    a: t.TypeOf<C>,
    name: string = `fromNullable(${codec.name})`,
): C {
    return withValidate(
        codec,
        (u, c) => (u === undefined ? t.success(a) : codec.validate(u, c)),
        name,
    );
}

function withValidate<C extends t.Any>(
    codec: C,
    validate: C['validate'],
    name: string = codec.name,
): C {
    // tslint:disable
    const r: any = clone(codec);
    r.validate = validate;
    r.decode = (i: any) => validate(i, t.getDefaultContext(r));
    r.name = name;

    return r as C;
    // tslint:enable
}

function clone<C extends t.Any>(type: C): C {
    // tslint:disable
    const r = Object.create(Object.getPrototypeOf(type));
    Object.assign(r, type);

    return r;
    // tslint:enable
}

export function decode<A>(data: unknown, decoder: t.Decoder<unknown, A>): A {
    const decoded = decoder.decode(data);

    function getS(error: t.ValidationError): string {
        const errorPath = error.context
            .map((entry: t.ContextEntry) => {
                if (entry.key) {
                    return entry.key;
                }

                let name = entry.type.name;
                if (name && name.length > 15) {
                    name = name.slice(0, 10) + '...' + name.slice(name.length - 2);
                }

                return name;
            })
            .join('.');
        const sValue = stringify(error.value);
        const lastType = error.context[error.context.length - 1].type.name;

        return 'Error in ' + errorPath + ':' + lastType + ', got ' + sValue;
    }

    if (isLeft(decoded)) {
        const getPaths = <X>(v: t.Validation<X>): string[] =>
            pipe(
                v,
                fold((errors) => errors.map(getS), () => ['no errors']),
            );

        const paths = getPaths(decoded);
        console.error(paths);
        throw new Error(`Errors while decoding. (paths.length): ${paths[0]}`);
    }

    return decoded.right;
}

interface FunctionWithName {
    displayName: string | undefined;
    name: string | undefined;
}

function isFunctionWithName(v: unknown): v is FunctionWithName {
    return typeof v === 'function' && ('displayName' in v || 'name' in v);
}

function stringify(v: unknown): string {
    if (typeof v === 'function') {
        if (isFunctionWithName(v)) {
            return v.displayName !== undefined ? v.displayName : v.name;
        }

        return `<function${v.length}>`;
    }
    if (typeof v === 'number' && !isFinite(v)) {
        if (isNaN(v)) {
            return 'NaN';
        }

        return v > 0 ? 'Infinity' : '-Infinity';
    }

    return JSON.stringify(v);
}

export function fileToPackage(originalPath: string, baseUrl?: string): string {
    const parsed: path.ParsedPath = path.parse(path.normalize(originalPath));

    if (baseUrl && parsed.dir.startsWith(baseUrl)) {
        parsed.dir = parsed.dir.substr(baseUrl.length + 1);
    }

    if (!parsed.dir) {
        return parsed.name;
    }

    return parsed.dir + '/' + parsed.name;
}

export function resolveRelativeImport(
    importedPackage: string,
    importingFile: string,
    baseUrl: string,
): string {
    let resolvedPackage = importedPackage;
    if (resolvedPackage.startsWith("'") && resolvedPackage.endsWith("'")) {
        resolvedPackage = resolvedPackage.substring(1, resolvedPackage.length - 1);
    }

    if (resolvedPackage.indexOf('./') === -1 && resolvedPackage.indexOf('../') === -1) {
        return resolvedPackage;
    }

    resolvedPackage = path.join(path.dirname(importingFile), resolvedPackage);

    if (resolvedPackage.startsWith(baseUrl)) {
        resolvedPackage = resolvedPackage.substring(baseUrl.length + 1);
    }

    return resolvedPackage;
}

export function log(enable: boolean, message?: unknown, ...optionalParams: unknown[]): void {
    if (enable) {
        console.log('depTrac:', message, ...optionalParams);
    }
}

export function isImport(node: ts.Node): boolean {
    return (
        (node.kind === ts.SyntaxKind.BigIntLiteral &&
            node.parent &&
            node.parent.kind === ts.SyntaxKind.NamespaceExportDeclaration) ||
        (node.kind === ts.SyntaxKind.StringLiteral &&
            node.parent &&
            node.parent.kind === ts.SyntaxKind.ImportDeclaration)
    );
}

export function resolvePackageLayer(
    layers: { [x: string]: string[] },
    filePackage: string,
    debug: number,
): string | undefined {
    log(debug > 1, 'resolving ', filePackage, 'against', layers);

    const result = Object.keys(layers).find((layerName: string) =>
        layers[layerName].some((pattern) => {
            log(debug > 2, '.... testing', pattern);

            return (
                match([filePackage], pattern, {
                    debug: debug > 3,
                    matchBase: true,
                    nocase: true,
                }).length > 0
            );
        }),
    );

    log(debug > 1, '.... got', result);

    return result;
}
