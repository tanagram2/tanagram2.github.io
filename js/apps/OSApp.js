// The launcher / main menu.
//
// Builds its menu from registry.js. It has no compile-time knowledge
// of Calculator, TimeClock, or any other app: it iterates APPS and
// makes one Button per entry. Adding an app never touches this file.
//
// OSApp is itself an App, launched by main.js as the default. It is
// deliberately NOT in registry.js - you can't launch the launcher from
// the launcher.

import { App }    from "./App.js";
import { Rect }   from "../primitives/Rect.js";
import { Text }   from "../primitives/Text.js";
import { Button } from "../composites/Button.js";
import { Panel }  from "../composites/Panel.js";
import { APPS }   from "./registry.js";

export class OSApp extends App {
  static displayName = "OSApp";

  init() {
    this.root.add(new Rect({
      x: 0, y: 0, w: "100%", h: "100%",
      fill: "#0d1015",
    }));

    this.root.add(new Text({
      x: 640, y: 90,
      text: "CanvasOS",
      font: "bold 44px sans-serif",
      color: "#e6ecf5",
      align: "center",
      baseline: "middle",
    }));

    // Live check that registry.js is being read correctly.
    this.root.add(new Text({
      x: 640, y: 140,
      text: APPS.length + (APPS.length === 1 ? " app" : " apps"),
      font: "16px monospace",
      color: "#5f7a95",
      align: "center",
      baseline: "middle",
    }));

    // No centering helper exists; arithmetic in place.
    const panelW = 420;
    const panelX = (1280 - panelW) / 2;
    const panelY = 200;
    const btnH   = 64;
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
          textOptions: { font: "bold 22px sans-serif", color: "#ffffff" },
          onClick: () => this.launch(AppClass),
        });
        panel.add(btn);
      });
    }

    this.root.add(new Text({
      x: 640, y: 690,
      text: "click an app to launch it",
      font: "12px monospace",
      color: "#3d5468",
      align: "center",
      baseline: "middle",
    }));
  }
}