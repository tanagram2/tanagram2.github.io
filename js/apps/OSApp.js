// The launcher / main menu.
//
// Builds its menu from registry.js. It has no compile-time knowledge
// of Calculator, TimeClock, or any other app: it iterates APPS and
// makes one Button per entry. Adding an app never touches this file.
//
// OSApp is itself an App, launched by main.js as the default. It is
// deliberately NOT in registry.js - you can't launch the launcher
// from the launcher.

import { App }      from "./App.js";
import { Rect }     from "../primitives/Rect.js";
import { Text }     from "../primitives/Text.js";
import { Button }   from "../composites/Button.js";
import { Panel }    from "../composites/Panel.js";
import { APPS }     from "./registry.js";
import { Viewport } from "../systems/Viewport.js";

export class OSApp extends App {
  static displayName = "OSApp";

  init() {
    const W = Viewport.width;
    const H = Viewport.height;
    const mobile = Viewport.isMobile;

    this.root.add(new Rect({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#0d1015",
    }));

    const titleFont = mobile ? "bold 56px sans-serif" : "bold 44px sans-serif";
    const titleY    = mobile ? 140 : 90;

    this.root.add(new Text({
      x: W / 2, y: titleY,
      text: "CanvasOS",
      font: titleFont,
      color: "#e6ecf5",
      align: "center",
      baseline: "middle",
    }));

    this.root.add(new Text({
      x: W / 2, y: titleY + 50,
      text: APPS.length + (APPS.length === 1 ? " app" : " apps"),
      font: "16px monospace",
      color: "#5f7a95",
      align: "center",
      baseline: "middle",
    }));

    const panelW = mobile ? 620 : 420;
    const panelX = (W - panelW) / 2;
    const panelY = mobile ? 240 : 200;
    const btnH   = mobile ? 80 : 64;
    const btnGap = 16;
    const pad    = 24;

    const panelH = pad * 2 + APPS.length * btnH + (APPS.length - 1) * btnGap;

    const panel = new Panel({
      x: panelX, y: panelY,
      w: panelW, h: panelH,
      fill: "#161b22",
      stroke: "#2b333c",
      strokeWidth: 2,
      radius: 10,
    });
    this.root.add(panel);

    const btnW = panelW - pad * 2;
    const btnFont = mobile ? "bold 26px sans-serif" : "bold 22px sans-serif";

    if (APPS.length === 0) {
      panel.add(new Text({
        x: panelW / 2, y: panelH / 2,
        text: "(no apps registered)",
        font: "14px monospace",
        color: "#5f7a95",
        align: "center",
        baseline: "middle",
      }));
    } else {
      APPS.forEach((AppClass, i) => {
        const btnY = pad + i * (btnH + btnGap);
        const btn = new Button({
          x: pad, y: btnY,
          w: btnW, h: btnH,
          text: AppClass.displayName,
          fill: "#1f6feb",
          stroke: "#4a8ff5",
          strokeWidth: 2,
          radius: 8,
          textOptions: { font: btnFont, color: "#ffffff" },
          onClick: () => this.launch(AppClass),
        });
        panel.add(btn);
      });
    }

    this.root.add(new Text({
      x: W / 2, y: H - 30,
      text: "click an app to launch it",
      font: "12px monospace",
      color: "#3d5468",
      align: "center",
      baseline: "middle",
    }));
  }
}