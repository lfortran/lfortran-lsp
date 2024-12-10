/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

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

import { Logger } from './logger';

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

const RE_IDENTIFIABLE: RegExp = /^[a-zA-Z0-9_]$/;

export class LFortranLanguageServer {
  static LOG_CONTEXT: string = "LFortranLanguageServer";

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

  constructor(lfortran: LFortranAccessor,
              connection: _Connection,
              documents: TextDocuments<TextDocument>,
              logger: Logger,
              settings: LFortranSettings = defaultSettings) {
    const fnid: string = "constructor(...)";
    const start: number = performance.now();

    this.lfortran = lfortran;
    this.connection = connection;
    this.documents = documents;
    this.logger = logger;
    this.settings = settings;

    logger.configure(settings);
    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [
        lfortran,
        connection,
        documents,
        logger,
        settings,
      ]
    );
  }

  onInitialize(params: InitializeParams): InitializeResult {
    const fnid: string = "onInitialize(...)";
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

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [params],
      result
    );
    return result;
  }

  onInitialized(params: InitializedParams): void {
    const fnid: string = "onInitialized(...)";
    const start: number = performance.now();

    if (this.hasConfigurationCapability) {
      // Register for all configuration changes.
      this.connection.client
        .register(DidChangeConfigurationNotification.type, undefined);
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [params]
    );
  }

  extractDefinition(location: Location): string | null {
    const fnid: string = "extractDefinition(...)";
    const start: number = performance.now();
    let definition: string | null = null;
    const document = this.documents.get(location.uri);
    if (document !== undefined) {
      const range: Range = location.range;

      const start: Position = range.start;
      const startLine: number = start.line;
      const startCol: number = start.character;

      const end: Position = range.end;
      const endLine: number = end.line;
      const endCol: number = end.character;

      const text = document.getText();

      let currLine = 0;
      let currCol = 0;

      for (let i = 0, k = text.length; i < k; i++) {
        let c: string;
        if ((currLine === startLine) && (currCol === startCol)) {
          let j = i;
          for (; (currLine < endLine) || (currLine === endLine) && (currCol <= endCol); j++) {
            c = text[j];
            if (c === '\n') {
              currLine++;
              currCol = 0;
            } else if (c === '\r') {
              const l = j + 1;
              if ((l < k) && (text[l] === '\n')) {
                j = l;
              }
              currLine++;
              currCol = 0;
            } else {
              currCol++;
            }
          }
          definition = text.substring(i, j);
          break;
        } else {
          c = text[i];
          if (c === '\n') {
            currLine++;
            currCol = 0;
          } else if (c === '\r') {
            const j = i + 1;
            if ((j < k) && (text[j] === '\n')) {
              i = j;
            }
            currLine++;
            currCol = 0;
          } else {
            currCol++;
          }
        }
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [location],
      definition);
    return definition;
  }

  index(uri: string, symbols: SymbolInformation[]): void {
    const fnid: string = "index(...)";
    const start: number = performance.now();

    // (symbols.length == 0) => error with document, but we still need to
    // support auto-completion.
    const terms: string[] = [];
    const values: CompletionItem[] = [];
    for (let i = 0, k = symbols.length; i < k; i++) {
      const symbol: SymbolInformation = symbols[i];
      const definition: string | null =
        this.extractDefinition(symbol.location);
      terms.push(symbol.name);
      values.push({
        label: symbol.name,
        // FIXME: Once lfortran returns the correct symbol kinds, map them
        // to their corresponding completion kind, here.
        // ---------------------------------------------------------------
        // kind: symbol.kind,
        kind: CompletionItemKind.Text,
        detail: definition,
      });
    }
    // TODO: Consider indexing temporary file by URI.
    const dictionary = PrefixTrie.from(terms, values);
    this.dictionaries.set(uri, dictionary);

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [uri, symbols]
    );
  }

  async onDocumentSymbol(request: DocumentSymbolParams): Promise<SymbolInformation[] | null> {
    const fnid: string = "onDocumentSymbol(...)";
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
        this.index(uri, symbols);
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [request],
      symbols
    );

    return symbols;
  }

  async onDefinition(request: DefinitionParams): Promise<DefinitionLink[] | null> {
    const fnid: string = "onDefinition(...)";
    const start: number = performance.now();

    let definitions: DefinitionLink[] | null = null;
    const uri = request.textDocument.uri;
    this.settings = await this.getDocumentSettings(uri);
    this.logger.configure(this.settings);
    const document = this.documents.get(uri);
    if (document !== undefined) {
      const text = document.getText();
      const line = request.position.line;
      let column = request.position.character;
      if (column > 0) {
        const offset: number = document.offsetAt(request.position);
        if ((offset == text.length) || !RE_IDENTIFIABLE.test(text[offset])) {
          column--;  // might be at right side of word boundary
        }
      }
      definitions =
        await this.lfortran.lookupName(uri, text, line, column, this.settings);
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [request],
      definitions
    );

    return definitions;
  }

  onDidChangeConfiguration(change: DidChangeConfigurationParams): void {
    const fnid: string = "onDidChangeConfiguration(...)";
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

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [change]
    );
  }

  getDocumentSettings(uri: string): Thenable<LFortranSettings> {
    const fnid: string = "getDocumentSettings(...)";
    const start: number = performance.now();

    if (!this.hasConfigurationCapability) {
      this.logger.benchmarkAndTrace(
        LFortranLanguageServer.LOG_CONTEXT,
        fnid, start,
        [uri],
        this.settings
      );
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

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [uri],
      settings
    );
    return settings;
  }

  // Only keep settings for open documents
  onDidClose(event: TextDocumentChangeEvent<TextDocument>): void {
    const fnid: string = "onDidClose(...)";
    const start: number = performance.now();

    this.documentSettings.delete(event.document.uri);

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [event]
    );
  }

  onDidChangeContent(event: TextDocumentChangeEvent<TextDocument>): void {
    const fnid: string = "onDidChangeContent(...)";
    const start: number = performance.now();

    this.validateTextDocument(event.document);

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [event]
    );
  }

  async validateTextDocument(textDocument: TextDocument): Promise<void> {
    const fnid: string = "validateTextDocument(...)";
    const start: number = performance.now();

    if (this.hasDiagnosticRelatedInformationCapability) {
      const uri = textDocument.uri;
      this.settings = await this.getDocumentSettings(uri);
      this.logger.configure(this.settings);
      const text = textDocument.getText();
      const diagnostics: Diagnostic[] =
        await this.lfortran.showErrors(uri, text, this.settings);
      // Send the computed diagnostics to VSCode.
      this.connection.sendDiagnostics({ uri: uri, diagnostics });
    } else {
      this.logger.error(
        LFortranLanguageServer.LOG_CONTEXT,
        'Cannot validate a document with no diagnostic capability');
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [textDocument]
    );
  }

  extractQuery(text: string, line: number, column: number): string | null {
    const fnid: string = "extractQuery(...)";
    const start: number = performance.now();

    let query: string | null = null;
    let currLine: number = 0;
    let currCol: number = 0;

    for (let i = 0, k = text.length; i < k; i++) {
      const c: string = text[i];

      if ((line === currLine) && (column === currCol)) {
        const re_identifiable: RegExp = RE_IDENTIFIABLE;
        if (re_identifiable.test(c)) {
          let l = i;
          let u = i + 1;
          while ((l > 0) && re_identifiable.test(text[l - 1])) {
            l--;
          }
          while ((u < k) && re_identifiable.test(text[u])) {
            u++;
          }
          query = text.substring(l, u);
          break;
        }
      }

      if (c === '\n') {
        currLine++;
        currCol = 0;
      } else if (c === '\r') {
        const j = i + 1;
        if ((j < k) && (text[j] === '\n')) {
          i = j;
        }
        currLine++;
        currCol = 0;
      } else {
        currCol++;
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [text, line, column],
      query
    );
    return query;
  }

  onCompletion(documentPosition: TextDocumentPositionParams): CompletionItem[] | CompletionList | null {
    const fnid: string = "onCompletion(...)";
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
        completions = Array.from(dictionary.lookup(query)) as CompletionItem[];
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [documentPosition],
      completions
    );
    return completions;
  }

  onCompletionResolve(item: CompletionItem): CompletionItem {
    const fnid: string = "onCompletionResolve(...)";
    const start: number = performance.now();
    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [item],
      item
    );
    return item;
  }

  onHover(params: HoverParams): Hover | null {
    const fnid: string = "onHover(...)";
    const start: number = performance.now();

    let hover: Hover | null = null;
    const uri: string = params.textDocument.uri;
    const document = this.documents.get(uri);
    const dictionary = this.dictionaries.get(uri);
    if ((document !== undefined) && (dictionary !== undefined)) {
      const text: string = document.getText();
      const pos: Position = params.position;
      const line = pos.line;
      const column = pos.character;
      const query: string | null = this.extractQuery(text, line, column);
      if (query !== null) {
        const completion: CompletionItem | undefined =
          dictionary.exactLookup(query) as CompletionItem;
        const definition: string | undefined = completion?.detail;
        if (definition !== undefined) {
          hover = {
            contents: {
              language: "fortran",
              value: definition,
            },
          };
        }
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [params],
      hover
    );
    return hover;
  }

  highlightSymbol(text: string, symbol: string): Range[] {
    const fnid: string = "highlightSymbol(...)";
    const start: number = performance.now();

    // case-insensitive search
    text = text.toLowerCase();
    symbol = symbol.toLowerCase();

    const highlights: Range[] = [];

    let currLine: number = 0;
    let currCol: number = 0;

    const k = text.length;
    const l = symbol.length;
    let u: string | null = null;
    const w: string = symbol[0];
    const reIdentifiable = RE_IDENTIFIABLE;
    for (let i = 0; i < k; i++) {
      const v: string = text[i];

      if (v === '\n') {
        currLine++;
        currCol = 0;
        u = v;
      } else if (v === '\r') {
        const j = i + 1;
        if ((j < k) && (text[j] === '\n')) {
          i = j;
          u = '\n';
        } else {
          u = v;
        }
        currLine++;
        currCol = 0;
      } else if ((v === w) && ((u === null) || !reIdentifiable.test(u))) {
        const startLine: number = currLine;
        const startCol: number = currCol;

        let j: number = 1;
        for (; (j < l) && ((i + j) < k) && (text[i + j] === symbol[j]); j++) {
          // empty
        }

        currCol += j;
        i += (j - 1);
        u = text[i];

        if ((j === l) && (((i + 1) === k) || !reIdentifiable.test(text[i + 1]))) {
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
        u = v;
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [text, symbol],
      highlights
    );
    return highlights;
  }

  renameSymbol(text: string, symbol: string, newName: string): TextEdit[] {
    const fnid: string = "renameSymbol(...)";
    const start: number = performance.now();

    const edits: TextEdit[] = this.highlightSymbol(text, symbol).map(range => ({
      range: range,
      newText: newName,
    }));

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [text, symbol, newName],
      edits
    );
    return edits;
  }

  async onRenameRequest(params: RenameParams): Promise<WorkspaceEdit | null> {
    const fnid: string = "onRenameRequest(...)";
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
      // =====================================================================================
      // FIXME: Once lfortran/lfortran issue #5524 is resolved, restore this call to lfortran:
      // =====================================================================================
      // const edits: TextEdit[] =
      //   await this.lfortran.renameSymbol(uri, text, pos.line, pos.character, newName, this.settings);
      // workspaceEdit = {
      //   changes: {
      //     [uri]: edits,
      //   },
      // };
      const query: string | null = this.extractQuery(text, pos.line, pos.character);
      if (query !== null) {
        const dictionary = this.dictionaries.get(uri);
        if ((dictionary !== undefined) && dictionary.contains(query)) {
          const edits: TextEdit[] = this.renameSymbol(text, query, newName);
          workspaceEdit = {
            changes: {
              [uri]: edits,
            },
          };
        } else {
          this.logger.warn(
            LFortranLanguageServer.LFortranLanguageServer.LOG_CONTEXT,
            'Cannot find symbol to rename: "%s"',
            query);
        }
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [params],
      workspaceEdit
    );
    return workspaceEdit;
  }

  async onDocumentHighlight(params: DocumentHighlightParams): Promise<DocumentHighlight[] | null> {
    const fnid: string = "onDocumentHighlight(...)";
    const start: number = performance.now();

    let highlights: DocumentHighlight[] | null = null;
    const uri: string = params.textDocument.uri;
    const document = this.documents.get(uri);

    if (document !== undefined) {
      const text: string = document.getText();
      const pos: Position = params.position;
      const query: string | null = this.extractQuery(text, pos.line, pos.character);
      if (query !== null) {
        const dictionary = this.dictionaries.get(uri);
        if ((dictionary !== undefined) && dictionary.contains(query)) {
          highlights = this.highlightSymbol(text, query).map(range => ({
            range: range,
          }));
        } else {
          this.logger.warn(
            LFortranLanguageServer.LOG_CONTEXT,
            'Cannot find symbol to highlight: "%s"',
            query);
        }
      }
    }

    this.logger.benchmarkAndTrace(
      LFortranLanguageServer.LOG_CONTEXT,
      fnid, start,
      [params],
      highlights
    );
    return highlights;
  }
}

