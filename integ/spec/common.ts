import {
  By,
  Key,
  until,
  WebElement,
} from 'selenium-webdriver';

// @ts-expect-error: next-line
import { assert } from "chai";

// import the webdriver and the high level browser wrapper
import {
  EditorView,
  Setting,
  SettingsEditor,
  VSBrowser,
  WebDriver,
  Workbench,
} from "vscode-extension-tester";

const TIMEOUT: number = 60000;

/**
 * Details about a code completion item.
 */
export interface UICompletionItem {

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

export interface CommonState {
  browser: VSBrowser;
  driver: WebDriver;
  workbench: Workbench;
  editorView: EditorView;
}

let state: CommonState | null = null;

// initialize the browser and webdriver
export async function initState(): Promise<CommonState> {
  if (state === null) {
    const browser: VSBrowser = VSBrowser.instance;
    const driver: WebDriver = browser.driver;
    const workbench: Workbench = new Workbench();
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
    const compilerFlagsSetting: Setting =
      await settingsEditor.findSettingByID("LFortranLanguageServer.compiler.flags");
    await compilerFlagsSetting.setValue("");
    const fontFamily: Setting =
      await settingsEditor.findSettingByID("editor.fontFamily");
    await fontFamily.setValue('consolas, "DejaVu Sans Mono", monospace');
    const fontSize: Setting =
      await settingsEditor.findSettingByID("editor.fontSize");
    await fontSize.setValue("10");
    const editorView: EditorView = new EditorView();
    await editorView.closeAllEditors();
    state = {
      browser: browser,
      driver: driver,
      workbench: workbench,
      editorView: editorView,
    };
  }
  return state;
}

export async function getCompletionItems(driver: WebDriver): Promise<void | UICompletionItem[]> {
  const suggestWidget: WebElement =
    await driver.wait(
      until.elementLocated(
        By.css('div[widgetid="editor.widget.suggestWidget"]')),
    TIMEOUT);
  await driver.wait(until.elementIsVisible(suggestWidget), TIMEOUT);
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

export function assertHasLines(item: UICompletionItem, lines: string[]): void {
  assert.isTrue(!!(item.compressedDetail || item.detail),
    "expected either the item compressedDetail or detail to be defined");
  if (item.compressedDetail) {
    assert.equal(item.compressedDetail, lines.join("").replace(/[ \t]+/g, " "));
  }
  if (item.detail) {
    assert.equal(item.detail, lines.join("\n"));
  }
}

export async function triggerHoverAndGetText(driver: WebDriver, workbench: Workbench) : Promise<string> {
  await workbench.executeCommand("Show Definition Preview Hover");
  const resizableContentHoverWidget: void | WebElement =
    await driver.wait(
      until.elementLocated(
        By.css('div[widgetid="editor.contrib.resizableContentHoverWidget"]')),
    TIMEOUT);
  await driver.wait(until.elementIsVisible(resizableContentHoverWidget), TIMEOUT);
  const text: string = await resizableContentHoverWidget.getText();
  return text;
}

export async function renameSymbol(driver: WebDriver, newName: string): Promise<void> {
  // await editor.sendKeys(Key.F2);
  await driver.actions().clear();  // necessary for the key-down event
  await driver.actions().sendKeys(Key.F2).perform();
  const renameInput: WebElement =
    driver.wait(
      until.elementLocated(
        By.css('input.rename-input')),
      TIMEOUT);
  let oldName: string = await renameInput.getAttribute("value");
  for (let i = 0, k = oldName.length;
       (oldName.length > 0) && (i < k);
       i++) {
    await renameInput.sendKeys(Key.BACK_SPACE);
    oldName = await renameInput.getAttribute("value");
  }
  oldName = await renameInput.getAttribute("value");
  assert.isEmpty(
    oldName,
    "Failed to clear all characters from .rename-input");
  await renameInput.sendKeys(newName);
  await renameInput.sendKeys(Key.ENTER);
}

export async function getErrorAlert(driver: WebDriver): Promise<string> {
  await driver.actions().clear();
  await driver.actions().sendKeys(Key.F8).perform();
  // NOTE: k=10 might be excessive, but I don't like failing due to a lack
  // of retries ...
  // ---------------------------------------------------------------------
  for (let i = 0, k = 10; i < k; i++) {
    try {
      const errorAlert: WebElement =
        await driver.wait(
          until.elementLocated(
            By.css('div.message[role="alert"][aria-label^="error"] div')),
          TIMEOUT);
      const errorMessage: string =
        await driver.executeScript(
          "return arguments[0].firstChild.nodeValue",
          errorAlert);
      return errorMessage;
    } catch (error: any) {
      const retryMessage: string =
        "stale element reference: stale element not found in the current frame";
      if (!error.message.startsWith(retryMessage) || ((i + 1) == k)) {
        throw error;
      }
    }
  }
  throw new Error("This should not be reached!");
}

const GET_FONT: string = `
  const element = arguments[0];
  const style = window.getComputedStyle(element);
  const fontFamily = style.fontFamily;
  const fontSize = style.fontSize;
  const fontStretch = style.fontStretch;
  const fontStyle = style.fontStyle;
  const fontVariant = style.fontVariant;
  const fontWeight = style.fontWeight;
  const lineHeight = style.lineHeight;
  const font = [
    fontStyle,
    fontVariant,
    fontWeight,
    fontSize + "/" + lineHeight,
    fontStretch,
    fontFamily,
  ].join(" ");
  return font;
`;

export async function getFont(driver: WebDriver, element: WebElement): Promise<string> {
  const font: string = await driver.executeScript(GET_FONT, element);
  return font;
}

const GET_TEXT_WIDTH: string = `
  const text = arguments[0];
  const font = arguments[1];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
`;

export async function getTextWidth(driver: WebDriver, text: string, font: string): Promise<number> {
  const textWidth: number =
    await driver.executeScript(GET_TEXT_WIDTH, text, font);
  return textWidth;
}

export async function getHighlightedText(driver: WebDriver): Promise<string[]> {
  // ---------------------------------------------------------------------------
  // How the algorithm works:
  // ---------------------------------------------------------------------------
  // 1. VSCode models each line of text as a `div.view-line` with a `style`
  //    attribute that contains its vertical offset (`top`) and its `height`,
  //    both in pixels.
  // 2. When a symbol is highlighted, each occurrence of that symbol has its
  //    location recorded in an overlay. Each overlay consists of a row with
  //    elements representing how to format each subsequence of character.
  // 3. Each overlay row has the same `style` attribute as its respective
  //    `div.view-line`, as described in (1.). We can use these to look up the
  //    line of text associated with each overlay.
  // 4. All occurrences of the symbol within the overlay row are stored with
  //    their horizontal offset (`left`) and width in pixels. Since the font is
  //    monospace, all characters will have the same width and both the
  //    horizontal offset and width will be divisible by the width of a single
  //    character. The quotients tell us the number of characters to skip before
  //    the symbol occurs and the number of characters in the symbol,
  //    respectively.
  // 5. Once all the symbol occurrences are extracted as specified by the
  //    highlight overlays, we return them as a list.
  // ---------------------------------------------------------------------------
  const highlights: string[] = [];
  // const font: string = await getFont(editor);
  // const charWidth: number = await getTextWidth("a", font);
  const charWidth: number = 6;  // hardcoded for Github Actions
  const overlays: WebElement[] =
    await driver.wait<WebElement[]>(
      until.elementsLocated(
        By.css("div:has(>div.cdr.wordHighlightText)")),
      TIMEOUT);
  for (const overlay of overlays) {
    let style: string =
      await driver.executeScript("return arguments[0].style.cssText", overlay);
    style = style.replace(/ /g, "");
    const viewLine: WebElement =
      await driver.wait(
        until.elementLocated(
          By.css(`div[style="${style}"].view-line`)),
        TIMEOUT);
    const lineText: string = await viewLine.getText();
    const spans: WebElement[] =
      await overlay.findElements(By.css("div.cdr.wordHighlightText"));
    for (const span of spans) {
      const startPixel: number =
        await driver.executeScript(
          "return parseInt(arguments[0].style.left, 10)",
          span);
      const numPixels: number =
        await driver.executeScript(
          "return parseInt(arguments[0].style.width, 10)",
          span);
      assert.equal(
        startPixel % charWidth, 0,
        `Expected highlight offset ${startPixel} to be divisible by ${charWidth}`);
      assert.equal(
        numPixels % charWidth, 0,
        `Expected highlight width ${numPixels} to be divisible by ${charWidth}`);
      const startChar: number = startPixel / charWidth;
      const numChars: number = numPixels / charWidth;
      const endChar: number = startChar + numChars;
      const highlight = lineText.substring(startChar, endChar);
      highlights.push(highlight);
    }
  }
  return highlights;
}
