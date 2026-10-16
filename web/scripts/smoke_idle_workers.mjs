export async function checkIdleWorkers(devtools) {
  const selection = () => devtools.evaluate("window.__kc3rtsSelection()");
  const button = await devtools.evaluate(`(() => {
    const b = document.getElementById("idle-workers"), r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { x, y, count: Number(document.getElementById("idle-count").textContent),
      enabled: !b.disabled, visible: b.contains(document.elementFromPoint(x, y)) };
  })()`);
  if (!button.enabled || !button.visible || button.count < 1) throw new Error("Idle worker control unavailable or obscured");
  await devtools.click(button.x, button.y);
  const first = await selection();
  if (first.length !== 1) throw new Error("Idle worker click did not select one worker");
  await devtools.send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyI", key: "i" });
  await devtools.send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyI", key: "i" });
  const second = await selection();
  if (second.length !== 1 || (button.count > 1 && first[0] === second[0])) throw new Error("Idle worker shortcut did not cycle");

  // Only diagnostics mode exposes selection; these checks never mutate world state.
  const protectedSelection = await devtools.evaluate(`(() => {
    const before = JSON.stringify(window.__kc3rtsSelection());
    const unchanged = () => JSON.stringify(window.__kc3rtsSelection()) === before;
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey", "repeat"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyI", [modifier]: true }));
      if (!unchanged()) return false;
    }
    const input = document.createElement("input");
    const editor = document.createElement("div"); editor.contentEditable = "true";
    const nested = document.createElement("span"); nested.tabIndex = 0; editor.append(nested);
    const dialog = document.createElement("dialog");
    document.body.append(input, editor, dialog);
    try {
      for (const target of [input, nested]) {
        target.focus();
        target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyI", bubbles: true }));
        if (!unchanged()) return false;
      }
      dialog.showModal();
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyI" }));
      return unchanged();
    } finally { dialog.close(); input.remove(); editor.remove(); dialog.remove(); }
  })()`);
  if (!protectedSelection) throw new Error("Idle shortcut stole text/dialog focus or ignored modifiers");
}
