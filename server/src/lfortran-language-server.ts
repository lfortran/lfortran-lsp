/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import fs from 'fs';

import path from 'path';

import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  _Connection,
  DefinitionLink,
  DefinitionParams,
  Diagnostic,
  DidChangeConfigurationNotification,
  DidChangeConfigurationParams,
  DocumentHighlight,
  DocumentHighlightParams,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  InitializedParams,
  InitializeParams,
  InitializeResult,
  Location,
  Position,
  Range,
  RenameParams,
  SymbolInformation,
  SymbolKind,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { LFortranSettings } from './lfortran-types';

import { LFortranAccessor } from './lfortran-accessors';

import { PrefixTrie } from './prefix-trie';

import {
  Logger,
  makeLoggable,
} from './logger';

import {
  BugReportProvider,
  ExtractDefinitionBugReportProvider,
  RenameSymbolBugReportProvider,
} from './bug-report-provider';

// The global settings, used when the `workspace/configuration` request is not
// supported by the client. Please note that this is not the case when using
// this server with the client provided in this example but could happen with
// other clients.
const defaultSettings: LFortranSettings = {
  maxNumberOfProblems: 100,
  compiler: {
    lfortranPath: "lfortran",
  },
  log: {
    level: "info",
    benchmark: false,
    filter: "",
  },
};

const symbolKindToCompletionItemKind: Map<SymbolKind, CompletionItemKind> = new Map([
  [SymbolKind.File, CompletionItemKind.File],
  [SymbolKind.Module, CompletionItemKind.Module],
  [SymbolKind.Namespace, undefined],
  [SymbolKind.Package, undefined],
  [SymbolKind.Class, CompletionItemKind.Class],
  [SymbolKind.Method, CompletionItemKind.Method],
  [SymbolKind.Property, CompletionItemKind.Property],
  [SymbolKind.Field, CompletionItemKind.Field],
  [SymbolKind.Constructor, CompletionItemKind.Constructor],
  [SymbolKind.Enum, CompletionItemKind.Enum],
  [SymbolKind.Interface, CompletionItemKind.Interface],
  [SymbolKind.Function, CompletionItemKind.Function],
  [SymbolKind.Variable, CompletionItemKind.Variable],
  [SymbolKind.Constant, CompletionItemKind.Constant],
  [SymbolKind.String, undefined],
  [SymbolKind.Number, undefined],
  [SymbolKind.Boolean, undefined],
  [SymbolKind.Array, undefined],
  [SymbolKind.Object, undefined],
  [SymbolKind.Key, undefined],
  [SymbolKind.Null, undefined],
  [SymbolKind.EnumMember, CompletionItemKind.EnumMember],
  [SymbolKind.Struct, CompletionItemKind.Struct],
  [SymbolKind.Event, CompletionItemKind.Event],
  [SymbolKind.Operator, CompletionItemKind.Operator],
  [SymbolKind.TypeParameter, CompletionItemKind.TypeParameter],
]);

const RE_IDENTIFIABLE: RegExp = /^[a-z0-9_]$/i;
const RE_ALPHABETIC: RegExp = /^[a-z]$/i;
const RE_ALPHA_UNDER: RegExp = /^[a-z_]$/i;
const RE_QUOTE: RegExp = /['"]/;

interface FileCacheEntry {
  mtime: Date;
  text: string;
  path: string;
}

export class LFortranLanguageServer {
  public lfortran: LFortranAccessor;
  public connection: _Connection;
  public documents: TextDocuments<TextDocument>;
  public logger: Logger;

  public hasConfigurationCapability: boolean = false;
  public hasWorkspaceFolderCapability: boolean = false;
  public hasDiagnosticRelatedInformationCapability: boolean = false;

  public settings: LFortranSettings;

  // Cache the settings of all open documents
  public documentSettings: Map<string, Thenable<LFortranSettings>> = new Map();

  public dictionaries = new Map<string, PrefixTrie>();

  public hasError: boolean = false;
  public bugReportProvider: BugReportProvider | null = null;

  public fileCache: Map<string, FileCacheEntry> = new Map();

  constructor(lfortran: LFortranAccessor,
              connection: _Connection,
              documents: TextDocuments<TextDocument>,
              logger: Logger,
              settings: LFortranSettings = defaultSettings) {
    const fnid: string = "constructor";
    const start: number = performance.now();

    this.lfortran = lfortran;
    this.connection = connection;
    this.documents = documents;
    this.logger = logger;
    this.settings = settings;

    logger.configure(settings);
    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "lfortran", lfortran,
          "connection", connection,
          "documents", documents,
          "logger", logger,
          "settings", settings,
        ]
      );
    }
  }

  reportBug(title: string, body: string): void {
    this.logDebug("Reporting a bug; title = \"%s\"\n%s", title, body);
    this.connection.sendRequest("LFortranLanguageServer.action.openIssueReporter", {
      issueType: 0,  // IssueType.Bug
      issueSource: "extension",  // IssueSource.Extension
      extensionId: "lcompilers.lfortran-lsp",
      issueTitle: title,
      issueBody: body,
    });
  }

  onInitialize(params: InitializeParams): InitializeResult {
    const fnid: string = "onInitialize";
    const start: number = performance.now();

    const capabilities = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    this.hasConfigurationCapability = !!(
      capabilities.workspace && !!capabilities.workspace.configuration
    );
    this.hasWorkspaceFolderCapability = !!(
      capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    this.hasDiagnosticRelatedInformationCapability = !!(
      capabilities.textDocument &&
      capabilities.textDocument.publishDiagnostics &&
      capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
      capabilities: {
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: ["0","1","2","3","4","5","6","7","8","9","_"],
        },
        definitionProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        hoverProvider: true,
        renameProvider: true,
        textDocumentSync: TextDocumentSyncKind.Incremental,
      }
    };

    if (this.hasWorkspaceFolderCapability) {
      result.capabilities.workspace = {
        workspaceFolders: {
          supported: true
        }
      };
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "params", params,
        ],
        result
      );
    }
    return result;
  }

  onInitialized(params: InitializedParams): void {
    const fnid: string = "onInitialized";
    const start: number = performance.now();

    if (this.hasConfigurationCapability) {
      // Register for all configuration changes.
      this.connection.client
        .register(DidChangeConfigurationNotification.type, undefined);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "params", params,
        ]
      );
    }
  }

  async extractDefinition(location: Location, resolved?: Map<string, string>): Promise<string | null> {
    const fnid: string = "extractDefinition";
    const start: number = performance.now();

    let definition: string | null = null;

    const uri: string = location.uri;
    const document = this.documents.get(uri);
    let text = document?.getText();
    if (text === undefined) {
      let filePath: string = uri;
      if (filePath.startsWith("file://")) {
        filePath = filePath.substring(7);
      }
      if (!fs.existsSync(filePath)) {
        let resolution: string | undefined = resolved?.get(filePath);
        if (resolution === undefined) {
          for (const flag of this.settings.compiler.flags) {
            if (flag.startsWith("-I")) {
              const includeDir = flag.substring(2);
              resolution = path.join(includeDir, filePath);
              if (fs.existsSync(resolution)) {
                resolution = fs.realpathSync(resolution);
                resolved?.set(filename, resolution);
                filePath = resolution;
                break;
              }
            }
          }
        } else {
          filePath = resolution;
        }
      }
      if (fs.existsSync(filePath)) {
        let entry = this.fileCache.get(filePath);
        const stats = fs.statSync(filePath);
        if ((entry === undefined) || (entry.mtime !== stats.mtime)) {
          text = fs.readFileSync(filePath, 'utf8');
          entry = {
            mtime: stats.mtime,
            text: text,
            path: filePath,
          };
          this.fileCache.set(filePath, entry);
        } else {
          text = entry.text;
        }
      } else {
        this.logWarn("Failed to find file by URI: %s", uri);
      }
    }

    if (text !== undefined) {
      const range: Range = location.range;

      const start: Position = range.start;
      const startLine: number = start.line;
      const startCol: number = start.character;

      const end: Position = range.end;
      const endLine: number = end.line;
      const endCol: number = end.character;

      let currLine = 0;
      let currCol = 0;

      for (let i = 0, k = text.length; i < k; i++) {
        let c: string;
        if ((currLine === startLine) && (currCol === startCol)) {
          let j = i;
          for (; ((currLine < endLine) || ((currLine === endLine) && (currCol <= endCol))) && (j < k); j++) {
            c = text[j];
            switch (c) {
              case '\r': {
                const l = j + 1;
                if ((l < k) && (text[l] === '\n')) {
                  j = l;
                }
                // fallthrough
              }
              case '\n': {
                currLine++;
                currCol = 0;
                break;
              }
              default: {
                currCol++;
              }
            }
          }
          if ((currLine < endLine) || ((currLine === endLine) && (currCol < endCol))) {
            const provider: BugReportProvider =
              new ExtractDefinitionBugReportProvider(location, text);
            const version: string = await this.lfortran.version(this.settings);
            const title: string = provider.getTitle();
            const body: string = provider.getBody({ version });
            this.reportBug(title, body);
          } else {
            definition = text.substring(i, j);
          }
          break;
        } else {
          c = text[i];
          switch (c) {
            case '\r': {
              const j = i + 1;
              if ((j < k) && (text[j] === '\n')) {
                i = j;
              }
              // fallthrough
            }
            case '\n': {
              currLine++;
              currCol = 0;
              break;
            }
            default: {
              currCol++;
            }
          }
        }
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "location", location,
        ],
        definition
      );
    }
    return definition;
  }

  async index(uri: string, symbols: SymbolInformation[]): Promise<void> {
    const fnid: string = "index";
    const start: number = performance.now();

    // (symbols.length == 0) => error with document, but we still need to
    // support auto-completion.
    const terms: string[] = [];
    const values: CompletionItem[][] = [];
    const visited: Map<string, CompletionItem[]> = new Map();
    const resolved: Map<string, string> = new Map();
    for (let i = 0, k = symbols.length; i < k; i++) {
      const symbol: SymbolInformation = symbols[i];
      const definition: string | null =
        await this.extractDefinition(symbol.location, resolved);
      let candidates: CompletionItem[] | undefined = visited.get(symbol.name);
      if (candidates === undefined) {
        candidates = [];
        visited.set(symbol.name, candidates);
        terms.push(symbol.name);
        values.push(candidates);
      }
      const kind: CompletionItemKind =
        symbolKindToCompletionItemKind.get(symbol.kind);
      candidates.push({
        label: symbol.name,
        kind: kind,
        detail: definition,
      });
    }
    // TODO: Consider indexing temporary file by URI.
    const dictionary = PrefixTrie.from(terms, values);
    this.dictionaries.set(uri, dictionary);

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "uri", uri,
          "symbols", symbols,
        ]
      );
    }
  }

  async onDocumentSymbol(request: DocumentSymbolParams): Promise<SymbolInformation[] | null> {
    const fnid: string = "onDocumentSymbol";
    const start: number = performance.now();

    let symbols: SymbolInformation[] | null = null;
    const uri = request.textDocument.uri;
    this.settings = await this.getDocumentSettings(uri);
    this.logger.configure(this.settings);
    const document = this.documents.get(uri);
    const text = document?.getText();
    if (typeof text === "string") {
      symbols =
        await this.lfortran.showDocumentSymbols(uri, text, this.settings);
      if (symbols.length > 0) {
        // (symbols.length == 0) => error with document, but we still need to
        // support auto-completion.
        await this.index(uri, symbols);
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "request", request,
        ],
        symbols
      );
    }

    return symbols;
  }

  async onDefinition(request: DefinitionParams): Promise<DefinitionLink[] | null> {
    const fnid: string = "onDefinition";
    const start: number = performance.now();

    let definitions: DefinitionLink[] | null = null;
    const uri = request.textDocument.uri;
    this.settings = await this.getDocumentSettings(uri);
    this.logger.configure(this.settings);
    const document = this.documents.get(uri);
    if (document !== undefined) {
      const text = document.getText();
      const line = request.position.line;
      const column = request.position.character;
      definitions =
        await this.lfortran.lookupName(uri, text, line, column, this.settings);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "request", request,
        ],
        definitions
      );
    }

    return definitions;
  }

  onDidChangeConfiguration(change: DidChangeConfigurationParams): void {
    const fnid: string = "onDidChangeConfiguration";
    const start: number = performance.now();

    if (this.hasConfigurationCapability) {
      // Reset all cached document settings
      this.documentSettings.clear();
    } else {
      this.settings = <LFortranSettings>(
        (change.settings.LFortranLanguageServer || defaultSettings)
      );
      this.logger.configure(this.settings);
    }

    // Revalidate all open text documents
    this.documents.all().forEach(this.validateTextDocument.bind(this));

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "change", change,
        ]
      );
    }
  }

  getDocumentSettings(uri: string): Thenable<LFortranSettings> {
    const fnid: string = "getDocumentSettings";
    const start: number = performance.now();

    if (!this.hasConfigurationCapability) {
      if (this.logger.isBenchmarkOrTraceEnabled()) {
        this.logBenchmarkAndTrace(
          fnid, start,
          [
            "uri", uri,
          ],
          this.settings
        );
      }
      return Promise.resolve(this.settings);
    }

    let settings: Thenable<LFortranSettings> | undefined =
      this.documentSettings.get(uri);

    if (settings === undefined) {
      settings = this.connection.workspace.getConfiguration({
        scopeUri: uri,
        section: 'LFortranLanguageServer'
      });
      this.documentSettings.set(uri, settings);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "uri", uri,
        ],
        settings
      );
    }
    return settings;
  }

  // Only keep settings for open documents
  onDidClose(event: TextDocumentChangeEvent<TextDocument>): void {
    const fnid: string = "onDidClose";
    const start: number = performance.now();

    this.documentSettings.delete(event.document.uri);

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "event", event,
        ]
      );
    }
  }

  onDidChangeContent(event: TextDocumentChangeEvent<TextDocument>): void {
    const fnid: string = "onDidChangeContent";
    const start: number = performance.now();

    this.validateTextDocument(event.document);

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "event", event,
        ]
      );
    }
  }

  async validateTextDocument(textDocument: TextDocument): Promise<void> {
    const fnid: string = "validateTextDocument";
    const start: number = performance.now();

    if (this.hasDiagnosticRelatedInformationCapability) {
      const uri = textDocument.uri;
      this.settings = await this.getDocumentSettings(uri);
      this.logger.configure(this.settings);
      const text = textDocument.getText();
      const diagnostics: Diagnostic[] =
        await this.lfortran.showErrors(uri, text, this.settings);
      if (this.settings.openIssueReporterOnError &&
        (diagnostics.length > 0) &&
        !this.hasError &&
        (this.bugReportProvider != null)) {
        const version = await this.lfortran.version(this.settings);
        const issueTitle = this.bugReportProvider.getTitle();
        const issueBody = this.bugReportProvider.getBody({ version, outputText: text, diagnostics });
        this.reportBug(issueTitle, issueBody);
      }
      this.hasError = (diagnostics.length > 0);
      this.bugReportProvider = null;
      // Send the computed diagnostics to VSCode.
      this.connection.sendDiagnostics({ uri: uri, diagnostics });
    } else {
      this.logError('Cannot validate a document with no diagnostic capability');
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "textDocument", textDocument,
        ]
      );
    }
  }

  extractQuery(text: string, line: number, column: number): string | null {
    const fnid: string = "extractQuery";
    const start: number = performance.now();

    let query: string | null = null;
    let currLine: number = 0;
    let currCol: number = 0;

    const reIdentifiable: RegExp = RE_IDENTIFIABLE;
    const reAlphabetic: RegExp = RE_ALPHABETIC;
    const reQuote: RegExp = RE_QUOTE;
    for (let i = 0, k = text.length; i < k; i++) {
      let c: string = text[i];

      if ((line === currLine) && (column === currCol)) {
        if (!reIdentifiable.test(c) && !reQuote.test(c) && (i > 0) && reIdentifiable.test(text[i - 1])) {
          // Cursor is just right of the query string's word boundary.
          i--;
          c = text[i];
        }
        if (reIdentifiable.test(c)) {
          let l = i;
          let u = i + 1;
          while ((l > 0) && reIdentifiable.test(text[l - 1])) {
            l--;
          }
          while (!reAlphabetic.test(text[l]) && (l <= i)) {
            l++;
          }
          if (l > i) {
            return null;
          }
          while ((u < k) && reIdentifiable.test(text[u])) {
            u++;
          }
          if (RE_QUOTE.test(text[u]) && (u > 0) && (text[u - 1] === '_')) {
            u--;
          }
          query = text.substring(l, u);
          break;
        }
      }

      switch (c) {
        case '\r': {
          const j = i + 1;
          if ((j < k) && (text[j] === '\n')) {
            i = j;
          }
          // fallthrough
        }
        case '\n': {
          currLine++;
          currCol = 0;
          break;
        }
        default: {
          currCol++;
        }
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "text", text,
          "line", line,
          "column", column,
        ],
        query
      );
    }

    return query;
  }

  onCompletion(documentPosition: TextDocumentPositionParams): CompletionItem[] | CompletionList | null {
    const fnid: string = "onCompletion";
    const start: number = performance.now();

    let completions: CompletionItem[] | null = null;

    const uri: string = documentPosition.textDocument.uri;
    const document = this.documents.get(uri);
    const dictionary = this.dictionaries.get(uri);
    if ((document !== undefined) && (dictionary !== undefined)) {
      const text: string = document.getText();
      const pos: Position = documentPosition.position;
      const line: number = pos.line;
      const column: number = pos.character - 1;
      const query: string | null = this.extractQuery(text, line, column);
      if (query !== null) {
        completions = Array.from(dictionary.lookup(query)).flat() as CompletionItem[];
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "documentPosition", documentPosition,
        ],
        completions
      );
    }
    return completions;
  }

  onCompletionResolve(item: CompletionItem): CompletionItem {
    const fnid: string = "onCompletionResolve";
    const start: number = performance.now();
    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "item", item,
        ],
        item
      );
    }
    return item;
  }

  async onHover(params: HoverParams): Promise<Hover | null> {
    const fnid: string = "onHover";
    const start: number = performance.now();

    let hover: Hover | null = null;
    const uri: string = params.textDocument.uri;
    const document = this.documents.get(uri);
    if (document !== undefined) {
      const text: string = document.getText();
      const pos: Position = params.position;
      const line = pos.line;
      const column = pos.character;
      const dlinks: DefinitionLink[] =
        await this.lfortran.lookupName(uri, text, line, column, this.settings);
      if (dlinks.length > 0) {
        const dlink: DefinitionLink = dlinks[0];
        const location: Location = {
          uri: dlink.targetUri,
          range: dlink.targetRange,
        };
        const definition: string | null = await this.extractDefinition(location);
        if (definition !== null) {
          hover = {
            contents: {
              language: "fortran",
              value: definition,
            },
          };
        }
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "params", params,
        ],
        hover
      );
    }
    return hover;
  }

  highlightSymbol(text: string, symbol: string): Range[] {
    const fnid: string = "highlightSymbol";
    const start: number = performance.now();

    // case-insensitive search
    text = text.toLowerCase();
    symbol = symbol.toLowerCase();

    const highlights: Range[] = [];

    let currLine: number = 0;
    let currCol: number = 0;

    const k = text.length;
    const l = symbol.length;
    const w: string = symbol[0];
    const reIdentifiable = RE_IDENTIFIABLE;
    const reAlphaUnder = RE_ALPHA_UNDER;
    for (let i = 0; i < k; i++) {
      let v: string = text[i];

      switch (v) {
        case '\r': {
          const j = i + 1;
          if ((j < k) && (text[j] === '\n')) {
            i = j;
            v = '\n';
          }
          // fallthrough
        }
        case '\n': {
          currLine++;
          currCol = 0;
          break;
        }
        default: {
          if ((v === w) &&
              ((i === 0) ||
               !reIdentifiable.test(text[i - 1]) ||
               ((text[i - 1] == "_") &&
                ((i < 2) || !reAlphaUnder.test(text[i - 2]))))) {
            const startLine: number = currLine;
            const startCol: number = currCol;

            let j: number = 1;
            for (; (j < l) && ((i + j) < k) && (text[i + j] === symbol[j]); j++) {
              // empty
            }

            currCol += j;
            i += (j - 1);

            if ((j === l) &&
                (((i + 1) === k) ||
                 !reIdentifiable.test(text[i + 1]) ||
                 ((text[i + 1] === '_') && ((i + 2) < k) && RE_QUOTE.test(text[i + 2])))) {
              const endLine: number = currLine;
              const endCol: number = currCol;

              const highlight: Range = {
                start: {
                  line: startLine,
                  character: startCol,
                },
                end: {
                  line: endLine,
                  character: endCol,
                },
              };

              highlights.push(highlight);
            }
          } else {
            currCol++;
          }
        }
      }
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "text", text,
          "symbol", symbol,
        ],
        highlights
      );
    }

    return highlights;
  }

  async onRenameRequest(params: RenameParams): Promise<WorkspaceEdit | null> {
    const fnid: string = "onRenameRequest";
    const start: number = performance.now();

    let workspaceEdit: WorkspaceEdit | null = null;
    const newName: string = params.newName;
    const uri: string = params.textDocument.uri;
    const document = this.documents.get(uri);

    if (document !== undefined) {
      const text: string = document.getText();
      const pos: Position = params.position;
      this.settings = await this.getDocumentSettings(uri);
      this.logger.configure(this.settings);
      const edits: TextEdit[] =
        await this.lfortran.renameSymbol(
          uri, text, pos.line, pos.character, newName, this.settings);
      workspaceEdit = {
        changes: {
          [uri]: edits,
        },
      };
      this.bugReportProvider =
        new RenameSymbolBugReportProvider(params, text, workspaceEdit);
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "params", params,
        ],
        workspaceEdit
      );
    }

    return workspaceEdit;
  }

  async onDocumentHighlight(params: DocumentHighlightParams): Promise<DocumentHighlight[]> {
    const fnid: string = "onDocumentHighlight";
    const start: number = performance.now();

    let highlights: DocumentHighlight[];
    const uri: string = params.textDocument.uri;
    const document = this.documents.get(uri);

    if (document !== undefined) {
      const text: string = document.getText();
      const pos: Position = params.position;
      const query: string | null = this.extractQuery(text, pos.line, pos.character);
      if (query !== null) {
        highlights = this.highlightSymbol(text, query).map(range => ({
          range: range,
        }));
      } else {
        highlights = [];
      }
    } else {
      highlights = [];
    }

    if (this.logger.isBenchmarkOrTraceEnabled()) {
      this.logBenchmarkAndTrace(
        fnid, start,
        [
          "params", params,
        ],
        highlights
      );
    }

    return highlights;
  }
}

makeLoggable(LFortranLanguageServer);

