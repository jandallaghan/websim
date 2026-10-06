import type { Browser, BrowserContext, Page, Dialog } from "playwright";
import { z } from "zod";
import { createBrowserSession } from "../sdk/browser.js";
import type { InstanceHandle } from "../sdk/client.js";

export const browserAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number().min(0).max(1280),
    y: z.number().min(0).max(800),
  }),
  z.object({ type: z.literal("key"), key: z.string().max(80) }),
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().min(-10000).max(10000),
    deltaY: z.number().min(-10000).max(10000),
    x: z.number().min(0).max(1280),
    y: z.number().min(0).max(800),
  }),
  z.object({
    type: z.literal("navigate"),
    url: z.url().refine((value) => /^https?:/.test(value)),
  }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("reload") }),
  z.object({
    type: z.literal("dialog"),
    accept: z.boolean(),
    text: z.string().optional(),
  }),
]);

/** Owns the manual browser for one instance. Only pixels and explicit input cross the boundary. */
export class RemoteBrowser {
  private constructor(
    private context: BrowserContext,
    private page: Page,
  ) {}
  private dialog?: Dialog;
  private image: string | null = null;
  static async open(
    browser: Browser,
    instance: InstanceHandle,
    entrypoint: string,
  ) {
    const session = await createBrowserSession(browser, instance, {
      viewport: { width: 1280, height: 800 },
    });
    try {
      session.context.setDefaultTimeout(10_000);
      session.context.setDefaultNavigationTimeout(10_000);
      const page = await session.context.newPage();
      const remote = new RemoteBrowser(session.context, page);
      const observe = (page: Page) => {
        page.on("dialog", (dialog) => {
          remote.dialog = dialog;
        });
        page.on("close", () => {
          remote.page = session.context.pages().at(-1) ?? page;
        });
      };
      observe(page);
      session.context.on("page", (page) => {
        remote.page = page;
        observe(page);
      });
      await page.goto(entrypoint, { waitUntil: "commit" });
      return remote;
    } catch (error) {
      await session.context.close();
      throw error;
    }
  }
  async frame() {
    if (!this.dialog) {
      try {
        this.image = (
          await this.page.screenshot({
            type: "jpeg",
            quality: 75,
            timeout: 3000,
          })
        ).toString("base64");
      } catch (error) {
        if (!this.dialog) throw error;
      }
    }
    return {
      url: this.page.url(),
      image: this.image,
      dialog: this.dialog
        ? { type: this.dialog.type(), message: this.dialog.message() }
        : null,
    };
  }
  async act(action: z.infer<typeof browserAction>) {
    switch (action.type) {
      case "click":
        await this.page.mouse.click(action.x, action.y);
        break;
      case "key":
        await this.page.keyboard.press(action.key);
        break;
      case "text":
        await this.page.keyboard.insertText(action.text);
        break;
      case "scroll":
        await this.page.mouse.move(action.x, action.y);
        await this.page.mouse.wheel(action.deltaX, action.deltaY);
        break;
      case "navigate":
        await this.page.goto(action.url, { waitUntil: "commit" });
        break;
      case "back":
        await this.page.goBack({ waitUntil: "commit" });
        break;
      case "reload":
        await this.page.reload({ waitUntil: "commit" });
        break;
      case "dialog": {
        const dialog = this.dialog;
        this.dialog = undefined;
        if (dialog)
          await (action.accept ? dialog.accept(action.text) : dialog.dismiss());
      }
    }
  }
  close() {
    return this.context.close();
  }
}
