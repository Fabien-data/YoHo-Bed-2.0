import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The click-budget harness (UX-0). A budget spec drives a task through this wrapper instead of
 * calling Playwright directly, so every user action is counted exactly as docs/UX-STANDARD.md
 * counts it:
 *
 * - **C** — one click, tap or committing key (Enter, a shortcut such as Alt+N). Opening a dropdown
 *   and picking from it is two.
 * - **T** — one field typed into, however long the text.
 *
 * Waiting for the screen (expect/waitFor) is free: a budget measures what the person does, not
 * what the product makes them wait for. Speed has its own budgets.
 */
export class UxBudget {
  clicks = 0;
  typed = 0;
  private readonly steps: string[] = [];

  constructor(readonly page: Page) {}

  private note(kind: 'C' | 'T', what: string) {
    this.steps.push(`${kind} ${what}`);
  }

  async click(target: Locator, what = 'click') {
    this.clicks++;
    this.note('C', what);
    await target.click();
  }

  /** A double-click is one deliberate action (Stay View's empty night). */
  async dblclick(target: Locator, what = 'double-click') {
    this.clicks++;
    this.note('C', what);
    await target.dblclick();
  }

  /** A key that commits: Enter, Tab-to-accept, or a shortcut. */
  async press(key: string, target?: Locator, what = key) {
    this.clicks++;
    this.note('C', what);
    if (target) await target.press(key);
    else await this.page.keyboard.press(key);
  }

  async fill(target: Locator, text: string, what = 'type') {
    this.typed++;
    this.note('T', what);
    await target.fill(text);
  }

  /** Open a dropdown and choose from it: two actions. */
  async pick(trigger: Locator, option: Locator, what = 'pick') {
    this.clicks += 2;
    this.note('C', `${what} (open)`);
    this.note('C', `${what} (choose)`);
    await trigger.click();
    await option.click();
  }

  /** What the task cost, for the report and for failure messages. */
  get summary(): string {
    return `${this.clicks}C+${this.typed}T — ${this.steps.join(' · ')}`;
  }

  expectWithin(budget: Budget) {
    expect(this.clicks, `clicks over budget: ${this.summary}`).toBeLessThanOrEqual(budget.clicks);
    expect(this.typed, `typed fields over budget: ${this.summary}`).toBeLessThanOrEqual(
      budget.typed,
    );
  }
}

export interface Budget {
  clicks: number;
  typed: number;
}

/**
 * The budgets, mirroring the table in docs/UX-STANDARD.md §3. Change both together — the doc is
 * the promise, this file is where it is kept.
 */
export const BUDGETS = {
  quickReservationNewGuest: { clicks: 8, typed: 3 },
  checkInPrepared: { clicks: 3, typed: 0 },
  fullCheckIn: { clicks: 6, typed: 2 },
  checkOutSettled: { clicks: 5, typed: 1 },
  walkIn: { clicks: 8, typed: 3 },
  takePayment: { clicks: 4, typed: 1 },
  findBooking: { clicks: 2, typed: 1 },
  changeStayDates: { clicks: 4, typed: 1 },
  moveRoom: { clicks: 3, typed: 0 },
  postStandardCharge: { clicks: 3, typed: 0 },
  markRoomClean: { clicks: 1, typed: 0 },
} satisfies Record<string, Budget>;
