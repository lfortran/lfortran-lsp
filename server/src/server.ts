/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	TextDocumentSyncKind,
	InitializeResult,
	SymbolInformation,
	SymbolKind,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import { Position } from 'vscode-languageserver-protocol';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

import fs = require('fs');
import tmp = require('tmp');
// import path = require('path');

import util = require('node:util');
import { TextEncoder } from 'node:util';
// import { Console } from 'console';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const exec = util.promisify(require('node:child_process').exec);

const tmpFile = tmp.fileSync();

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentSymbolProvider: true,
			definitionProvider: true,
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	// console.log('LFortran language server initialized');
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			// connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
	compiler: {
		executablePath: string;
	};
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000, compiler: { executablePath: "/home/dylon/Workspace/lcompilers/lfortran/src/bin/lfortran" } };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDocumentSymbol(async (request) => {
	connection.console.log("onDocumentSymbol");
	const document = documents.get(request.textDocument.uri);
	const settings = await getDocumentSettings(request.textDocument.uri);
	const text = document?.getText();
	const symbols: SymbolInformation[] = [];
	if (typeof text == "string") {
		const stdout = await runCompiler(text, "--show-document-symbols ", settings);
		const obj = JSON.parse(stdout);
		for (let i=0; i<obj.length; i++) {
			if (obj[i].location) {
				const symbol: SymbolInformation = {
					location: {
						uri: request.textDocument.uri,
						range: {
							start: Position.create(obj[i].location.range.start.line, obj[i].location.range.start.character),
							end: Position.create(obj[i].location.range.end.line, obj[i].location.range.end.character),
						},
					},
					kind: SymbolKind.Function,
					name: obj[i].name,
				};
				symbols.push(symbol);	
			}
		}
	}
	// console.log(symbols);
	return symbols;
});

connection.onDefinition(async (request) => {
	console.time('onDefinition');
	const document = documents.get(request.textDocument.uri);
	const settings = await getDocumentSettings(request.textDocument.uri);
	const text = document?.getText();
	const symbols: SymbolInformation[] = [];
	if (typeof text == "string") {
		// console.log("request: ");
		// console.log(request);
		const line = request.position.line + 1;
		const column = request.position.character + 1;

		console.log("line: " + line);
		console.log("column: " + column);

		const stdout = await runCompiler(text, "--lookup-name" + " --line=" + line + " --column=" + column, settings);
		// console.log("got: ", stdout);
		const obj = JSON.parse(stdout);
		for (let i = 0; i < obj.length; i++) {
			if (obj[i].location) {
				return [{
					targetUri: request.textDocument.uri,
					targetRange: {
						start: { line: obj[i].location.range.start.line, character: Math.max(0, obj[i].location.range.start.character - 1) },
						end: { line: obj[i].location.range.end.line, character: obj[i].location.range.end.character }
					},
					targetSelectionRange: {
						start: { line: obj[i].location.range.start.line, character: Math.max(0, obj[i].location.range.start.character - 1) },
						end: { line: obj[i].location.range.end.line, character: obj[i].location.range.end.character }
					},
					originSelectionRange: {
						start: { line: request.position.line, character: Math.max(0, request.position.character) },
						end: { line: request.position.line, character: request.position.character + 4 }
					}
				}];
			}
		}
		console.timeEnd('onDefinition');
		return undefined;
	}
});

connection.onDidChangeConfiguration(change => {
	// console.log("onDidChangeConfiguration, hasConfigurationCapability: " + hasConfigurationCapability);
	// console.log("change is " + JSON.stringify(change));
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.LFortranLanguageServer || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'LFortranLanguageServer'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function throttle(fn: (...args: any) => void, delay: number) {
	let shouldWait = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let waitingArgs: any | null;
	const timeoutFunc = () => {
		if (waitingArgs == null) {
			shouldWait = false;
		} else {
			fn(...waitingArgs);
			waitingArgs = null;
			setTimeout(timeoutFunc, delay);
		}
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (...args: any) => {
		if (shouldWait) {
			waitingArgs = args;
			return;
		}

		fn(...args);
		shouldWait = true;

		setTimeout(timeoutFunc, delay);
	};
}

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((
	() => {
		const throttledValidateTextDocument = throttle(validateTextDocument, 500);
		return (change) => {
			throttledValidateTextDocument(change.document);
		};
	}
)());

async function runCompiler(text: string, flags: string, settings: ExampleSettings): Promise<string> {
	try {
		fs.writeFileSync(tmpFile.name, text);
	} catch (error) {
		console.log(error);
	}
	let stdout: string;
	try {
		const output = await exec(`${settings.compiler.executablePath} ${flags} ${tmpFile.name}`);
		// console.log(output);
		stdout = output.stdout;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		stdout = e.stdout;
		if (e.signal != null) {
			console.log("compile failed: ");
			console.log(e);
		} else {
			console.log("Error:", e);
		}
	}
	return stdout;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	console.time('validateTextDocument');
	if (!hasDiagnosticRelatedInformationCapability) {
		console.error('Trying to validate a document with no diagnostic capability');
		return;
	}
	// // In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);
	// The validator creates diagnostics for all uppercase words length 2 and more
	const text = textDocument.getText();
	const stdout = await runCompiler(text, "--show-errors ", settings);
	const obj = JSON.parse(stdout);
	const diagnostics: Diagnostic[] = [];
	if (obj.diagnostics) {
		const diagnostic: Diagnostic = {
			severity: 2,
			range: {
				start: Position.create(obj.diagnostics[0].range.start.line, obj.diagnostics[0].range.start.character),
				end: Position.create(obj.diagnostics[0].range.end.line, obj.diagnostics[0].range.end.character),
			},
			message: obj.diagnostics[0].message,
			source: "lfortran-lsp"
		};
		diagnostics.push(diagnostic);
	}
	// console.log(diagnostics);
	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	console.timeEnd('validateTextDocument');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
