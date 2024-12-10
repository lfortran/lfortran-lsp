// @ts-expect-error: next-line
import { assert } from "chai";

// import the webdriver and the high level browser wrapper
import {
  EditorView,
  TextEditor,
  VSBrowser,
  WebDriver,
  Workbench,
} from "vscode-extension-tester";

import {
  CommonState,
  initState,
} from "./common";

const fileName: string = "issue20.f90";

let browser: VSBrowser;
let driver: WebDriver;
let workbench: Workbench;
let editorView: EditorView;
let editor: TextEditor;

before(async () => {
  const state: CommonState = await initState();
  browser = state.browser;
  driver = state.driver;
  workbench = state.workbench;
  editorView = state.editorView;
});

// Create a Mocha suite
describe(fileName, () => {

  beforeEach(async () => {
    await browser.openResources(`./integ/issues/${fileName}`);
    editor = (await editorView.openEditor(fileName)) as TextEditor;
  });

  afterEach(async () => {
    await workbench.executeCommand("revert file");
    await editorView.closeEditor(fileName);
    await driver.actions().clear();
  });

  describe('When I go to the definition of "self%eval_1d"', () => {
    it('should move the cursor to line 8, column 5.', async () => {
      await editor.setCursor(7, 11);
      await workbench.executeCommand("Go To Definition");
      const [line, column] = await editor.getCoordinates();
      assert.equal(line, 4);
      assert.equal(column, 12);
    });
  });
});
