import {
  By,
  Key,
  until,
  WebElement,
} from 'selenium-webdriver';

import { assert } from "chai";

// import the webdriver and the high level browser wrapper
import {
  EditorView,
  Setting,
  SettingsEditor,
  TextEditor,
  VSBrowser,
  WebDriver,
  Workbench,
} from "vscode-extension-tester";

const timeout: number = 60000;

const fileName: string = "function_call1.f90";

let browser: VSBrowser;
let driver: WebDriver;
let workbench: Workbench;
let editorView: EditorView;
let editor: TextEditor;

/**
 * Details about a code completion item.
 */
interface UICompletionItem {

  /** Completion symbol provided by the server. */
  label: string;

  /**
   * Description of the completion item (independent of its documentation, e.g.
   * its definition).
   */
  detail?: string;

  /** One-liner preview of the detail string. */
  compressedDetail?: string;

  /** Additional documentation provided by the server (not supported yet). */
  documentation?: string;

  /** Whether this item is the one highlighted in the completion list. */
  isSelected: boolean;
}

async function getCompletionItems(): Promise<void | UICompletionItem[]> {
  const suggestWidget: WebElement =
    await driver.wait(
      until.elementLocated(
        By.css('div[widgetid="editor.widget.suggestWidget"]')),
    timeout);
  await driver.wait(until.elementIsVisible(suggestWidget), timeout);
  const options: void | WebElement[] =
    await suggestWidget.findElements(By.css('div[role="option"]'));
  if (options) {
    const items: UICompletionItem[] = [];
    for (let i = 0, k = options.length; i < k; i++) {
      const option: WebElement = options[i];
      const label: WebElement = await option.findElement(By.className("label-name"));
      const cssClasses: string = await option.getAttribute("class");
      const isSelected: boolean = /(?:^| )focused(?: |$)/.test(cssClasses);
      const item: UICompletionItem = {
        label: await label.getText(),
        isSelected: isSelected,
      };
      if (isSelected) {
        const compressedDetail: WebElement = await option.findElement(By.className("details-label"));
        item.compressedDetail = await compressedDetail.getText();
        const details: WebElement[] =
          await driver.findElements(By.css('div[widgetid="suggest.details"]'));
        if (details.length > 0) {
          item.detail = await details[0].getText();
        }
      }
      items.push(item);
    }
    return items;
  }
}

function assertHasLines(item: UICompletionItem, lines: string[]): void {
  assert.isTrue(!!(item.compressedDetail || item.detail),
    "expected either the item compressedDetail or detail to be defined");
  if (item.compressedDetail) {
    assert.equal(item.compressedDetail, lines.join("").replace(/[ \t]+/g, " "));
  }
  if (item.detail) {
    assert.equal(item.detail, lines.join("\n"));
  }
}

async function triggerHoverAndGetText() : Promise<string> {
  await workbench.executeCommand("Show Definition Preview Hover");
  const resizableContentHoverWidget: void | WebElement =
    await driver.wait(
      until.elementLocated(
        By.css('div[widgetid="editor.contrib.resizableContentHoverWidget"]')),
    timeout);
  await driver.wait(until.elementIsVisible(resizableContentHoverWidget), timeout);
  const text: string = await resizableContentHoverWidget.getText();
  return text;
}

// initialize the browser and webdriver
before(async () => {
  browser = VSBrowser.instance;
  driver = browser.driver;
  workbench = new Workbench();
  const settingsEditor: SettingsEditor = await workbench.openSettings();
  // NOTE: The following two statements are equivalent:
  // ==================================================
  // 1. const lfortranPathSetting =
  //       await settingsEditor.findSetting("Lfortran Path", "LFortran Language Server", "Compiler");
  // 2. const lfortranPathSetting: Setting =
  //       await settingsEditor.findSettingByID("LFortranLanguageServer.compiler.lfortranPath");
  const lfortranPathSetting: Setting =
    await settingsEditor.findSettingByID("LFortranLanguageServer.compiler.lfortranPath");
  await lfortranPathSetting.setValue("./lfortran/src/bin/lfortran");
  await new EditorView().closeAllEditors();
});

// Create a Mocha suite
describe(fileName, () => {

  before(async () => {
    editorView = new EditorView();
  });

  beforeEach(async () => {
    await browser.openResources(`./lfortran/tests/${fileName}`);
    editor = (await editorView.openEditor(fileName)) as TextEditor;
  });

  afterEach(async () => {
    await workbench.executeCommand("revert file");
    await editorView.closeEditor(fileName);
  });

  describe('When I type "m"', () => {
    it('should present me with "module_function_call1" and its definition.', async () => {
      await editor.setCursor(20, 33);
      await editor.typeText('\nm');
      const items: UICompletionItem[] = await getCompletionItems() as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 1);
      const item: UICompletionItem = items[0];
      assert.equal(item.label, "module_function_call1");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "module module_function_call1",
        "    type :: softmax",
        "    contains",
        "      procedure :: eval_1d",
        "    end type softmax",
        "  contains",
        "  ",
        "    pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
        "  ",
        "    pure function eval_1d_prime(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "      res = self%eval_1d(x)",
        "    end function eval_1d_prime",
        "end module module_function_call1",
      ]);
    });
  });

  describe('When I type "e"', () => {
    it('should present me with "eval_1d", "eval_1d_prime" and their definitions.', async () => {
      await editor.setCursor(20, 33);
      await editor.typeText('\ne');
      let items: UICompletionItem[] = await getCompletionItems() as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 2);

      let item: UICompletionItem = items[0];
      assert.equal(item.label, "eval_1d");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
      ]);

      item = items[1];
      assert.equal(item.label, "eval_1d_prime");
      assert.isFalse(item.isSelected);

      await driver.actions().clear();  // necessary for the key-down event
      await driver.actions().sendKeys(Key.DOWN).perform();
      items = await getCompletionItems() as UICompletionItem[];
      assert.isDefined(items);
      assert.lengthOf(items, 2);

      item = items[0];
      assert.equal(item.label, "eval_1d");
      assert.isFalse(item.isSelected);

      item = items[1];
      assert.equal(item.label, "eval_1d_prime");
      assert.isTrue(item.isSelected);
      assertHasLines(item, [
        "pure function eval_1d_prime(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "      res = self%eval_1d(x)",
        "    end function eval_1d_prime",
      ]);
    });
  });

  describe('When I hover over "self%eval_1d"', () => {
    it('should display the definition of "eval_1d"', async () => {
      await editor.setCursor(18, 22);
      const hoverText: string = await triggerHoverAndGetText();
      assert.isDefined(hoverText);
      assert.equal(hoverText, [
        "pure function eval_1d(self, x) result(res)",
        "      class(softmax), intent(in) :: self",
        "      real, intent(in) :: x(:)",
        "      real :: res(size(x))",
        "    end function eval_1d",
      ].join("\n"));
    });
  });

  describe('When I go to the definition of "self%eval_1d"', () => {
    it('should move the cursor to line 8, column 5.', async () => {
      await editor.setCursor(18, 22);
      await workbench.executeCommand("Go To Definition");
      const [line, column] = await editor.getCoordinates();
      assert.equal(line, 8);
      assert.equal(column, 5);
    });
  });
});
