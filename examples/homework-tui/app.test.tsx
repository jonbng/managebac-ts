import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { HomeworkApp } from "./app.js";
import { createDemoDataSource } from "./data.js";

test("navigates tasks and loads full details automatically", async () => {
  const source = createDemoDataSource(0);
  const setup = await testRender(<HomeworkApp source={source} />, { width: 110, height: 28 });

  try {
    await act(async () => setup.renderOnce());
    await act(async () => Bun.sleep(1));
    await act(async () => setup.renderOnce());
    await act(async () => Bun.sleep(1));
    await act(async () => setup.renderOnce());
    const initialFrame = setup.captureCharFrame();
    expect(initialFrame).toContain("Comparative essay");
    expect(initialFrame).toContain("Dystopia and resistance");
    expect(initialFrame).toContain("Alex Morgan");
    expect(initialFrame).toContain("SUBMISSION");
    expect(initialFrame).toContain("Overdue   02");

    await act(async () => {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).toContain("Integration by parts problem set");

    await act(async () => Bun.sleep(1));
    await act(async () => setup.renderOnce());
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Learning task");
    expect(frame).toContain("Review the task instructions");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("windows the list in a compact 80x24 terminal", async () => {
  const setup = await testRender(<HomeworkApp source={createDemoDataSource(0)} />, { width: 80, height: 24 });

  try {
    await act(async () => setup.renderOnce());
    await act(async () => Bun.sleep(1));
    await act(async () => setup.renderOnce());
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Comparative essay");
    expect(frame).not.toContain("CAS monthly reflection");

    act(() => setup.mockInput.pressArrow("right"));
    await act(async () => setup.renderOnce());
    expect(setup.captureCharFrame()).toContain("Dystopia and resistance");
  } finally {
    act(() => setup.renderer.destroy());
  }
});

test("keeps panel geometry stable while list and details load", async () => {
  const setup = await testRender(<HomeworkApp source={createDemoDataSource(30)} />, { width: 110, height: 28 });

  try {
    await act(async () => setup.renderOnce());
    const loadingDivider = detailPanelColumn(setup.captureCharFrame());

    await act(async () => Bun.sleep(35));
    await act(async () => setup.renderOnce());
    const listDivider = detailPanelColumn(setup.captureCharFrame());

    await act(async () => Bun.sleep(35));
    await act(async () => setup.renderOnce());
    const detailsDivider = detailPanelColumn(setup.captureCharFrame());

    expect(loadingDivider).toBeGreaterThan(0);
    expect(listDivider).toBe(loadingDivider);
    expect(detailsDivider).toBe(loadingDivider);
  } finally {
    act(() => setup.renderer.destroy());
  }
});

function detailPanelColumn(frame: string): number {
  const border = frame.split("\n").find((line) => {
    const first = line.indexOf("┌");
    return first >= 0 && line.indexOf("┌", first + 1) >= 0;
  }) ?? "";
  return border.indexOf("┌", border.indexOf("┌") + 1);
}
