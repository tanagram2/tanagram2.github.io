// Text with an optional background.
//
// Primary content is a Text child. `self` is an optional background
// shape (any Shape). A Label with no background is a Composite with
// self: null - the Text still draws, the Label itself is invisible.
//
// Defaults are deliberately plain: white text, no background. Styling
// comes from options; Label doesn't impose a look.

import { Composite } from "./Composite.js";
import { Text }      from "../primitives/Text.js";

export class Label extends Composite {
  constructor(opts = {}) {
    super(opts);

    this.self = opts.self ?? null;

    const defaultTextOpts = {
      text:     opts.text     ?? "",
      x:        0,
      y:        0,
      align:    "left",
      baseline: "top",
      color:    "#ffffff",
      font:     "16px sans-serif",
    };

    this.text = new Text(
      opts.textOptions
        ? { ...defaultTextOpts, ...opts.textOptions }
        : defaultTextOpts
    );

    this.add(this.text);
  }

  setText(str) {
    this.text.text = str;
    return this;
  }

  getText() {
    return this.text.text;
  }
}