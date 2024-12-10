import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  _Connection,
  DefinitionLink,
  DefinitionParams,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationParams,
  DocumentHighlight,
  DocumentHighlightParams,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  InitializeParams,
  Location,
  MarkedString,
  Position,
  Range,
  RemoteWorkspace,
  RenameParams,
  SymbolInformation,
  SymbolKind,
  TextDocumentChangeEvent,
  TextDocumentPositionParams,
  TextDocuments,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { LFortranSettings } from '../../src/lfortran-types';

import { LFortranCLIAccessor } from "../../src/lfortran-accessors";

import { LFortranLanguageServer } from "../../src/lfortran-language-server";

import { settings } from "./lfortran-common";

import { Logger } from "../../src/logger";

import * as sinon from "sinon";
import { stubInterface } from "ts-sinon";

import { assert } from "chai";

import "mocha";

describe("LFortranLanguageServer", () => {
  let logger: Logger;
  let lfortran: LFortranCLIAccessor;
  let connection: _Connection;
  let documents: TextDocuments<TextDocument>;
  let server: LFortranLanguageServer;
  let document: TextDocument;

  const uri: string = __filename;

  beforeEach(() => {
    logger = new Logger(settings);
    lfortran = new LFortranCLIAccessor(logger);

    connection = stubInterface<_Connection>();
    connection.workspace = stubInterface<RemoteWorkspace & PWorkspace>();
    connection.workspace.getConfiguration.returns(settings);

    document = stubInterface<TextDocument>();
    document.uri = uri;

    documents = stubInterface<TextDocuments<TextDocument>>();
    documents.get.returns(document);
    documents.all.returns([document]);

    server = new LFortranLanguageServer(
      lfortran,
      connection,
      documents,
      logger,
      settings
    );
    server.hasDiagnosticRelatedInformationCapability = true;
  });

  afterEach(() => {
    lfortran.cleanUp();
  });

  describe("onInitialize", () => {
    const params: InitializeParams = {
      processId: null,
      rootUri: uri,
      workspaceFolders: null,
      capabilities: {}
    };

    it("provides document symbols", () => {
      const result = server.onInitialize(params);
      assert.isTrue(result.capabilities.documentSymbolProvider);
    });

    it("provides definitions", () => {
      const result = server.onInitialize(params);
      assert.isTrue(result.capabilities.definitionProvider);
    });
  });

  // describe("onInitialized", () => {
  //   // nothing important to test, here ...
  // });

  describe("onDocumentSymbol", () => {
    const request: DocumentSymbolParams = {
      textDocument: {
        uri: uri
      }
    };

    it("Returns all the symbols", async () => {
      const response: SymbolInformation[] = [
        {
          name: "baz",
          // NOTE: Right now, the kind is hard-coded to Function ...
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 1
              },
              end: {
                line: 0,
                character: 5
              }
            }
          }
        },
        {
          name: "qux",
          // NOTE: Right now, the kind is hard-coded to Function ...
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 3,
                character: 15
              },
              end: {
                line: 3,
                character: 25
              }
            }
          }
        },
      ];

      const stdout = JSON.stringify(response);
      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      const expected = response;
      for (const symbol of expected) {
        const range = symbol.location.range;
        range.start.character--;
        range.end.character--;
      }

      const actual = await server.onDocumentSymbol(request);
      assert.deepEqual(actual, expected);
    });

    it("Returns nothing when the document has not been defined", async () => {
      const actual = await server.onDocumentSymbol(request);
      assert.isNull(actual);
    });
  });

  describe("onDefinition", () => {
    const request: DefinitionParams = {
      textDocument: {
        uri: uri
      },
      position: {
        line: 0,
        character: 42
      }
    };

    it("returns location where symbol is defined", async () => {
      const range: Range = {
        start: {
          line: 3,
          character: 12
        },
        end: {
          line: 3,
          character: 20
        }
      };

      const expected: DefinitionLink[] = [
        {
          targetUri: uri,
          targetRange: range,
          targetSelectionRange: range,
        },
      ];

      const stdout = JSON.stringify([
        {
          location: {
            range: {
              start: {
                line: 3,
                character: 12
              },
              end: {
                line: 3,
                character: 20
              }
            }
          }
        }
      ]);

      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      range.start.character--;
      range.end.character--;

      const actual = await server.onDefinition(request);
      assert.deepEqual(actual, expected);
    });

    it("returns nothing when the document has not been defined", async () => {
      document.getText.returns("");
      const actual = await server.onDefinition(request);
      assert.isEmpty(actual);
    });
  });

  describe("onDidChangeConfiguration", () => {
    const updatedSettings: LFortranSettings = {
      maxNumberOfProblems: 1234,
      compiler: settings.compiler,
      log: settings.log,
    };
    const configChange: DidChangeConfigurationParams = {
      settings: {
        LFortranLanguageServer: updatedSettings
      }
    };

    it("updates the server settings", () => {
      server.onDidChangeConfiguration(configChange);
      assert.equal(server.settings.maxNumberOfProblems,
        updatedSettings.maxNumberOfProblems);
      assert.deepEqual(server.settings.compiler,
        updatedSettings.compiler);
    });

    it("re-validates the documents", () => {
      const validateTextDocument = sinon.spy(server, "validateTextDocument");
      server.onDidChangeConfiguration(configChange);
      assert.isTrue(validateTextDocument.calledOnceWith(document));
    });
  });

  describe("onDidClose", () => {
    it("removes the document from the cache", () => {
      document.getText.returns("");
      const event: TextDocumentChangeEvent<TextDocument> = {
        document: document
      };
      server.onDidClose(event);
      assert.doesNotHaveAnyKeys(server.documentSettings, [document.uri]);
    });
  });

  describe("onDidChangeContent", () => {
    it("validates document from event", () => {
      document.getText.returns("");
      const event: TextDocumentChangeEvent<TextDocument> = {
        document: document
      };
      const validateTextDocument = sinon.spy(server, "validateTextDocument");
      server.onDidChangeContent(event);
      assert.isTrue(validateTextDocument.calledOnceWith(document));
    });
  });

  describe("validateTextDocument", () => {
    it("returns the expected errors", async () => {
      const diagnostics: Diagnostic[] = [
        {
          range: {
            start: {
              line: 0,
              character: 9
            },
            end: {
              line: 2,
              character: 20
            }
          },
          severity: DiagnosticSeverity.Warning,
          source: "lfortran-lsp",
          message: "foo should be bar"
        },
        {
          range: {
            start: {
              line: 5,
              character: 12
            },
            end: {
              line: 5,
              character: 17
            }
          },
          // NOTE: Right now, the severity is hard-coded to Warning ...
          severity: DiagnosticSeverity.Warning,
          source: "lfortran-lsp",
          message: "baz should be qux"
        },
      ];

      const stdout = JSON.stringify({
        diagnostics: [
          {
            range: {
              start: {
                line: 0,
                character: 10
              },
              end: {
                line: 2,
                character: 20
              }
            },
            severity: DiagnosticSeverity.Warning,
            source: "lfortran-lsp",
            message: "foo should be bar"
          },
          {
            range: {
              start: {
                line: 5,
                character: 13
              },
              end: {
                line: 5,
                character: 17
              }
            },
            // NOTE: Right now, the severity is hard-coded to Warning ...
            severity: DiagnosticSeverity.Warning,
            source: "lfortran-lsp",
            message: "baz should be qux"
          },
        ]
      });
      sinon.stub(lfortran, "runCompiler").resolves(stdout);
      document.getText.returns("");

      await server.validateTextDocument(document);
      const sendDiagnostics = connection.sendDiagnostics;
      assert.isTrue(sendDiagnostics.calledOnceWith({ uri: uri, diagnostics }));
    });
  });

  describe("extractDefinition", () => {
    it("extracts definitions from the respective range", () => {
      const text: string = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit,",
        "sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris",
        "nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum",
        "dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat",
        "non proident, sunt in culpa qui officia deserunt mollit anim id est",
        "laborum."
      ].join("\n");

      document.getText.returns(text);

      const start: Position = {
        line: 0,
        character: 0,
      };

      const end: Position = {
        line: 0,
        character: 10,
      };

      const range: Range = { start, end };
      const location: Location = { uri, range };

      let definition: string = server.extractDefinition(location);
      assert.equal(definition, "Lorem ipsum");

      start.line = 2;
      start.character = 8;
      end.line = 5;
      end.character = 31;
      definition = server.extractDefinition(location);
      assert.equal(definition, [
        "ad minim veniam, quis nostrud exercitation ullamco laboris",
        "nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum",
        "dolore eu fugiat nulla pariatur."
      ].join("\n"));
    });
  });

  describe("index", () => {
    it("indexes empty lists of symbols", () => {
      const symbols: SymbolInformation[] = [];
      server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.isEmpty(indexed);
    });

    it("indexes singleton lists of symbols", () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo;";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.deepEqual(indexed, [
        {
          label: "foo",
          kind: CompletionItemKind.Text,
          detail: "def foo;"
        },
      ]);
    });

    it("indexes lists of symbols", () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo;";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 9,
              },
              end: {
                line: 0,
                character: 16,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 18,
              },
              end: {
                line: 0,
                character: 25,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);
      const dictionary = server.dictionaries.get(uri);
      assert.isDefined(dictionary);
      const indexed: CompletionItem[] =
        Array.from(dictionary) as CompletionItem[];
      assert.deepEqual(indexed, [
        {
          label: "foo",
          kind: CompletionItemKind.Text,
          detail: "def foo;"
        },
        {
          label: "bar",
          kind: CompletionItemKind.Text,
          detail: "def bar;"
        },
        {
          label: "baz",
          kind: CompletionItemKind.Text,
          detail: "def baz;"
        },
      ]);
    });
  });

  describe("extractQuery", () => {
    it("expands identifiable symbols at the given location", () => {
      const text: string = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

      let query: string = server.extractQuery(text, 0, 0);
      assert.equal(query, "Lorem");

      query = server.extractQuery(text, 0, 26);  // actual text, ",", is not identifiable.
      assert.isNull(query);

      query = server.extractQuery(text, 0, 25);
      assert.equal(query, "amet");
    });
  });

  describe("onCompletion", () => {
    it("completes queries based on indexed terms", () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo; ba";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 9,
              },
              end: {
                line: 0,
                character: 16,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 18,
              },
              end: {
                line: 0,
                character: 25,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);

      const documentPosition: TextDocumentPositionParams = {
        textDocument: {
          uri: uri,
        },
        position: {
          line: 0,
          character: 46,
        },
      };

      let actual: CompletionItem[] | CompletionList =
        server.onCompletion(documentPosition);

      if (!Array.isArray(actual)) {
        actual = (actual as CompletionList).items;
      }

      const expected: CompletionItem[] = [
        {
          label: "bar",
          kind: CompletionItemKind.Text,
          detail: "def bar;"
        },
        {
          label: "baz",
          kind: CompletionItemKind.Text,
          detail: "def baz;"
        },
      ];

      assert.deepEqual(actual, expected);
    });
  });

  describe("onHover", () => {
    it("displays a symbol's definition", async () => {
      const text: string = "def foo; def bar; def baz; def qux; def quo; ba";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 9,
              },
              end: {
                line: 0,
                character: 16,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolKind.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 18,
              },
              end: {
                line: 0,
                character: 25,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);

      const hoverParams: HoverParams = {
        textDocument: {
          uri: uri,
        },
        position: {
          line: 0,
          character: 5,
        }
      };

      const response: Hover = server.onHover(hoverParams);
      const contents: MarkedString = response.contents as MarkedString;
      assert.equal(contents.language, "fortran");
      assert.equal(contents.value, "def foo;");
    });
  });

  describe("renameSymbol", () => {
    describe("renaming a symbol over an empty string", () => {
      it("should change nothing", () => {
        const symbol: string = "foo";
        const newName: string = "bar";
        const text: string = "";
        const edits: TextEdit[] = server.renameSymbol(text, symbol, newName);
        assert.isEmpty(edits);
      });
    });

    describe("renaming a symbol in a singleton string", () => {
      it("should change the symbol as requested", () => {
        const symbol: string = "lorem";
        const newName: string = "id";
        const text: string = "lorem";
        const edits: TextEdit[] = server.renameSymbol(text, symbol, newName);
        assert.deepEqual(edits, [
          {
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 5,
              },
            },
            newText: newName,
          },
        ]);
      });
    });

    describe("renaming a non-existing symbol", () => {
      it("should change nothing", () => {
        const symbol: string = "foo";
        const newName: string = "bar";
        const text: string = "baz qux quo";
        const edits: TextEdit[] = server.renameSymbol(text, symbol, newName);
        assert.isEmpty(edits);
      });
    });

    describe("renaming a symbol on a single line", () => {
      it("should replace all the respective terms", () => {
        const symbol: string = "foo";
        const newName: string = "abc";
        const text: string = "foo bar baz%foo foo_qux quo_foo foo";
        const edits: TextEdit[] = server.renameSymbol(text, symbol, newName);
        assert.deepEqual(edits, [
          {
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 0,
                character: 12,
              },
              end: {
                line: 0,
                character: 15,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 0,
                character: 32,
              },
              end: {
                line: 0,
                character: 35,
              },
            },
            newText: newName,
          },
        ]);
      });
    });

    describe("renaming a symbol over multiple lines", () => {
      it("should replace all respective symbols", () => {
        const symbol: string = "foo";
        const newName: string = "bar";
        const text: string = [
          "Foo bar baz",
          "qux quo",
          "abc%foo",
          "foo%def",
          "FOO foo bar_foo",
          "baz_foo quux FoO foofoo bax_foo_qux"
        ].join("\n");
        const edits: TextEdit[] = server.renameSymbol(text, symbol, newName);
        assert.deepEqual(edits, [
          {
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 2,
                character: 4,
              },
              end: {
                line: 2,
                character: 7,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 3,
                character: 0,
              },
              end: {
                line: 3,
                character: 3,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 4,
                character: 0,
              },
              end: {
                line: 4,
                character: 3,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 4,
                character: 4,
              },
              end: {
                line: 4,
                character: 7,
              },
            },
            newText: newName,
          },
          {
            range: {
              start: {
                line: 5,
                character: 13,
              },
              end: {
                line: 5,
                character: 16,
              },
            },
            newText: newName,
          },
        ]);
      });
    });
  });

  describe("onRenameRequest", () => {
    it("should wrap the edits from lfortran within a WorkspaceEdit", async () => {
      const text: string = "foo bar baz qux";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
        {
          name: "bar",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 4,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          },
        },
        {
          name: "baz",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 8,
              },
              end: {
                line: 0,
                character: 11,
              },
            },
          },
        },
        {
          name: "qux",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 12,
              },
              end: {
                line: 0,
                character: 15,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);

      const newName: string = "quo";

      const expected: WorkspaceEdit = {
        changes: {
          [uri]: [
            {
              range: {
                start: {
                  line: 0,
                  character: 0,
                },
                end: {
                  line: 0,
                  character: 3,
                },
              },
              newText: newName,
            },
          ],
        },
      };

      const params: RenameParams = {
        newName: newName,
        textDocument: document,
        position: {
          line: 0,
          character: 0,
        },
      };

      const actual: WorkspaceEdit = await server.onRenameRequest(params);
      assert.deepEqual(actual, expected);
    });
  });

  describe("onDocumentHighlight", () => {
    it("does not highlight symbols when they are not recognized", async () => {
      const text: string = "foo bar foo baz.foo";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);

      const params: DocumentHighlightParams = {
        textDocument: document,
        position: {
          line: 0,
          character: 4,
        },
      };

      const actual: DocumentHighlight[] | undefined | null = await server.onDocumentHighlight(params);
      assert.isNull(actual);
    });

    it("highlights symbols when they are recognized", async () => {
      const text: string = "foo bar foo baz.foo";
      document.getText.returns(text);

      const symbols: SymbolInformation[] = [
        {
          name: "foo",
          kind: SymbolInformation.Function,
          location: {
            uri: uri,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 3,
              },
            },
          },
        },
      ];

      server.index(uri, symbols);

      const expected: DocumentHighlight[] = [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 3,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 8,
            },
            end: {
              line: 0,
              character: 11,
            },
          },
        },
        {
          range: {
            start: {
              line: 0,
              character: 16,
            },
            end: {
              line: 0,
              character: 19,
            },
          },
        },
      ];

      const params: DocumentHighlightParams = {
        textDocument: document,
        position: {
          line: 0,
          character: 0,
        },
      };

      const actual: DocumentHighlight[] = await server.onDocumentHighlight(params);
      assert.isDefined(actual);
      assert.deepEqual(actual, expected);
    });
  });
});
