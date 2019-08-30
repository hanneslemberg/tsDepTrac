// tslint:disable:file-name-casing max-file-line-count
import * as ts from 'typescript';
import { IRuleMetadata, RuleFailure, WalkContext } from 'tslint';
import * as t from 'io-ts';
import { TypedRule } from 'tslint/lib/language/rule/typedRule';
import { match } from 'minimatch';
// noinspection TypeScriptPreferShortImport necessary as import paths in tslint are different then intellij thinks
import {
    decode,
    fileToPackage,
    fromNullable,
    isImport,
    log,
    resolvePackageLayer,
    resolveRelativeImport,
} from './utils';

interface Options {
    layers: { [x: string]: string[] };
    rules: { [x: string]: string[] };
    excluded: string[];
    debug: number;
    filePackage: string;
    layer: string | undefined;
    baseUrl: string;
}

export class Rule extends TypedRule {
    public static metadata: IRuleMetadata = {
        ruleName: 'fences',
        type: 'maintainability',
        description: '',
        optionsDescription: '',
        options: undefined,
        hasFix: false,
        typescriptOnly: true,
        requiresTypeInfo: true,
    };

    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): RuleFailure[] {
        const baseUrl = program.getCompilerOptions().baseUrl;

        if (baseUrl === undefined) {
            console.error('baseUrl in compiler options undefined. This case is not handled');

            return [];
        }

        const filePackage = fileToPackage(
            sourceFile.fileName,
            program.getCompilerOptions().baseUrl,
        );
        const optionsDecoder: t.Decoder<unknown, Options> = t
            .type(
                {
                    layers: fromNullable(t.record(t.string, t.array(t.string)), {}),
                    rules: fromNullable(t.record(t.string, t.array(t.string)), {}),
                    excluded: fromNullable(t.array(t.string), []),
                    debug: fromNullable(t.number, 0),
                    filePackage: t.literal(filePackage),
                    layer: t.undefined,
                    baseUrl: t.literal(baseUrl),
                },
                'fencesRule',
            )
            .asDecoder();

        let options: Options;
        try {
            options = decode(this.getOptions().ruleArguments[0], optionsDecoder);
        } catch (err) {
            console.error('Invalid arguments for fences', err);

            return [];
        }

        // validate config
        const layerNames: string[] = Object.keys(options.layers);
        let usedNames: string[] = Object.keys(options.rules);
        usedNames = usedNames.concat(
            ...Object.keys(options.rules).map((layer) => options.rules[layer]),
        );

        if (usedNames.some((l) => !layerNames.includes(l))) {
            console.error(
                'Layer used in rules, but not defined in layers',
                new Set(usedNames.filter((l) => !layerNames.includes(l))),
            );

            return [];
        }

        if (
            options.excluded.some(
                (excludedPattern) =>
                    match([filePackage], excludedPattern, {
                        debug: options.debug > 3,
                        matchBase: true,
                        nocase: true,
                    }).length > 0,
            )
        ) {
            log(
                options.debug > 0,
                'Skipping',
                sourceFile.fileName,
                'in package',
                filePackage,
                ' because it was excluded',
            );

            return [];
        }

        const packageLayer = resolvePackageLayer(options.layers, filePackage, options.debug);

        options.filePackage = filePackage;
        options.layer = packageLayer;

        return this.applyWithFunction(sourceFile, walk, options);
    }
}

function walk(ctx: WalkContext<Options>): void {
    let aborted = false;
    ctx.sourceFile.forEachChild(
        (function cb(parentKind: string): (node: ts.Node) => void {
            return (node: ts.Node): void => {
                if (aborted) {
                    return;
                }
                if (!ctx.options.layer) {
                    const msg = `File not found in layers config and was not excluded. (${ctx.options.filePackage})`;
                    ctx.addFailureAt(node.getStart(ctx.sourceFile), node.getEnd(), msg);
                    aborted = true;

                    return;
                }

                if (isImport(node)) {
                    const importedPackage = resolveRelativeImport(
                        node.getText(),
                        ctx.sourceFile.fileName,
                        ctx.options.baseUrl,
                    );
                    log(
                        ctx.options.debug > 1,
                        ctx.options.filePackage,
                        'found import',
                        importedPackage,
                    );
                    const importedLayer = resolvePackageLayer(
                        ctx.options.layers,
                        importedPackage,
                        ctx.options.debug,
                    );

                    if (!importedLayer) {
                        const msg = `${importedPackage} not matched to any layer`;
                        ctx.addFailureAt(node.getStart(ctx.sourceFile), node.getEnd(), msg);

                        return;
                    }

                    if (importedLayer === ctx.options.layer) {
                        // imports in same layer are always allowed
                        return;
                    }

                    const allowedLayers = ctx.options.rules[ctx.options.layer];
                    log(
                        ctx.options.debug > 1,
                        'tested: ',
                        ctx.options.filePackage,
                        ' it imported ',
                        importedPackage,
                        'from layer',
                        importedLayer,
                        'allowed:',
                        allowedLayers,
                    );

                    if (!allowedLayers || !allowedLayers.includes(importedLayer)) {
                        const msg = `'${ctx.options.layer}' is not allowed to import '${importedLayer}' (${importedPackage})`;
                        ctx.addFailureAt(node.getStart(ctx.sourceFile), node.getEnd(), msg);

                        return;
                    }
                }

                log(
                    ctx.options.debug > 4,
                    parentKind + ':' + String(node.kind),
                    node.getFullText(ctx.sourceFile),
                );
                node.forEachChild(cb(parentKind + ':' + String(node.kind)));
            };
        })(''),
    );
}
