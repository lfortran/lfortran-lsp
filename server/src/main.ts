import {
  _Connection,
  createConnection,
  ProposedFeatures,
  TextDocuments,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  LFortranAccessor,
  LFortranCLIAccessor
} from './lfortran-accessors';

import { LFortranLanguageServer } from './lfortran-language-server';

const lfortran: LFortranAccessor = new LFortranCLIAccessor();

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection: _Connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const server = new LFortranLanguageServer(lfortran, connection, documents);

connection.onInitialize(server.onInitialize.bind(server));
connection.onInitialized(server.onInitialized.bind(server));
connection.onDocumentSymbol(server.onDocumentSymbol.bind(server));
connection.onDefinition(server.onDefinition.bind(server));
connection.onDidChangeConfiguration(server.onDidChangeConfiguration.bind(server));
// connection.onDidChangeWatchedFiles(server.onDidChangeWatchedFiles.bind(server));
connection.onCompletion(server.onCompletion.bind(server));
connection.onCompletionResolve(server.onCompletionResolve.bind(server));
connection.onHover(server.onHover.bind(server));
connection.onRenameRequest(server.onRenameRequest.bind(server));
connection.onDocumentHighlight(server.onDocumentHighlight.bind(server));

documents.onDidClose(server.onDidClose.bind(server));
documents.onDidChangeContent(server.onDidChangeContent.bind(server));

// Make the text document manager listen on the connection for open, change and
// close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
